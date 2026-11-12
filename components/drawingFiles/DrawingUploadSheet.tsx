import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from '../ui/AppText';
import { Button } from '../ui/Button';
import { FormModal } from '../ui/FormModal';
import { useToast } from '../ui/Toast';
import { colors, radius, space } from '../../lib/theme';
import type { Department } from '../../lib/departments';
import {
  drawingKind,
  fetchDepartmentTasks,
  loadLastChoice,
  locationChain,
  locationPathLabel,
  MAX_DRAWING_MB,
  saveLastChoice,
  uploadDrawing,
  validateDrawing,
  type PickedDrawing,
  type PickerTask,
  type ProjectLocation,
} from '../../lib/drawingFiles';
import { DepartmentTiles, KindBadge, LocationChips, SectionLabel, TaskPickerList } from './parts';

// One sheet, top to bottom: Files → Where? (optional) → Department →
// Link to tasks (optional) → Save. Save is enabled as soon as there is at
// least one file and a department. The same tags apply to every file picked.

type ItemState = { file: PickedDrawing; status: 'ready' | 'uploading' | 'done' | 'failed'; progress: number; error?: string };

function sizeLabel(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DrawingUploadSheet({
  visible,
  projectId,
  userId,
  departments,
  locations,
  onLocationAdded,
  onClose,
  onSaved,
  presetTaskId,
  presetDepartmentId,
}: {
  visible: boolean;
  projectId: string;
  userId: string | null;
  departments: Department[];
  locations: ProjectLocation[];
  onLocationAdded: (l: ProjectLocation) => void;
  onClose: () => void;
  onSaved: () => void;
  presetTaskId?: string;
  presetDepartmentId?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [items, setItems] = useState<ItemState[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [revision, setRevision] = useState('');
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [tasks, setTasks] = useState<PickerTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskIds, setTaskIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  // Fresh sheet each time it opens; remember last department + location.
  useEffect(() => {
    if (!visible) return;
    setItems([]);
    setPickError(null);
    setRevision('');
    setTaskIds(new Set(presetTaskId ? [presetTaskId] : []));
    setSaving(false);
    void loadLastChoice(projectId).then((last) => {
      setRecentIds(last.recentLocationIds);
      setLocationId(last.locationId);
      setDepartmentId(presetDepartmentId ?? last.departmentId);
    });
  }, [visible, projectId, presetTaskId, presetDepartmentId]);

  // Department's tasks for the picker.
  useEffect(() => {
    if (!visible || !departmentId) {
      setTasks([]);
      return;
    }
    let alive = true;
    setTasksLoading(true);
    fetchDepartmentTasks(projectId, departmentId)
      .then((t) => alive && setTasks(t))
      .catch(() => alive && setTasks([]))
      .finally(() => alive && setTasksLoading(false));
    return () => {
      alive = false;
    };
  }, [visible, projectId, departmentId]);

  // Drop selections that are not in the new department's list.
  useEffect(() => {
    if (tasksLoading) return;
    setTaskIds((prev) => new Set([...prev].filter((id) => tasks.some((t) => t.id === id))));
  }, [tasks, tasksLoading]);

  // Tasks on the chosen floor first (when tasks carry a floor).
  const floorName = locationChain(byId, locationId)[0]?.name.toLowerCase() ?? null;
  const sortedTasks = useMemo(() => {
    if (!floorName) return tasks;
    const on = (t: PickerTask) => (t.floorLevel ?? '').toLowerCase() === floorName;
    return [...tasks].sort((a, b) => Number(on(b)) - Number(on(a)));
  }, [tasks, floorName]);

  async function pickFiles() {
    setPickError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const rejected: string[] = [];
    const next: ItemState[] = [];
    for (const a of res.assets) {
      const f: PickedDrawing = { uri: a.uri, name: a.name, mimeType: a.mimeType ?? null, size: a.size ?? null, file: (a as { file?: Blob }).file ?? null };
      const why = validateDrawing(f);
      if (why) rejected.push(`${a.name}: ${why}`);
      else next.push({ file: f, status: 'ready', progress: 0 });
    }
    setItems((prev) => [...prev.filter((p) => p.status !== 'done'), ...next]);
    if (rejected.length) setPickError(rejected.join('\n'));
  }

  const dept = departments.find((d) => d.id === departmentId) ?? null;
  const pending = items.filter((i) => i.status !== 'done');
  const canSave = !!dept && pending.length > 0 && !saving;

  async function save() {
    if (!dept) return;
    setSaving(true);
    let failed = 0;
    const tags = { departmentId: dept.id, locationId, revisionLabel: revision, taskIds: [...taskIds] };
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === 'done') continue;
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'uploading', progress: 0, error: undefined } : it)));
      try {
        await uploadDrawing(projectId, items[i].file, tags, userId, (p) =>
          setItems((prev) => prev.map((it, j) => (j === i ? { ...it, progress: p } : it)))
        );
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'done', progress: 1 } : it)));
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'failed', error: msg } : it)));
      }
    }
    setSaving(false);
    void saveLastChoice(projectId, dept.id, locationId);
    if (locationId) setRecentIds((r) => [locationId, ...r.filter((x) => x !== locationId)].slice(0, 3));
    onSaved();
    const where = [dept.name, locationPathLabel(byId, locationId)].filter(Boolean).join(' › ');
    if (failed === 0) {
      toast.success(`Saved to ${where}`);
      onClose();
    } else {
      toast.error(`${failed} file${failed === 1 ? '' : 's'} failed — tap Retry`);
    }
  }

  return (
    <FormModal visible={visible} onRequestClose={() => !saving && onClose()} position="bottom" animationType="slide">
      <View
        style={{
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.lg,
          marginTop: insets.top + 24,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
      >
        <View className="flex-row items-center mb-3">
          <Text className="flex-1 text-base font-bold text-neutral-900">Upload drawings</Text>
          <Pressable onPress={onClose} disabled={saving} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* 1. Files */}
        <View className="mb-4">
          <SectionLabel title="1. Files" hint={`PDF, DWG, PNG or JPG · up to ${MAX_DRAWING_MB} MB each · several at once`} />
          {items.map((it, i) => (
            <View key={`${it.file.name}-${i}`} className="flex-row items-center py-2 px-2 mb-1.5 rounded-xl bg-white border border-neutral-200" style={{ gap: 10 }}>
              <KindBadge kind={drawingKind(it.file.name, it.file.mimeType)} size={32} />
              <View className="flex-1">
                <Text className="text-xs font-semibold text-neutral-900" numberOfLines={1}>
                  {it.file.name}
                </Text>
                {it.status === 'uploading' || it.status === 'done' ? (
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.surfaceMuted, marginTop: 5, overflow: 'hidden' }}>
                    <View style={{ height: 4, width: `${Math.round(it.progress * 100)}%`, backgroundColor: it.status === 'done' ? colors.success : colors.navy }} />
                  </View>
                ) : (
                  <Text className="text-2xs mt-0.5" style={{ color: it.status === 'failed' ? colors.danger : colors.textMuted }} numberOfLines={2}>
                    {it.status === 'failed' ? it.error : sizeLabel(it.file.size)}
                  </Text>
                )}
              </View>
              {it.status === 'done' ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              ) : it.status === 'uploading' ? (
                <ActivityIndicator size="small" color={colors.navy} />
              ) : (
                <Pressable onPress={() => setItems((prev) => prev.filter((_, j) => j !== i))} disabled={saving} hitSlop={8} accessibilityLabel={`Remove ${it.file.name}`}>
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </Pressable>
              )}
            </View>
          ))}
          <Button label={items.length ? 'Add more files' : 'Choose files'} icon="attach" variant="secondary" onPress={() => void pickFiles()} disabled={saving} />
          {pickError ? <Text className="text-2xs mt-1.5" style={{ color: colors.danger }}>{pickError}</Text> : null}
        </View>

        {/* 2. Where? */}
        <View className="mb-4">
          <SectionLabel title="2. Where?" hint="Optional — stop at floor, room or wall" />
          <LocationChips
            projectId={projectId}
            userId={userId}
            locations={locations}
            value={locationId}
            onChange={setLocationId}
            onLocationAdded={onLocationAdded}
            recentIds={recentIds}
          />
        </View>

        {/* 3. Department */}
        <View className="mb-4">
          <SectionLabel title="3. Department" hint="Required — one tap" />
          {departments.length === 0 ? (
            <Text className="text-xs text-neutral-500">This project has no departments yet — add them in Settings › Departments.</Text>
          ) : (
            <DepartmentTiles departments={departments} value={departmentId} onChange={setDepartmentId} />
          )}
        </View>

        {/* 4. Tasks */}
        <View className="mb-4">
          <SectionLabel
            title="4. Link to tasks"
            hint={dept ? `Optional — ${dept.name} tasks only` : 'Optional — pick a department first'}
            right={taskIds.size ? <Text className="text-2xs font-bold text-brand-navy">{taskIds.size} selected</Text> : undefined}
          />
          {dept ? (
            <TaskPickerList
              tasks={sortedTasks}
              loading={tasksLoading}
              selected={taskIds}
              onToggle={(id) => setTaskIds((prev) => {
                const n = new Set(prev);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })}
              emptyText={`No ${dept.name} tasks in this project yet.`}
            />
          ) : null}
        </View>

        {/* Revision (small, optional) */}
        <View className="mb-4">
          <Text className="text-2xs font-semibold text-neutral-500 mb-1">Revision (optional)</Text>
          <TextInput
            value={revision}
            onChangeText={setRevision}
            placeholder="e.g. R0, Rev B"
            placeholderTextColor={colors.placeholder}
            style={{ minHeight: 40, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, fontSize: 14, color: colors.text, backgroundColor: colors.surface, maxWidth: 200 }}
          />
        </View>

        {/* Review → Save */}
        {dept && pending.length > 0 ? (
          <Text className="text-2xs text-neutral-600 mb-2">
            {pending.length} file{pending.length === 1 ? '' : 's'} → {dept.name}
            {locationId ? ` › ${locationPathLabel(byId, locationId)}` : ''}
            {taskIds.size ? ` · ${taskIds.size} task${taskIds.size === 1 ? '' : 's'}` : ''}
          </Text>
        ) : null}
        <Button
          label={
            saving
              ? 'Uploading…'
              : items.some((i) => i.status === 'failed')
                ? 'Retry failed'
                : !dept
                  ? 'Pick a department to save'
                  : pending.length === 0
                    ? 'Choose a file to save'
                    : `Save ${pending.length} file${pending.length === 1 ? '' : 's'}`
          }
          icon="cloud-upload-outline"
          size="lg"
          fullWidth
          busy={saving}
          disabled={!canSave}
          onPress={() => void save()}
        />
      </View>
    </FormModal>
  );
}
