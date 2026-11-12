import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { createElement, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FormModal } from '../ui/FormModal';
import { useToast } from '../ui/Toast';
import { colors, radius, space } from '../../lib/theme';
import type { Department } from '../../lib/departments';
import {
  deleteDrawing,
  fetchDepartmentTasks,
  fetchFileTaskLinks,
  getDrawingUrl,
  locationPathLabel,
  setFileTaskLinks,
  updateDrawingTags,
  type DrawingFile,
  type LinkedTask,
  type PickerTask,
  type ProjectLocation,
} from '../../lib/drawingFiles';
import { DepartmentTiles, KindBadge, LocationChips, SectionLabel, TaskPickerList } from './parts';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
}

function sizeLabel(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DrawingDetail({
  file,
  projectId,
  userId,
  canEdit,
  departments,
  locations,
  onLocationAdded,
  onBack,
  onChanged,
}: {
  file: DrawingFile;
  projectId: string;
  userId: string | null;
  canEdit: boolean;
  departments: Department[];
  locations: ProjectLocation[];
  onLocationAdded: (l: ProjectLocation) => void;
  onBack: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const dept = departments.find((d) => d.id === file.departmentId) ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkedTask[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editTags, setEditTags] = useState(false);
  const [editLinks, setEditLinks] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit-tags draft
  const [draftDept, setDraftDept] = useState<string | null>(file.departmentId);
  const [draftLoc, setDraftLoc] = useState<string | null>(file.locationId);
  const [draftRev, setDraftRev] = useState(file.revisionLabel ?? '');
  // Edit-links draft
  const [deptTasks, setDeptTasks] = useState<PickerTask[]>([]);
  const [deptTasksLoading, setDeptTasksLoading] = useState(false);
  const [draftLinks, setDraftLinks] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    // Only fetch a link up front when we can show it inline (images; PDF on web).
    if (file.kind === 'image' || (file.kind === 'pdf' && Platform.OS === 'web')) {
      getDrawingUrl(file.id)
        .then((u) => alive && setUrl(u))
        .catch((e) => alive && setUrlError(e instanceof Error ? e.message : String(e)));
    }
    fetchFileTaskLinks(file.id)
      .then((l) => alive && setLinks(l))
      .catch(() => alive && setLinks([]));
    return () => {
      alive = false;
    };
  }, [file.id, file.kind]);

  async function openExternally() {
    setBusy('open');
    try {
      const u = await getDrawingUrl(file.id);
      await Linking.openURL(u);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    setBusy('share');
    try {
      const u = await getDrawingUrl(file.id);
      if (Platform.OS === 'web') {
        await Linking.openURL(u);
        return;
      }
      const target = `${FileSystem.cacheDirectory}${file.name.replace(/[^\w.\- ]+/g, '_')}`;
      const { uri } = await FileSystem.downloadAsync(u, target);
      await Sharing.shareAsync(uri, { mimeType: file.mimeType ?? undefined, dialogTitle: file.name });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveTags() {
    if (!draftDept) return;
    setBusy('tags');
    try {
      await updateDrawingTags(file.id, { departmentId: draftDept, locationId: draftLoc, revisionLabel: draftRev });
      setEditTags(false);
      toast.success('Drawing updated');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function openLinkEditor() {
    setDraftLinks(new Set((links ?? []).map((l) => l.id)));
    setEditLinks(true);
    if (!file.departmentId) return;
    setDeptTasksLoading(true);
    fetchDepartmentTasks(projectId, file.departmentId)
      .then(setDeptTasks)
      .catch(() => setDeptTasks([]))
      .finally(() => setDeptTasksLoading(false));
  }

  async function saveLinks() {
    setBusy('links');
    try {
      await setFileTaskLinks(file.id, [...draftLinks], userId);
      setLinks(await fetchFileTaskLinks(file.id));
      setEditLinks(false);
      toast.success('Task links saved');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await deleteDrawing(file.id);
      toast.success('Drawing deleted');
      onChanged();
      onBack();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const locLabel = locationPathLabel(byId, file.locationId);

  return (
    <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Pressable onPress={onBack} className="flex-row items-center gap-1 mb-3" hitSlop={8}>
        <Ionicons name="arrow-back" size={16} color={colors.navy} />
        <Text className="text-sm font-bold text-brand-navy">Back</Text>
      </Pressable>

      <View className="flex-row items-center mb-3" style={{ gap: 10 }}>
        <KindBadge kind={file.kind} size={44} />
        <View className="flex-1">
          <Text className="text-base font-bold text-neutral-900" numberOfLines={3}>
            {file.name}
          </Text>
          <Text className="text-2xs text-neutral-500 mt-0.5">
            {sizeLabel(file.sizeBytes)} · {fmtDate(file.createdAtISO)} · {file.uploadedByName ?? '—'}
          </Text>
        </View>
      </View>

      {/* Preview */}
      <Card className="mb-3" style={{ padding: 0, overflow: 'hidden' }}>
        {file.kind === 'image' ? (
          url ? (
            <Image source={{ uri: url }} style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surfaceMuted }} resizeMode="contain" />
          ) : (
            <View style={{ aspectRatio: 4 / 3, alignItems: 'center', justifyContent: 'center' }}>
              {urlError ? <Text className="text-xs text-red-600 px-4">{urlError}</Text> : <ActivityIndicator color={colors.navy} />}
            </View>
          )
        ) : file.kind === 'pdf' && Platform.OS === 'web' ? (
          url ? (
            createElement('iframe', { src: url, title: file.name, style: { width: '100%', height: 560, border: 0, background: colors.surfaceMuted } })
          ) : (
            <View style={{ height: 240, alignItems: 'center', justifyContent: 'center' }}>
              {urlError ? <Text className="text-xs text-red-600 px-4">{urlError}</Text> : <ActivityIndicator color={colors.navy} />}
            </View>
          )
        ) : (
          <View style={{ padding: space.xl, alignItems: 'center' }}>
            <KindBadge kind={file.kind} size={56} />
            <Text className="text-xs text-neutral-600 text-center mt-3 mb-3">
              {file.kind === 'dwg'
                ? 'DWG files open in a CAD app (AutoCAD, DWG FastView…).'
                : 'Opens in your phone’s PDF viewer.'}
            </Text>
            <Button label={file.kind === 'dwg' ? 'Download / Open in another app' : 'Open PDF'} icon="open-outline" busy={busy === 'open'} onPress={() => void openExternally()} />
          </View>
        )}
      </Card>

      {/* Tags */}
      <Card className="mb-3">
        <SectionLabel
          title="Details"
          right={canEdit ? (
            <Pressable onPress={() => { setDraftDept(file.departmentId); setDraftLoc(file.locationId); setDraftRev(file.revisionLabel ?? ''); setEditTags(true); }} hitSlop={8}>
              <Text className="text-xs font-bold text-brand-navy">Edit</Text>
            </Pressable>
          ) : undefined}
        />
        {[
          ['Department', dept ? dept.name : '—'],
          ['Location', locLabel || 'Not set'],
          ['Revision', file.revisionLabel || '—'],
          ['Uploaded', `${file.uploadedByName ?? '—'} · ${fmtDate(file.createdAtISO)}`],
        ].map(([k, v]) => (
          <View key={k} className="flex-row py-1.5" style={{ gap: 8 }}>
            <Text className="text-xs text-neutral-500" style={{ width: 90 }}>{k}</Text>
            <View className="flex-1 flex-row items-center" style={{ gap: 6 }}>
              {k === 'Department' && dept ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dept.color }} /> : null}
              <Text className="text-xs font-semibold text-neutral-900 flex-1">{v}</Text>
            </View>
          </View>
        ))}
      </Card>

      {/* Linked tasks */}
      <Card className="mb-3">
        <SectionLabel
          title="Linked tasks"
          right={canEdit ? (
            <Pressable onPress={openLinkEditor} hitSlop={8}>
              <Text className="text-xs font-bold text-brand-navy">Edit links</Text>
            </Pressable>
          ) : undefined}
        />
        {links === null ? (
          <ActivityIndicator color={colors.navy} />
        ) : links.length === 0 ? (
          <Text className="text-xs text-neutral-500">Not linked to any task.</Text>
        ) : (
          links.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => router.push({ pathname: '/task/[taskId]', params: { taskId: t.id } } as never)}
              className="flex-row items-center py-2 border-b border-neutral-100"
              style={{ gap: 8 }}
            >
              <Ionicons name="git-commit-outline" size={16} color={colors.navy} />
              <View className="flex-1">
                <Text className="text-xs font-semibold text-neutral-900" numberOfLines={2}>{t.name}</Text>
                <Text className="text-2xs text-neutral-500">{t.code} · {t.status.replace(/_/g, ' ')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            </Pressable>
          ))
        )}
      </Card>

      <View className="flex-row flex-wrap" style={{ gap: space.sm }}>
        <Button label={Platform.OS === 'web' ? 'Download' : 'Share / Save'} icon="share-outline" variant="secondary" busy={busy === 'share'} onPress={() => void share()} />
        {file.kind !== 'dwg' && !(file.kind === 'pdf' && Platform.OS !== 'web') ? (
          <Button label="Open in new tab" icon="open-outline" variant="secondary" busy={busy === 'open'} onPress={() => void openExternally()} />
        ) : null}
        {canEdit ? <Button label="Delete" icon="trash-outline" variant="danger" onPress={() => setConfirmDelete(true)} /> : null}
      </View>

      {/* Edit department / location / revision */}
      <FormModal visible={editTags} onRequestClose={() => setEditTags(false)} position="bottom" animationType="slide">
        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
          <Text className="text-base font-bold text-neutral-900 mb-3">Edit drawing</Text>
          <SectionLabel title="Where?" hint="Optional" />
          <LocationChips projectId={projectId} userId={userId} locations={locations} value={draftLoc} onChange={setDraftLoc} onLocationAdded={onLocationAdded} />
          <View className="mt-3">
            <SectionLabel title="Department" />
            <DepartmentTiles departments={departments} value={draftDept} onChange={setDraftDept} />
          </View>
          <Text className="text-2xs font-semibold text-neutral-500 mt-3 mb-1">Revision</Text>
          <TextInput
            value={draftRev}
            onChangeText={setDraftRev}
            placeholder="e.g. R1"
            placeholderTextColor={colors.placeholder}
            style={{ minHeight: 40, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, fontSize: 14, color: colors.text, backgroundColor: colors.surface, maxWidth: 200 }}
          />
          {draftDept !== file.departmentId && (links?.length ?? 0) > 0 ? (
            <Text className="text-2xs mt-2" style={{ color: colors.warning }}>Linked tasks stay linked after changing the department.</Text>
          ) : null}
          <View className="flex-row mt-4" style={{ gap: space.sm }}>
            <Button label="Cancel" variant="secondary" onPress={() => setEditTags(false)} style={{ flex: 1 }} />
            <Button label="Save" busy={busy === 'tags'} disabled={!draftDept} onPress={() => void saveTags()} style={{ flex: 1 }} />
          </View>
        </View>
      </FormModal>

      {/* Edit task links */}
      <FormModal visible={editLinks} onRequestClose={() => setEditLinks(false)} position="bottom" animationType="slide">
        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
          <Text className="text-base font-bold text-neutral-900">Link to tasks</Text>
          <Text className="text-2xs text-neutral-500 mb-3">{dept ? `${dept.name} tasks in this project` : 'Set a department first'}</Text>
          <TaskPickerList
            tasks={deptTasks}
            loading={deptTasksLoading}
            selected={draftLinks}
            onToggle={(id) => setDraftLinks((prev) => {
              const n = new Set(prev);
              if (n.has(id)) n.delete(id);
              else n.add(id);
              return n;
            })}
            emptyText="No tasks in this department yet."
          />
          <View className="flex-row mt-4" style={{ gap: space.sm }}>
            <Button label="Cancel" variant="secondary" onPress={() => setEditLinks(false)} style={{ flex: 1 }} />
            <Button label={`Save (${draftLinks.size})`} busy={busy === 'links'} onPress={() => void saveLinks()} style={{ flex: 1 }} />
          </View>
        </View>
      </FormModal>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete this drawing?"
          description={`"${file.name}" will be removed from the File Manager and from every linked task.`}
          confirmLabel="Delete"
          variant="danger"
          busy={busy === 'delete'}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </ScrollView>
  );
}
