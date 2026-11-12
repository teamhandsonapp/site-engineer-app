import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text, TextInput } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState, SkeletonList } from '../ui/States';
import { colors, radius, space } from '../../lib/theme';
import { fetchDepartments, type Department } from '../../lib/departments';
import {
  fetchDrawingFiles,
  fetchLocations,
  locationChain,
  locationPathLabel,
  locationSubtree,
  type DrawingFile,
  type ProjectLocation,
} from '../../lib/drawingFiles';
import { DrawingDetail } from './DrawingDetail';
import { DrawingUploadSheet } from './DrawingUploadSheet';
import { Chip, KindBadge } from './parts';

// File Manager › Drawings. Two views of the same files:
//   By department — department folders (with counts) → files grouped by location
//   By location   — floor → room → wall folders with a breadcrumb; files at
//                   each level, optional "include rooms and walls inside"
// Search covers name, department and location path.

const PAGE = 30;
type View_ = 'department' | 'location';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
}

export function DrawingsManager({
  projectId,
  projectName,
  userId,
  canEdit,
  startWithUpload = false,
  onExit,
}: {
  projectId: string;
  projectName: string;
  userId: string | null;
  canEdit: boolean;
  startWithUpload?: boolean;
  onExit: () => void;
}) {
  const [view, setView] = useState<View_>('department');
  const [files, setFiles] = useState<DrawingFile[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<ProjectLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(startWithUpload && canEdit);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  // By department
  const [deptId, setDeptId] = useState<string | null>(null);
  const [floorFilter, setFloorFilter] = useState<string | null>(null);
  // By location
  const [locId, setLocId] = useState<string | null>(null);
  const [includeInside, setIncludeInside] = useState(false);
  const [deptFilter, setDeptFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [f, d, l] = await Promise.all([fetchDrawingFiles(projectId), fetchDepartments(projectId), fetchLocations(projectId)]);
      setFiles(f);
      setDepartments(d);
      setLocations(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    setFiles(null);
    void load();
  }, [load]);

  useEffect(() => setLimit(PAGE), [view, deptId, locId, floorFilter, deptFilter, includeInside, query]);

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const countByDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files ?? []) if (f.departmentId) m.set(f.departmentId, (m.get(f.departmentId) ?? 0) + 1);
    return m;
  }, [files]);
  const floors = useMemo(() => locations.filter((l) => l.level === 'floor'), [locations]);

  const q = query.trim().toLowerCase();
  const searchHit = useCallback(
    (f: DrawingFile) =>
      f.name.toLowerCase().includes(q) ||
      (deptById.get(f.departmentId ?? '')?.name.toLowerCase().includes(q) ?? false) ||
      locationPathLabel(byId, f.locationId).toLowerCase().includes(q),
    [q, deptById, byId]
  );

  // Files to show in the current place.
  const shown = useMemo(() => {
    const all = files ?? [];
    if (q) return all.filter(searchHit);
    if (view === 'department') {
      if (!deptId) return [];
      let list = all.filter((f) => f.departmentId === deptId);
      if (floorFilter === 'none') list = list.filter((f) => !f.locationId);
      else if (floorFilter) list = list.filter((f) => locationChain(byId, f.locationId)[0]?.id === floorFilter);
      // Grouped by location path.
      return [...list].sort((a, b) => locationPathLabel(byId, a.locationId).localeCompare(locationPathLabel(byId, b.locationId)) || b.createdAtISO.localeCompare(a.createdAtISO));
    }
    const scope = locId ? (includeInside ? locationSubtree(locations, locId) : new Set([locId])) : null;
    let list = scope ? all.filter((f) => f.locationId && scope.has(f.locationId)) : all.filter((f) => !f.locationId);
    if (deptFilter) list = list.filter((f) => f.departmentId === deptFilter);
    return list;
  }, [files, q, searchHit, view, deptId, floorFilter, byId, locId, includeInside, locations, deptFilter]);

  const onLocationAdded = (l: ProjectLocation) => setLocations((prev) => [...prev, l]);

  // Always the freshest copy (after an edit, load() replaces `files`).
  const openFile = openFileId ? (files ?? []).find((f) => f.id === openFileId) ?? null : null;
  const setOpenFile = (f: DrawingFile | null) => setOpenFileId(f?.id ?? null);
  if (openFile) {
    return (
      <DrawingDetail
        key={openFile.id}
        file={openFile}
        projectId={projectId}
        userId={userId}
        canEdit={canEdit}
        departments={departments}
        locations={locations}
        onLocationAdded={onLocationAdded}
        onBack={() => setOpenFile(null)}
        onChanged={() => void load()}
      />
    );
  }

  const currentDept = deptId ? deptById.get(deptId) ?? null : null;
  const locPath = locationChain(byId, locId);
  const subLocations = locations.filter((l) => l.parentId === locId);
  const fileCountIn = (id: string) => {
    const s = locationSubtree(locations, id);
    return (files ?? []).filter((f) => f.locationId && s.has(f.locationId)).length;
  };

  function FileRow({ f, showPath = true }: { f: DrawingFile; showPath?: boolean }) {
    const d = f.departmentId ? deptById.get(f.departmentId) : undefined;
    const path = locationPathLabel(byId, f.locationId);
    return (
      <Pressable onPress={() => setOpenFile(f)} accessibilityRole="button">
        <Card className="mb-2 flex-row items-center" style={{ gap: 10, paddingVertical: 10 }}>
          <KindBadge kind={f.kind} />
          <View className="flex-1">
            <Text className="text-xs font-bold text-neutral-900" numberOfLines={2}>
              {f.name}
              {f.revisionLabel ? <Text className="text-2xs font-semibold text-neutral-500">{`  ${f.revisionLabel}`}</Text> : null}
            </Text>
            <View className="flex-row flex-wrap items-center mt-0.5" style={{ columnGap: 6 }}>
              {d && (view === 'location' || q) ? (
                <View className="flex-row items-center" style={{ gap: 3 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: d.color }} />
                  <Text className="text-2xs font-semibold text-neutral-700">{d.name}</Text>
                </View>
              ) : null}
              {showPath ? <Text className="text-2xs text-neutral-500" numberOfLines={1}>{path || 'No location'}</Text> : null}
            </View>
            <Text className="text-2xs text-neutral-400 mt-0.5">
              {f.uploadedByName ?? '—'} · {fmtDate(f.createdAtISO)}
              {f.linkedTaskCount ? ` · ${f.linkedTaskCount} task${f.linkedTaskCount === 1 ? '' : 's'}` : ''}
            </Text>
          </View>
          {f.linkedTaskCount ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.infoSoft }}>
              <Ionicons name="link" size={11} color={colors.info} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.info }}>{f.linkedTaskCount}</Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </Card>
      </Pressable>
    );
  }

  function FolderTile({ label, sub, color, icon, onPress }: { label: string; sub: string; color: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={{ flexBasis: '47%', flexGrow: 1 }}>
        <Card className="flex-row items-center" style={{ gap: 10, paddingVertical: 12 }}>
          <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: `${color}1A`, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={18} color={color} />
          </View>
          <View className="flex-1">
            <Text className="text-xs font-bold text-neutral-900" numberOfLines={2}>{label}</Text>
            <Text className="text-2xs text-neutral-500">{sub}</Text>
          </View>
        </Card>
      </Pressable>
    );
  }

  const list = shown.slice(0, limit);
  const listWithHeaders: ({ header: string } | { file: DrawingFile })[] = [];
  if (view === 'department' && !q) {
    let last: string | null = null;
    for (const f of list) {
      const h = locationPathLabel(byId, f.locationId) || 'No location';
      if (h !== last) listWithHeaders.push({ header: h });
      last = h;
      listWithHeaders.push({ file: f });
    }
  } else for (const f of list) listWithHeaders.push({ file: f });

  const atRoot = !q && ((view === 'department' && !deptId) || false);

  return (
    <View className="flex-1 bg-neutral-50">
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {/* Header */}
        <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
          <Pressable
            onPress={() => {
              if (view === 'department' && deptId && !q) setDeptId(null);
              else if (view === 'location' && locId && !q) setLocId(locPath.length > 1 ? locPath[locPath.length - 2].id : null);
              else onExit();
            }}
            className="flex-row items-center gap-1"
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={16} color={colors.navy} />
            <Text className="text-sm font-bold text-brand-navy">Back</Text>
          </Pressable>
          <Text className="flex-1 text-xs text-neutral-500 text-right" numberOfLines={1}>{projectName} › Drawings</Text>
        </View>

        <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
          <Text className="flex-1 text-lg font-bold text-neutral-900">Drawings</Text>
          {canEdit ? <Button label="Upload" icon="cloud-upload-outline" size="sm" onPress={() => setUploadOpen(true)} /> : null}
        </View>

        {/* View toggle */}
        <View className="flex-row mb-3 p-1 rounded-xl" style={{ backgroundColor: colors.surfaceMuted }}>
          {(['department', 'location'] as View_[]).map((v) => (
            <Pressable
              key={v}
              onPress={() => setView(v)}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === v }}
              style={{ flex: 1, minHeight: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: view === v ? colors.surface : 'transparent' }}
            >
              <Text className="text-xs font-bold" style={{ color: view === v ? colors.navy : colors.textMuted }}>
                {v === 'department' ? 'By department' : 'By location'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Search */}
        <View className="flex-row items-center mb-3 px-3 rounded-xl bg-white border border-neutral-200" style={{ minHeight: 42, gap: 6 }}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, department or location"
            placeholderTextColor={colors.placeholder}
            style={{ flex: 1, fontSize: 14, color: colors.text, paddingVertical: 8 }}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!error && files === null ? <SkeletonList rows={5} /> : null}

        {!error && files !== null ? (
          <>
            {/* By department: folders */}
            {view === 'department' && !deptId && !q ? (
              <>
                <View className="flex-row flex-wrap mb-3" style={{ gap: space.sm }}>
                  {departments.map((d) => (
                    <FolderTile key={d.id} label={d.name} sub={`${countByDept.get(d.id) ?? 0} files`} color={d.color} icon="folder" onPress={() => { setDeptId(d.id); setFloorFilter(null); }} />
                  ))}
                </View>
                {departments.length === 0 ? <EmptyState icon="folder-open-outline" title="No departments" subtitle="Add departments in Settings first." /> : null}
              </>
            ) : null}

            {/* By department: inside a department */}
            {view === 'department' && deptId && !q ? (
              <>
                <View className="flex-row items-center mb-2" style={{ gap: 6 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: currentDept?.color ?? colors.navy }} />
                  <Text className="text-sm font-bold text-neutral-900 flex-1">{currentDept?.name}</Text>
                  <Text className="text-2xs text-neutral-500">{shown.length} files</Text>
                </View>
                {floors.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3" contentContainerStyle={{ gap: 6 }}>
                    <Chip label="All floors" selected={!floorFilter} onPress={() => setFloorFilter(null)} />
                    {floors.map((fl) => (
                      <Chip key={fl.id} label={fl.name} selected={floorFilter === fl.id} onPress={() => setFloorFilter(floorFilter === fl.id ? null : fl.id)} />
                    ))}
                    <Chip label="No location" selected={floorFilter === 'none'} onPress={() => setFloorFilter(floorFilter === 'none' ? null : 'none')} />
                  </ScrollView>
                ) : null}
              </>
            ) : null}

            {/* By location: breadcrumb + subfolders + dept chips */}
            {view === 'location' && !q ? (
              <>
                <View className="flex-row flex-wrap items-center mb-2" style={{ gap: 4 }}>
                  <Pressable onPress={() => setLocId(null)} disabled={!locId}>
                    <Text className="text-xs font-bold" style={{ color: locId ? colors.info : colors.text }}>All locations</Text>
                  </Pressable>
                  {locPath.map((l, i) => (
                    <View key={l.id} className="flex-row items-center" style={{ gap: 4 }}>
                      <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
                      <Pressable onPress={() => setLocId(l.id)} disabled={i === locPath.length - 1}>
                        <Text className="text-xs font-bold" style={{ color: i === locPath.length - 1 ? colors.text : colors.info }}>{l.name}</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
                {subLocations.length > 0 ? (
                  <View className="flex-row flex-wrap mb-3" style={{ gap: space.sm }}>
                    {subLocations.map((l) => (
                      <FolderTile
                        key={l.id}
                        label={l.name}
                        sub={`${l.level === 'floor' ? 'Floor' : l.level === 'room' ? 'Room' : 'Wall'} · ${fileCountIn(l.id)} files`}
                        color={l.level === 'floor' ? colors.navy : l.level === 'room' ? '#B7791F' : '#0E7490'}
                        icon={l.level === 'floor' ? 'layers' : l.level === 'room' ? 'cube-outline' : 'square-outline'}
                        onPress={() => setLocId(l.id)}
                      />
                    ))}
                  </View>
                ) : null}
                {!locId && locations.length === 0 ? (
                  <Text className="text-xs text-neutral-500 mb-3">No floors yet — add them while uploading (Where? › + Add).</Text>
                ) : null}
                {locId && locPath[locPath.length - 1]?.level !== 'wall' ? (
                  <Pressable onPress={() => setIncludeInside((v) => !v)} className="flex-row items-center mb-2" style={{ gap: 6 }} accessibilityRole="checkbox" accessibilityState={{ checked: includeInside }}>
                    <Ionicons name={includeInside ? 'checkbox' : 'square-outline'} size={18} color={includeInside ? colors.navy : colors.borderStrong} />
                    <Text className="text-xs text-neutral-700">Include files from {locPath[locPath.length - 1]?.level === 'floor' ? 'rooms and walls' : 'walls'} inside</Text>
                  </Pressable>
                ) : null}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3" contentContainerStyle={{ gap: 6 }}>
                  <Chip label="All departments" selected={!deptFilter} onPress={() => setDeptFilter(null)} />
                  {departments.filter((d) => countByDept.get(d.id)).map((d) => (
                    <Chip key={d.id} label={d.name} color={d.color} selected={deptFilter === d.id} onPress={() => setDeptFilter(deptFilter === d.id ? null : d.id)} />
                  ))}
                </ScrollView>
                <Text className="text-2xs font-semibold text-neutral-500 mb-2">
                  {locId ? `Files in ${locPath[locPath.length - 1]?.name}` : 'Files with no location'} · {shown.length}
                </Text>
              </>
            ) : null}

            {q ? <Text className="text-2xs font-semibold text-neutral-500 mb-2">{shown.length} result{shown.length === 1 ? '' : 's'} for “{query}”</Text> : null}

            {/* Files */}
            {!atRoot &&
              listWithHeaders.map((row, i) =>
                'header' in row ? (
                  <Text key={`h-${i}`} className="text-2xs font-bold text-neutral-600 mt-2 mb-1.5">
                    {row.header}
                  </Text>
                ) : (
                  <FileRow key={row.file.id} f={row.file} showPath={view === 'location' || !!q} />
                )
              )}
            {!atRoot && shown.length > limit ? (
              <Button label={`Show more (${shown.length - limit})`} variant="secondary" onPress={() => setLimit((n) => n + PAGE)} fullWidth />
            ) : null}
            {!atRoot && shown.length === 0 ? (
              <EmptyState
                icon="document-outline"
                title={q ? 'Nothing found' : 'No drawings here yet'}
                subtitle={q ? 'Try another name, department or floor.' : canEdit ? 'Tap Upload to add PDF, DWG or images.' : undefined}
                actionLabel={!q && canEdit ? 'Upload' : undefined}
                onAction={!q && canEdit ? () => setUploadOpen(true) : undefined}
              />
            ) : null}

            {/* Existing drawing register (sheets, revisions, layers, tagged areas). */}
            {!q && view === 'department' && !deptId ? (
              <Pressable onPress={() => router.push({ pathname: '/drawings', params: { projectId } } as never)} className="mt-2">
                <Card className="flex-row items-center" style={{ gap: 10 }}>
                  <Ionicons name="map-outline" size={20} color={colors.navy} />
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-neutral-900">Drawing register</Text>
                    <Text className="text-2xs text-neutral-500">Sheets, revisions, layers and tagged areas</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                </Card>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <DrawingUploadSheet
        visible={uploadOpen}
        projectId={projectId}
        userId={userId}
        departments={departments}
        locations={locations}
        onLocationAdded={onLocationAdded}
        onClose={() => setUploadOpen(false)}
        onSaved={() => void load()}
        presetDepartmentId={view === 'department' ? deptId : null}
      />
    </View>
  );
}
