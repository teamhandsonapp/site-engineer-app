import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '../../components/ui/AppText';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { useToast } from '../../components/ui/Toast';
import { DrawingCanvas, type Box, type CompareInfo, type OverlayLayer, type PdfRef } from '../../components/drawings/DrawingCanvas';
import { Chip, formatDate } from '../../components/drawings/ui';
import { TagDetailSheet, TagFormSheet } from '../../components/drawings/TagSheets';
import { LayersSheet, RevisionsSheet, UploadRevisionSheet, type UploadRevisionTarget } from '../../components/drawings/PanelSheets';
import { fetchDrawingViewerData } from '../../lib/drawings/data';
import {
  DISCIPLINES,
  DISCIPLINE_COLOR,
  DISCIPLINE_LABEL,
  TAG_STATUS_COLOR,
  TAG_STATUS_LABEL,
  revLabel,
  type DrawingDiscipline,
  type DrawingViewerDTO,
  type OverlayDTO,
  type TagStatusKind,
} from '../../lib/drawings/types';
import { canEditDrawings, canViewDrawings } from '../../lib/drawings/roles';
import { useLatestRequest } from '../../lib/useLatestRequest';
import { pageCount } from '../../components/drawings/pageCount';
import { supabase } from '../../lib/supabase';

const BASE_KEY = '__base';
const HEADER = {
  headerShown: true,
  headerStyle: { backgroundColor: '#0F1F33' },
  headerTintColor: '#fff',
  headerTitleStyle: { fontWeight: '600' as const },
};

