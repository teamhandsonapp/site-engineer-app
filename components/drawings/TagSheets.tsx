import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Button } from '../ui/Button';
import { BottomSheet, Chip, FieldLabel, formatDate, formatDateTime } from './ui';
import {
  DISCIPLINE_COLOR,
  DISCIPLINE_LABEL,
  TAG_STATUS_COLOR,
  TAG_STATUS_LABEL,
  taskStatusText,
  type DrawingDiscipline,
  type TagDTO,
  type TaskOptionDTO,
} from '../../lib/drawings/types';
import { addTagPhoto, createDrawingTag, deleteDrawingTag, deleteTagPhoto, updateDrawingTag } from '../../lib/drawings/data';
import { preparePhotoForUpload } from '../../lib/preparePhoto';
import type { Box } from './DrawingCanvas';

function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ])
  );
}

const inputClass = 'border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 bg-white';

// admin-web TagDialog: "Tag this area" / "Edit tagged area".
export function TagFormSheet({
  mode,
  drawingId,
  page,
  box,
  tag,
  layers,
  rooms,
  tasks,
  userId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  drawingId: string;
  page: number;
  box?: Box;
  tag?: TagDTO;
  layers: DrawingDiscipline[];
  rooms: string[];
  tasks: TaskOptionDTO[];
  userId: string;
  onClose: () => void;
  onSaved: (tagId: string) => void;
}) {
  const [name, setName] = useState(tag?.name ?? '');
  const [layer, setLayer] = useState<DrawingDiscipline>(tag?.layer ?? layers[0] ?? 'ARCHITECTURAL');
  const [room, setRoom] = useState(tag?.room ?? '');
  const [taskId, setTaskId] = useState(tag?.task?.id ?? '');
  const [taskQuery, setTaskQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byWork = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    const m = new Map<string, TaskOptionDTO[]>();
    for (const t of tasks) {
      if (q && !`${t.code} ${t.name} ${t.workName ?? ''}`.toLowerCase().includes(q)) continue;
      const k = t.workName ?? 'Other';
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [tasks, taskQuery]);
  const roomSuggestions = rooms.filter((r) => r !== room && r.toLowerCase().includes(room.trim().toLowerCase())).slice(0, 8);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const common = { name, layer, room, taskId: taskId || null };
      if (mode === 'create') {
        const id = await createDrawingTag({ drawingId, page, ...box!, ...common, createdById: userId });
        onSaved(id);
      } else {
        await updateDrawingTag({ tagId: tag!.id, ...common });
        onSaved(tag!.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      title={mode === 'create' ? 'Tag this area' : 'Edit tagged area'}
      onClose={() => !busy && onClose()}
      footer={
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
          </View>
          <View className="flex-1">
            <Button label={busy ? 'Saving…' : 'Save tag'} onPress={submit} disabled={busy || !name.trim()} />
          </View>
        </View>
      }
    >
      {error ? (
        <View className="p-3 rounded-lg bg-red-50 border border-red-200 mb-3">
          <Text className="text-sm text-red-600">{error}</Text>
        </View>
      ) : null}

      <FieldLabel>Name</FieldLabel>
      <TextInput value={name} onChangeText={setName} placeholder="e.g. Window W3, Kitchen north wall" maxLength={200} className={inputClass} autoFocus={mode === 'create'} />

      <View className="mt-4">
        <FieldLabel>Layer</FieldLabel>
        <View className="flex-row flex-wrap">
          {layers.map((l) => (
            <Chip key={l} label={DISCIPLINE_LABEL[l]} color={DISCIPLINE_COLOR[l]} active={layer === l} onPress={() => setLayer(l)} />
          ))}
        </View>
      </View>

      <View className="mt-3">
        <FieldLabel>Room / location</FieldLabel>
        <TextInput value={room} onChangeText={setRoom} placeholder="e.g. Kitchen" maxLength={200} className={inputClass} />
        {roomSuggestions.length > 0 ? (
          <View className="flex-row flex-wrap mt-1.5">
            {roomSuggestions.map((r) => (
              <Chip key={r} label={r} active={false} onPress={() => setRoom(r)} />
            ))}
          </View>
        ) : null}
      </View>

      <View className="mt-4">
        <FieldLabel>Linked task</FieldLabel>
        <TextInput value={taskQuery} onChangeText={setTaskQuery} placeholder="Search tasks" className={inputClass} />
        <View className="mt-2 border border-neutral-200 rounded-lg overflow-hidden">
          <TaskRow label="No task" selected={taskId === ''} onPress={() => setTaskId('')} />
          {byWork.map(([work, list]) => (
            <View key={work}>
              <Text className="px-3 pt-2.5 pb-1 text-2xs font-bold uppercase tracking-wide text-neutral-400 bg-neutral-50">{work}</Text>
              {list.map((t) => (
                <TaskRow key={t.id} label={`${t.code} · ${t.name} (${taskStatusText(t.status)})`} selected={taskId === t.id} onPress={() => setTaskId(t.id)} />
              ))}
            </View>
          ))}
        </View>
        <Text className="text-2xs text-neutral-400 mt-1.5">The box takes its colour from this task&apos;s status and due date.</Text>
      </View>
    </BottomSheet>
  );
}

function TaskRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className={`flex-row items-center px-3 py-2.5 border-t border-neutral-100 ${selected ? 'bg-amber-50' : 'bg-white'}`} style={{ minHeight: 44 }}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? '#F0A227' : '#9CA3AF'} />
      <Text className="flex-1 text-sm text-neutral-800 ml-2" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

// admin-web "Selected area" panel (TagDetail).
export function TagDetailSheet({
  tag,
  overlayStale,
  projectId,
  drawingId,
  userId,
  canTag,
  canEdit,
  onEdit,
  onChanged,
  onDeleted,
  onClose,
}: {
  tag: TagDTO;
  overlayStale: string | null;
  projectId: string;
  drawingId: string;
  userId: string;
  canTag: boolean; // may add photos
  canEdit: boolean; // may edit/delete (web roles)
  onEdit: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const color = TAG_STATUS_COLOR[tag.statusKind];

  async function addPhotos(fromCamera: boolean) {
    setError(null);
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: !fromCamera };
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError('Camera permission is needed to take a photo.');
    }
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;
    const list = res.assets;
    for (let i = 0; i < list.length; i++) {
      setBusy(`Uploading photo ${i + 1} of ${list.length}…`);
      try {
        const prepared = await preparePhotoForUpload(list[i]);
        await addTagPhoto({ projectId, drawingId, tagId: tag.id, base64: prepared.base64, mimeType: prepared.contentType, uploadedById: userId });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(null);
    onChanged();
  }

  async function removeTag() {
    if (!(await confirmAsync('Delete tag', `Delete the tag "${tag.name}" and its ${tag.photos.length} photo(s)?`))) return;
    setBusy('Deleting…');
    try {
      await deleteDrawingTag(tag.id, []);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  async function removePhoto(id: string) {
    if (!(await confirmAsync('Delete photo', 'Delete this photo?'))) return;
    setBusy('Deleting photo…');
    try {
      await deleteTagPhoto(id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  return (
    <BottomSheet title="Selected area" onClose={onClose}>
      <View className="flex-row items-start justify-between">
        <Text className="flex-1 text-md font-bold text-neutral-900 pr-2">{tag.name}</Text>
        <View className="flex-row items-center rounded-full px-2 py-0.5" style={{ backgroundColor: `${color}18` }}>
          <View className="w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: color }} />
          <Text className="text-2xs font-semibold" style={{ color }}>
            {TAG_STATUS_LABEL[tag.statusKind]}
          </Text>
        </View>
      </View>

      <View className="mt-3 gap-1.5">
        <Row label="Task">
          {tag.task ? (
            <Pressable onPress={() => router.push(`/task/${tag.task!.id}` as never)}>
              <Text className="text-sm text-neutral-900 underline">
                <Text className="text-xs text-neutral-500">{tag.task.code}</Text> {tag.task.name}
              </Text>
            </Pressable>
          ) : (
            <Text className="text-sm text-neutral-400">Not linked</Text>
          )}
        </Row>
        {tag.task ? (
          <Row label="Status">
            <Text className="text-sm text-neutral-900">
              {taskStatusText(tag.task.status)}
              {tag.task.dueDate ? <Text className="text-neutral-500"> · due {formatDate(tag.task.dueDate)}</Text> : null}
            </Text>
          </Row>
        ) : null}
        {tag.task?.workName ? (
          <Row label="Work">
            <Text className="text-sm text-neutral-900">{tag.task.workName}</Text>
          </Row>
        ) : null}
        <Row label="Layer">
          <View className="flex-row items-center">
            <View className="w-2 h-2 rounded-sm mr-1.5" style={{ backgroundColor: DISCIPLINE_COLOR[tag.layer] }} />
            <Text className="text-sm text-neutral-900">{DISCIPLINE_LABEL[tag.layer]}</Text>
          </View>
        </Row>
        <Row label="Location">
          <Text className={`text-sm ${tag.room ? 'text-neutral-900' : 'text-neutral-400'}`}>{tag.room || '—'}</Text>
        </Row>
      </View>

      {overlayStale ? <Text className="mt-3 text-xs text-red-700 bg-red-50 rounded-lg px-2.5 py-2">{overlayStale}</Text> : null}
      {error ? <Text className="mt-3 text-xs text-red-700 bg-red-50 rounded-lg px-2.5 py-2">{error}</Text> : null}

      <View className="flex-row items-center justify-between mt-4">
        <Text className="text-sm font-bold text-neutral-900">Site photos ({tag.photos.length})</Text>
        {canTag ? (
          <View className="flex-row gap-1.5">
            {Platform.OS !== 'web' ? <Button label="Camera" icon="camera-outline" size="sm" variant="secondary" onPress={() => addPhotos(true)} disabled={!!busy} /> : null}
            <Button label="+ Add photos" size="sm" variant="secondary" onPress={() => addPhotos(false)} disabled={!!busy} />
          </View>
        ) : null}
      </View>
      {busy ? (
        <View className="flex-row items-center mt-2">
          <ActivityIndicator size="small" color="#0F1F33" />
          <Text className="text-xs text-neutral-500 ml-2">{busy}</Text>
        </View>
      ) : null}
      {tag.photos.length === 0 ? (
        <Text className="text-sm text-neutral-400 mt-2">No photos for this area yet.</Text>
      ) : (
        <View className="flex-row flex-wrap mt-2 -mx-1">
          {tag.photos.map((p) => (
            <View key={p.id} className="w-1/3 p-1">
              <Pressable onPress={() => p.url && Linking.openURL(p.url)} className="rounded-lg overflow-hidden border border-neutral-200 bg-neutral-100" style={{ aspectRatio: 4 / 3 }}>
                {p.url ? (
                  <Image source={{ uri: p.url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel={p.caption ?? `Photo of ${tag.name}`} />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Text className="text-2xs text-neutral-400">Unavailable</Text>
                  </View>
                )}
                <Text className="absolute left-0 right-0 bottom-0 px-1.5 py-0.5 text-white bg-black/55" style={{ fontSize: 10 }} numberOfLines={1}>
                  {formatDateTime(p.uploadedAt)}
                </Text>
                {canEdit ? (
                  <Pressable onPress={() => removePhoto(p.id)} accessibilityLabel="Delete photo" hitSlop={8} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 items-center justify-center">
                    <Text className="text-white text-sm">×</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {canEdit ? (
        <View className="flex-row gap-2 mt-4">
          <Button label="Edit" variant="secondary" size="sm" onPress={onEdit} />
          <Button label="Delete tag" variant="danger" size="sm" onPress={removeTag} disabled={!!busy} />
        </View>
      ) : null}
    </BottomSheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row">
      <Text className="text-xs text-neutral-500" style={{ width: 84, paddingTop: 2 }}>
        {label}
      </Text>
      <View className="flex-1">{children}</View>
    </View>
  );
}
