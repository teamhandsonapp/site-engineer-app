import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { Text } from '../ui/AppText';
import { Button } from '../ui/Button';
import { FormModal } from '../ui/FormModal';
import { useToast } from '../ui/Toast';
import { colors, radius, space } from '../../lib/theme';
import {
  fetchDrawingFiles,
  fetchLocations,
  fetchTaskDrawings,
  getDrawingUrl,
  linkFileToTask,
  locationPathLabel,
  unlinkFileFromTask,
  type DrawingFile,
  type ProjectLocation,
  type TaskDrawing,
} from '../../lib/drawingFiles';
import { KindBadge } from './parts';

// "Drawings" inside a task (Flowchart › task sheet): files linked to the task
// from the File Manager, plus drawing-register sheets whose tagged areas point
// at it. "Link drawing" lists this project's drawings of the task's department.

export function TaskDrawingsSection({
  projectId,
  taskId,
  workId,
  canEdit,
  userId,
}: {
  projectId: string;
  taskId: string;
  workId: string | null;
  canEdit: boolean;
  userId: string | null;
}) {
  const toast = useToast();
  const [items, setItems] = useState<TaskDrawing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<DrawingFile[] | null>(null);
  const [locations, setLocations] = useState<ProjectLocation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems(await fetchTaskDrawings(projectId, taskId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, taskId]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  async function open(d: TaskDrawing) {
    if (d.source === 'register') {
      router.push({ pathname: '/drawings/[drawingId]', params: { drawingId: d.id, projectId } } as never);
      return;
    }
    setOpening(d.id);
    try {
      await Linking.openURL(await getDrawingUrl(d.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  }

  async function openPicker() {
    setPickerOpen(true);
    setCandidates(null);
    try {
      const [files, locs] = await Promise.all([fetchDrawingFiles(projectId), fetchLocations(projectId)]);
      setLocations(locs);
      setCandidates(workId ? files.filter((f) => f.departmentId === workId) : files);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setCandidates([]);
    }
  }

  const linkedIds = new Set((items ?? []).filter((i) => i.source === 'file').map((i) => i.id));

  async function toggle(fileId: string) {
    setBusyId(fileId);
    try {
      if (linkedIds.has(fileId)) await unlinkFileFromTask(fileId, taskId);
      else await linkFileToTask(fileId, taskId, userId);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  const byId = new Map(locations.map((l) => [l.id, l]));

  return (
    <View className="mt-4 pt-3 border-t border-neutral-100">
      <View className="flex-row items-center mb-2">
        <Ionicons name="document-attach-outline" size={16} color={colors.navy} />
        <Text className="flex-1 text-sm font-bold text-neutral-900 ml-1.5">Drawings</Text>
        {canEdit ? (
          <Pressable onPress={() => void openPicker()} hitSlop={8} className="flex-row items-center" style={{ gap: 2 }}>
            <Ionicons name="add" size={16} color={colors.navy} />
            <Text className="text-xs font-bold text-brand-navy">Link drawing</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Text className="text-xs text-red-600">{error}</Text> : null}
      {!error && items === null ? <ActivityIndicator color={colors.navy} /> : null}
      {items && items.length === 0 ? <Text className="text-xs text-neutral-500">No drawings linked yet.</Text> : null}
      {(items ?? []).map((d) => (
        <Pressable
          key={`${d.source}-${d.id}`}
          onPress={() => void open(d)}
          className="flex-row items-center py-2 px-2 mb-1.5 rounded-xl bg-white border border-neutral-200"
          style={{ gap: 10 }}
        >
          <KindBadge kind={d.kind} size={32} />
          <View className="flex-1">
            <Text className="text-xs font-semibold text-neutral-900" numberOfLines={2}>
              {d.name}
              {d.revisionLabel ? `  · ${d.revisionLabel}` : ''}
            </Text>
            <Text className="text-2xs text-neutral-500" numberOfLines={1}>
              {d.source === 'register' ? `Register sheet${d.locationLabel ? ` · ${d.locationLabel}` : ''}` : d.locationLabel || 'No location'}
            </Text>
          </View>
          {opening === d.id ? <ActivityIndicator size="small" color={colors.navy} /> : <Ionicons name="open-outline" size={16} color={colors.textMuted} />}
        </Pressable>
      ))}

      <FormModal visible={pickerOpen} onRequestClose={() => setPickerOpen(false)} position="bottom" animationType="slide">
        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
          <Text className="text-base font-bold text-neutral-900">Link drawing</Text>
          <Text className="text-2xs text-neutral-500 mb-3">{workId ? 'Drawings of this task’s department' : 'All drawings in this project'} · tap to link / unlink</Text>
          {candidates === null ? <ActivityIndicator color={colors.navy} /> : null}
          {candidates && candidates.length === 0 ? (
            <Text className="text-xs text-neutral-500 py-2">No drawings for this department yet — upload them in File Manager › Drawings.</Text>
          ) : null}
          {(candidates ?? []).map((f) => {
            const on = linkedIds.has(f.id);
            return (
              <Pressable
                key={f.id}
                onPress={() => void toggle(f.id)}
                disabled={busyId !== null}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                className="flex-row items-center py-2 border-b border-neutral-100"
                style={{ gap: 10 }}
              >
                {busyId === f.id ? (
                  <ActivityIndicator size="small" color={colors.navy} style={{ width: 22 }} />
                ) : (
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.navy : colors.borderStrong} />
                )}
                <KindBadge kind={f.kind} size={30} />
                <View className="flex-1">
                  <Text className="text-xs font-semibold text-neutral-900" numberOfLines={2}>{f.name}</Text>
                  <Text className="text-2xs text-neutral-500" numberOfLines={1}>
                    {locationPathLabel(byId, f.locationId) || 'No location'}
                    {f.revisionLabel ? ` · ${f.revisionLabel}` : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <Button label="Done" onPress={() => setPickerOpen(false)} fullWidth style={{ marginTop: space.md }} />
        </View>
      </FormModal>
    </View>
  );
}