// admin-web /projects/[id]/drawings/[drawingId] (DrawingViewer), phone
// layout: the toolbar is a compact bar, the side panels (Layers, Selected
// area, Revisions) and dialogs are bottom sheets. Same behaviour and labels.
export default function DrawingViewerScreen() {
  const params = useLocalSearchParams<{ drawingId: string; projectId?: string; view?: string }>();
  const { state } = useAuth();
  const { selectedProjectId } = useProject();
  const projectId = params.projectId || selectedProjectId;
  const profile = state.status === 'signed-in' ? state.profile : null;
  const canView = profile ? canViewDrawings(profile.role) : false;
  const canEdit = profile ? canEditDrawings(profile.role) : false;
  const canTag = canView; // site engineers may add tags and photos too
  const toast = useToast();

  const [data, setData] = useState<DrawingViewerDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const latestReq = useLatestRequest();
  const load = useCallback(async () => {
    if (!projectId || !params.drawingId || !canView) return;
    const isCurrent = latestReq.begin();
    setRefreshing(true);
    try {
      const res = await fetchDrawingViewerData(projectId, params.drawingId);
      if (!isCurrent()) return;
      if (!res) setError('Drawing not found');
      else {
        setError(null);
        setData(res);
      }
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrent()) setRefreshing(false);
    }
  }, [projectId, params.drawingId, canView, latestReq]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  // Tags and photos added on the web (or another phone) appear live, for
  // the open drawing only.
  useEffect(() => {
    if (!params.drawingId || !canView) return;
    const channel = supabase
      .channel(`drawing-tags-${params.drawingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drawing_tags', filter: `drawing_id=eq.${params.drawingId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drawing_tag_photos' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [params.drawingId, canView, load]);

  if (!profile || !canView) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Stack.Screen options={{ ...HEADER, title: 'Drawing' }} />
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Stack.Screen options={{ ...HEADER, title: 'Drawing' }} />
        {error ? <Text className="text-sm text-red-600 text-center">{error}</Text> : <Text className="text-sm text-neutral-500">Loading drawing…</Text>}
      </View>
    );
  }
  return (
    <Viewer
      key={data.drawing.id}
      data={data}
      ownOnly={params.view === 'only'}
      userId={profile.id}
      canEdit={canEdit}
      canTag={canTag}
      refreshing={refreshing}
      refresh={load}
      toast={(m) => toast.success(m)}
      toastError={(m) => toast.error(m)}
    />
  );
}

function Viewer({
  data,
  ownOnly,
  userId,
  canEdit,
  canTag,
  refreshing,
  refresh,
  toast,
  toastError,
}: {
  data: DrawingViewerDTO;
  ownOnly: boolean;
  userId: string;
  canEdit: boolean;
  canTag: boolean;
  refreshing: boolean;
  refresh: () => void;
  toast: (m: string) => void;
  toastError: (m: string) => void;
}) {
  const { drawing, versions, overlays, tags, project, floor } = data;
  const latest = versions[0] ?? null;
  const [picked, setPicked] = useState<{ id: string; latestId: string } | null>(null);
  const versionId = picked && latest && picked.latestId === latest.id ? picked.id : latest?.id ?? null;
  const setVersionId = (id: string) => latest && setPicked({ id, latestId: latest.id });
  const vIndex = Math.max(0, versions.findIndex((v) => v.id === versionId));
  const current = versions[vIndex] ?? null;
  const previous = versions[vIndex + 1] ?? null;

  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [showChanges, setShowChanges] = useState(false);
  const [compareInfoRaw, setCompareInfo] = useState<CompareInfo | null>(null);
  const [tagMode, setTagMode] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => (ownOnly ? Object.fromEntries(overlays.map((o) => [o.id, false])) : {}));
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [newBox, setNewBox] = useState<Box | null>(null);
  const [editingTag, setEditingTag] = useState(false);
  const [upload, setUpload] = useState<UploadRevisionTarget | null>(null);
  const [sheet, setSheet] = useState<'layers' | 'revisions' | null>(null);
  const [reminding, setReminding] = useState<string | null>(null);

  const isOn = (key: string) => visible[key] !== false;
  const toggle = (key: string) => setVisible((v) => ({ ...v, [key]: !isOn(key) }));
  const showAllLayers = () => setVisible({});
  const showOwnLayerOnly = () => setVisible(Object.fromEntries(overlays.map((o) => [o.id, false])));
  const issuedOverlays = overlays.filter((o) => o.versions[0]);
  const isFloorBase = !drawing.base;
  const allLayersView = isFloorBase && issuedOverlays.length > 0 && issuedOverlays.some((o) => isOn(o.id));

  // Page count from the PDF (web build); native shows page 1 until the
  // phone renderer lands.
  useEffect(() => {
    if (!current?.url) return;
    let live = true;
    pageCount(current.id, current.url)
      .then((n) => {
        if (!live) return;
        setNumPages(n);
        setPage((p) => Math.min(p, n));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [current?.id, current?.url]);

  const base: PdfRef | null = current?.url ? { versionId: current.id, url: current.url } : null;
  const compareWith: PdfRef | null = showChanges && previous?.url ? { versionId: previous.id, url: previous.url } : null;
  const onCompareInfo = useCallback((i: CompareInfo) => setCompareInfo(i), []);
  const compareInfo =
    compareWith && compareInfoRaw && compareInfoRaw.olderVersionId === compareWith.versionId && compareInfoRaw.newerVersionId === current?.id ? compareInfoRaw : null;

  const overlayLayers: OverlayLayer[] = useMemo(
    () =>
      overlays
        .filter((o) => visible[o.id] !== false && o.versions[0]?.url)
        .map((o) => ({ key: o.id, versionId: o.versions[0].id, url: o.versions[0].url!, color: DISCIPLINE_COLOR[o.discipline] })),
    [overlays, visible]
  );

  const layerHidden = (layer: DrawingDiscipline) => {
    if (layer === drawing.discipline || (layer === 'ARCHITECTURAL' && !drawing.base)) return !isOn(BASE_KEY);
    const sheets = overlays.filter((o) => o.discipline === layer);
    return sheets.length > 0 && sheets.every((o) => !isOn(o.id));
  };
  const pageTags = tags.filter((t) => t.page === page && !layerHidden(t.layer));
  const selected = tags.find((t) => t.id === selectedTagId) ?? null;

  const tagLayers: DrawingDiscipline[] = useMemo(() => {
    const own = drawing.discipline;
    const shown = [...overlays.filter((o) => visible[o.id] !== false && o.versions[0]).map((o) => o.discipline), ...(visible[BASE_KEY] !== false ? [own] : [])];
    const fromOverlays = overlays.map((o) => o.discipline);
    const rest = DISCIPLINES.filter((d) => d !== own && !fromOverlays.includes(d) && d !== 'OTHER');
    return [...new Set<DrawingDiscipline>([...shown, own, ...fromOverlays, ...rest, 'OTHER'])];
  }, [drawing.discipline, overlays, visible]);

  function staleNoteFor(o: OverlayDTO): string | null {
    const ov = o.versions[0];
    if (!ov || !current) return null;
    if (ov.basedOnRevision === null || ov.basedOnRevision !== current.revisionNumber) {
      return `${o.sheetNumber} ${revLabel(ov.revisionNumber)} was drawn on ${drawing.sheetNumber} ${ov.basedOnRevision === null ? '(unknown revision)' : revLabel(ov.basedOnRevision)}, so it may not match ${revLabel(current.revisionNumber)}.`;
    }
    return null;
  }
  const selectedStale = selected ? overlays.filter((o) => o.discipline === selected.layer).map(staleNoteFor).find(Boolean) ?? null : null;

  async function remind(o: OverlayDTO) {
    setReminding(o.id);
    const { data: res, error } = await supabase.functions.invoke('send-consultant-reminder', { body: { overlayDrawingId: o.id } });
    setReminding(null);
    if (error || !res?.ok) {
      toastError((res && res.error) || 'Reminders from the app need the reminder service, which is not deployed yet.');
      return;
    }
    toast(`Reminder sent to ${o.consultantEmail}`);
    refresh();
  }

  function openUploadFor(o?: OverlayDTO) {
    if (!o) {
      setUpload({ drawingId: drawing.id, sheetNumber: drawing.sheetNumber, title: drawing.title, nextRevision: latest ? latest.revisionNumber + 1 : 0 });
      return;
    }
    setUpload({
      drawingId: o.id,
      sheetNumber: o.sheetNumber,
      title: o.title,
      nextRevision: o.versions[0] ? o.versions[0].revisionNumber + 1 : 0,
      base: { sheetNumber: drawing.sheetNumber, versions: versions.map((v) => ({ id: v.id, revisionNumber: v.revisionNumber })) },
    });
  }

  const overdue = overlays.filter((o) => o.status.overdueDays > 0);
  const counts = tags.reduce<Record<TagStatusKind, number>>((acc, t) => ({ ...acc, [t.statusKind]: acc[t.statusKind] + 1 }), { done: 0, progress: 0, delayed: 0, idle: 0, none: 0 });

  const go = (id: string, only = false) =>
    router.replace({ pathname: '/drawings/[drawingId]', params: { drawingId: id, projectId: project.id, ...(only ? { view: 'only' } : {}) } } as never);
  const onBase = drawing.id === floor.baseId;

  const hint = tagMode
    ? 'Drag a box around a wall, window, pipe or wiring run.'
    : showChanges && compareInfo
      ? compareInfo.sameSize
        ? `${compareInfo.regions} changed area${compareInfo.regions === 1 ? '' : 's'} since ${revLabel(previous!.revisionNumber)} · green added, red removed`
        : `Sheet size changed since ${revLabel(previous!.revisionNumber)} — can't compare automatically`
      : 'Pinch or scroll to zoom, drag to move. Tap a box to see its task and photos.';

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen options={{ ...HEADER, title: `${drawing.sheetNumber} · ${drawing.title}` }} />

      {/* Title block */}
      <View className="px-3 pt-2 pb-1 bg-white border-b border-neutral-100">
        <Text className="text-xs text-neutral-500" numberOfLines={1}>
          {DISCIPLINE_LABEL[drawing.discipline]}
          {drawing.consultantName ? ` · ${drawing.consultantName}` : ''}
          {drawing.base ? ' · drawn over ' : ''}
          {drawing.base ? (
            <Text className="underline" onPress={() => go(drawing.base!.id)}>
              {drawing.base.sheetNumber} {drawing.base.title}
            </Text>
          ) : null}
        </Text>
        {/* Revisions + upload */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingTop: 6, alignItems: 'center' }}>
          {[...versions].reverse().map((v) => (
            <Chip key={v.id} label={`${revLabel(v.revisionNumber)} · ${formatDate(v.uploadedAt).replace(/ \d{4}$/, '')}`} active={v.id === current?.id} onPress={() => setVersionId(v.id)} />
          ))}
          {canEdit ? <Chip label={`Upload ${revLabel(latest ? latest.revisionNumber + 1 : 0)}`} active={false} onPress={() => openUploadFor()} /> : null}
        </ScrollView>
        {/* Department switcher */}
        {floor.sheets.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>
            <Text className="text-xs text-neutral-500 mr-1.5 mb-1.5">{floor.title}:</Text>
            <Chip label="All layers" active={allLayersView} onPress={() => (onBase && isFloorBase ? showAllLayers() : go(floor.baseId))} />
            {floor.sheets.map((s) => {
              const isBaseSheet = s.id === floor.baseId;
              const active = isBaseSheet ? onBase && !allLayersView : s.id === drawing.id;
              return (
                <Chip
                  key={s.id}
                  label={DISCIPLINE_LABEL[s.discipline]}
                  mono={s.sheetNumber}
                  color={DISCIPLINE_COLOR[s.discipline]}
                  active={active}
                  onPress={() => (isBaseSheet && onBase ? showOwnLayerOnly() : go(s.id, isBaseSheet))}
                />
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {/* Toolbar */}
      <View className="px-3 py-1.5 bg-white border-b border-neutral-100">
        <Text className="text-2xs text-neutral-500 mb-1" numberOfLines={2}>
          {hint}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>
          {numPages > 1
            ? Array.from({ length: numPages }, (_, i) => <Chip key={i} label={`Page ${i + 1} of ${numPages}`} active={page === i + 1} onPress={() => setPage(i + 1)} />)
            : null}
          <Chip
            label={showChanges ? 'Hide changes' : 'Show changes'}
            active={showChanges}
            disabled={!previous}
            onPress={() => {
              setShowChanges((s) => !s);
              setTagMode(false);
            }}
          />
          {canTag ? (
            <Chip
              label={tagMode ? 'Cancel tagging' : '+ Tag area'}
              active={tagMode}
              disabled={!base}
              onPress={() => {
                setTagMode((t) => !t);
                setShowChanges(false);
              }}
            />
          ) : null}
          <Chip label="Layers" active={false} onPress={() => setSheet('layers')} />
          <Chip label={overdue.length ? `Revisions · ${overdue.length} overdue` : 'Revisions'} active={false} onPress={() => setSheet('revisions')} />
        </ScrollView>
      </View>

      {/* Sheet */}
      <View className="flex-1">
        <DrawingCanvas
          base={base}
          showBase={isOn(BASE_KEY)}
          compareWith={compareWith}
          overlays={overlayLayers}
          page={page}
          tags={showChanges ? [] : pageTags}
          selectedTagId={selectedTagId}
          onSelectTag={setSelectedTagId}
          tagMode={tagMode}
          onBoxDrawn={setNewBox}
          onCompareInfo={onCompareInfo}
          draftBox={newBox}
        />
      </View>

      {/* Legend */}
      <View className="flex-row flex-wrap px-3 py-2 bg-white border-t border-neutral-100">
        {(['done', 'progress', 'delayed', 'idle', 'none'] as TagStatusKind[]).map((k) => (
          <View key={k} className="flex-row items-center mr-3 mb-0.5">
            <View className="w-3 h-3 rounded-sm border-2 mr-1" style={{ borderColor: TAG_STATUS_COLOR[k] }} />
            <Text className="text-2xs text-neutral-500">
              {TAG_STATUS_LABEL[k]}
              {counts[k] > 0 ? <Text className="text-neutral-400"> ({counts[k]})</Text> : null}
            </Text>
          </View>
        ))}
        {refreshing ? <Text className="text-2xs text-neutral-400 ml-auto">Updating…</Text> : null}
      </View>

      {/* Tag list (no-canvas access, also the native fallback) */}
      {tags.length > 0 && !selected ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="bg-white border-t border-neutral-100" style={{ maxHeight: 52 }} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' }}>
          {tags.map((t) => (
            <Pressable key={t.id} onPress={() => setSelectedTagId(t.id)} className="flex-row items-center rounded-full border px-2.5 py-1 mr-1.5" style={{ borderColor: TAG_STATUS_COLOR[t.statusKind] }}>
              <Ionicons name="pricetag-outline" size={11} color={TAG_STATUS_COLOR[t.statusKind]} />
              <Text className="text-2xs font-semibold text-neutral-700 ml-1" numberOfLines={1}>
                {t.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {selected && !editingTag ? (
        <TagDetailSheet
          tag={selected}
          overlayStale={selectedStale}
          projectId={project.id}
          drawingId={drawing.id}
          userId={userId}
          canTag={canTag}
          canEdit={canEdit}
          onEdit={() => setEditingTag(true)}
          onChanged={refresh}
          onDeleted={() => {
            setSelectedTagId(null);
            toast('Tag deleted');
            refresh();
          }}
          onClose={() => setSelectedTagId(null)}
        />
      ) : null}

      {newBox ? (
        <TagFormSheet
          mode="create"
          drawingId={drawing.id}
          page={page}
          box={newBox}
          layers={tagLayers}
          rooms={data.rooms}
          tasks={data.tasks}
          userId={userId}
          onClose={() => setNewBox(null)}
          onSaved={(id) => {
            setNewBox(null);
            setTagMode(false);
            setSelectedTagId(id);
            toast('Area tagged');
            refresh();
          }}
        />
      ) : null}

      {editingTag && selected ? (
        <TagFormSheet
          mode="edit"
          drawingId={drawing.id}
          page={page}
          tag={selected}
          layers={tagLayers}
          rooms={data.rooms}
          tasks={data.tasks}
          userId={userId}
          onClose={() => setEditingTag(false)}
          onSaved={() => {
            setEditingTag(false);
            refresh();
          }}
        />
      ) : null}

      {sheet === 'layers' ? (
        <LayersSheet data={data} isOn={isOn} toggle={toggle} showAll={showAllLayers} hideOthers={showOwnLayerOnly} staleNoteFor={staleNoteFor} canEdit={canEdit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'revisions' ? (
        <RevisionsSheet
          data={data}
          currentId={current?.id ?? null}
          onPick={(id) => {
            setVersionId(id);
            setSheet(null);
          }}
          onUpload={(o) => {
            setSheet(null);
            openUploadFor(o);
          }}
          onRemind={remind}
          reminding={reminding}
          canEdit={canEdit}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {upload ? (
        <UploadRevisionSheet
          target={upload}
          projectId={project.id}
          userId={userId}
          onClose={() => setUpload(null)}
          onUploaded={(n) => {
            toast(`${upload.sheetNumber} ${revLabel(n)} uploaded`);
            setUpload(null);
            refresh();
          }}
        />
      ) : null}
    </View>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
