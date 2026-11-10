import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card } from '../ui/Card';
import { APP_PROGRESS, type ProgressFrom, type ScreenProgress } from '../../lib/appProgress';

// App Progress: for each screen of the app, what is done, what is pending,
// and what is needed (and from whom). Starts from lib/appProgress.ts; every
// add / edit / delete / move made here is saved on this phone (AsyncStorage)
// and survives app restarts. "Reset" goes back to the list in the code.

const STORAGE_KEY = 'pmc.appProgress.v2';
const FROMS: ProgressFrom[] = ['Client', 'Prakash', 'Development', 'Phone update'];

const FROM_COLOR: Record<ProgressFrom, { fg: string; bg: string }> = {
  Client: { fg: '#B45309', bg: '#FEF3C7' },
  Prakash: { fg: '#1D4ED8', bg: '#DBEAFE' },
  Development: { fg: '#0F766E', bg: '#CCFBF1' },
  'Phone update': { fg: '#7C3AED', bg: '#EDE9FE' },
};

type Kind = 'done' | 'pending' | 'needed';

// What the editor sheet is working on. index = null means "add new".
type Editing =
  | { mode: 'item'; screen: number; kind: Kind; index: number | null; text: string; from: ProgressFrom }
  | { mode: 'screen'; screen: number | null; text: string };

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function clone(list: ScreenProgress[]): ScreenProgress[] {
  return list.map((p) => ({ ...p, done: [...p.done], pending: [...p.pending], needed: p.needed.map((n) => ({ ...n })) }));
}

function Section({ title, icon, color, count, onAdd, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; color: string; count: number; onAdd: () => void; children: React.ReactNode }) {
  return (
    <View className="mt-3">
      <View className="flex-row items-center mb-1">
        <Ionicons name={icon} size={16} color={color} />
        <Text className="text-sm font-bold ml-1.5" style={{ color }}>
          {title}
        </Text>
        <View className="ml-1.5 rounded-full px-1.5" style={{ backgroundColor: `${color}1A` }}>
          <Text className="text-2xs font-bold" style={{ color }}>
            {count}
          </Text>
        </View>
        <View className="flex-1" />
        <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel={`Add to ${title}`} hitSlop={6} className="flex-row items-center rounded-lg px-2 py-1" style={{ backgroundColor: `${color}14` }}>
          <Ionicons name="add" size={15} color={color} />
          <Text className="text-xs font-semibold ml-0.5" style={{ color }}>
            Add
          </Text>
        </Pressable>
      </View>
      {count === 0 ? <Text className="text-xs text-neutral-400 py-1.5">Nothing yet</Text> : children}
    </View>
  );
}

// One line: a tappable status icon on the left (moves the item between
// Pending and Done), the text (tap to edit), and a pencil hint.
function Row({ text, icon, color, onToggle, toggleLabel, onEdit, right }: { text: string; icon: keyof typeof Ionicons.glyphMap; color: string; onToggle?: () => void; toggleLabel?: string; onEdit: () => void; right?: React.ReactNode }) {
  return (
    <View className="flex-row items-center border-b border-neutral-100" style={{ minHeight: 40 }}>
      {onToggle ? (
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={toggleLabel} hitSlop={8} className="pr-2 py-2">
          <Ionicons name={icon} size={18} color={color} />
        </Pressable>
      ) : null}
      <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${text}`} className="flex-1 flex-row items-center py-2">
        <Text className="flex-1 text-sm text-neutral-800">{text}</Text>
        {right}
        <Ionicons name="create-outline" size={15} color="#9CA3AF" style={{ marginLeft: 8 }} />
      </Pressable>
    </View>
  );
}

function ScreenCard({ p, open, onToggle, onEditItem, onAddItem, onMove, onEditScreen }: {
  p: ScreenProgress;
  open: boolean;
  onToggle: () => void;
  onEditItem: (kind: Kind, index: number) => void;
  onAddItem: (kind: Kind) => void;
  onMove: (from: 'done' | 'pending', index: number) => void;
  onEditScreen: () => void;
}) {
  const total = p.done.length + p.pending.length;
  const pct = total ? Math.round((p.done.length / total) * 100) : 0;
  return (
    <Card className="mb-3">
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} className="flex-row items-center" style={{ minHeight: 44 }}>
        <View className="flex-1 pr-2">
          <Text className="text-md font-bold text-neutral-900">{p.screen}</Text>
          <Text className="text-xs text-neutral-500 mt-0.5" numberOfLines={1}>
            {p.done.length} done · {p.pending.length} pending · {formatDate(p.updated)}
          </Text>
          <View className="h-1.5 rounded-full bg-neutral-100 mt-2 overflow-hidden">
            <View className="h-1.5 rounded-full bg-green-600" style={{ width: `${pct}%` }} />
          </View>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#6B7280" />
      </Pressable>

      {open ? (
        <View className="mt-1">
          <Section title="Done" icon="checkmark-circle" color="#15803D" count={p.done.length} onAdd={() => onAddItem('done')}>
            {p.done.map((d, i) => (
              <Row key={`d${i}`} text={d} icon="checkmark-circle" color="#15803D" onToggle={() => onMove('done', i)} toggleLabel={`Move ${d} back to Pending`} onEdit={() => onEditItem('done', i)} />
            ))}
          </Section>

          <Section title="Pending" icon="time" color="#B45309" count={p.pending.length} onAdd={() => onAddItem('pending')}>
            {p.pending.map((d, i) => (
              <Row key={`p${i}`} text={d} icon="ellipse-outline" color="#B45309" onToggle={() => onMove('pending', i)} toggleLabel={`Mark ${d} as done`} onEdit={() => onEditItem('pending', i)} />
            ))}
          </Section>

          <Section title="Needed" icon="help-circle" color="#1D4ED8" count={p.needed.length} onAdd={() => onAddItem('needed')}>
            {p.needed.map((n, i) => (
              <Row
                key={`n${i}`}
                text={n.item}
                icon="help-circle-outline"
                color="#1D4ED8"
                onEdit={() => onEditItem('needed', i)}
                right={
                  <View className="rounded-md px-1.5 py-0.5 ml-2" style={{ backgroundColor: FROM_COLOR[n.from].bg }}>
                    <Text className="text-2xs font-bold" style={{ color: FROM_COLOR[n.from].fg }}>
                      {n.from}
                    </Text>
                  </View>
                }
              />
            ))}
          </Section>

          <Pressable onPress={onEditScreen} accessibilityRole="button" className="flex-row items-center self-start mt-3 py-1">
            <Ionicons name="create-outline" size={14} color="#6B7280" />
            <Text className="text-xs text-neutral-500 ml-1">Rename or delete this screen</Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

const KIND_LABEL: Record<Kind, string> = { done: 'Done', pending: 'Pending', needed: 'Needed' };

function EditorSheet({ editing, setEditing, onSave, onDelete }: {
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setConfirmDelete(false), [editing?.mode, editing?.screen, editing && 'index' in editing ? editing.index : null]);
  if (!editing) return null;
  const isNew = editing.mode === 'item' ? editing.index === null : editing.screen === null;
  const title = editing.mode === 'screen' ? (isNew ? 'Add screen' : 'Edit screen') : `${isNew ? 'Add to' : 'Edit'} ${KIND_LABEL[editing.kind]}`;
  const canSave = editing.text.trim().length > 0;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setEditing(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,31,51,0.35)', justifyContent: 'flex-end' }} onPress={() => setEditing(null)} accessibilityLabel="Close">
          <Pressable onPress={() => {}} className="bg-white rounded-t-2xl px-5 pt-5 pb-8">
            <Text className="text-lg font-bold text-neutral-900 mb-3">{title}</Text>
            <TextInput
              value={editing.text}
              onChangeText={(text) => setEditing({ ...editing, text })}
              placeholder={editing.mode === 'screen' ? 'Screen name, e.g. Attendance' : 'Short name, e.g. Test client login'}
              placeholderTextColor="#9CA3AF"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => canSave && onSave()}
              className="border border-neutral-200 rounded-xl px-3.5 py-3 text-base text-neutral-900"
            />
            {editing.mode === 'item' && editing.kind === 'needed' ? (
              <>
                <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mt-4 mb-2">Needed from</Text>
                <View className="flex-row flex-wrap gap-2">
                  {FROMS.map((f) => {
                    const active = editing.from === f;
                    return (
                      <Pressable
                        key={f}
                        onPress={() => setEditing({ ...editing, from: f })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        className="rounded-full px-3 py-1.5 border"
                        style={{ backgroundColor: active ? FROM_COLOR[f].bg : '#fff', borderColor: active ? FROM_COLOR[f].fg : '#E5E7EB' }}
                      >
                        <Text className="text-sm font-semibold" style={{ color: active ? FROM_COLOR[f].fg : '#6B7280' }}>
                          {f}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            <View className="flex-row items-center mt-5 gap-2">
              {!isNew ? (
                <Pressable
                  onPress={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
                  accessibilityRole="button"
                  className="flex-row items-center rounded-xl px-3.5 py-3"
                  style={{ backgroundColor: confirmDelete ? '#DC2626' : '#FEE2E2' }}
                >
                  <Ionicons name="trash-outline" size={16} color={confirmDelete ? '#fff' : '#DC2626'} />
                  <Text className="text-sm font-semibold ml-1.5" style={{ color: confirmDelete ? '#fff' : '#DC2626' }}>
                    {confirmDelete ? 'Tap again to delete' : 'Delete'}
                  </Text>
                </Pressable>
              ) : null}
              <View className="flex-1" />
              <Pressable onPress={() => setEditing(null)} accessibilityRole="button" className="rounded-xl px-4 py-3">
                <Text className="text-sm font-semibold text-neutral-500">Cancel</Text>
              </Pressable>
              <Pressable onPress={onSave} disabled={!canSave} accessibilityRole="button" className="rounded-xl px-5 py-3" style={{ backgroundColor: canSave ? '#0F1F33' : '#CBD5E1' }}>
                <Text className="text-sm font-semibold text-white">Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Shown inside the PMC Portal project (app/pmc-portal.tsx).
export function AppProgressView() {
  const [list, setList] = useState<ScreenProgress[]>(() => clone(APP_PROGRESS));
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ [APP_PROGRESS[0]?.screen ?? '']: true }));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw) as ScreenProgress[];
          if (Array.isArray(saved)) setList(saved);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const commit = useCallback((next: ScreenProgress[]) => {
    setList(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  // Applies a change to one screen and stamps today's date on it.
  function changeScreen(si: number, fn: (p: ScreenProgress) => void) {
    const next = clone(list);
    fn(next[si]);
    next[si].updated = todayKey();
    commit(next);
  }

  function move(si: number, from: 'done' | 'pending', index: number) {
    changeScreen(si, (p) => {
      const [item] = p[from].splice(index, 1);
      (from === 'done' ? p.pending : p.done).push(item);
    });
  }

  function save() {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return;
    if (editing.mode === 'screen') {
      if (editing.screen === null) {
        commit([...clone(list), { screen: text, updated: todayKey(), done: [], pending: [], needed: [] }]);
        setOpen((o) => ({ ...o, [text]: true }));
      } else {
        changeScreen(editing.screen, (p) => {
          p.screen = text;
        });
      }
    } else {
      const { screen, kind, index, from } = editing;
      changeScreen(screen, (p) => {
        if (kind === 'needed') {
          if (index === null) p.needed.push({ item: text, from });
          else p.needed[index] = { item: text, from };
        } else if (index === null) p[kind].push(text);
        else p[kind][index] = text;
      });
    }
    setEditing(null);
  }

  function remove() {
    if (!editing) return;
    if (editing.mode === 'screen') {
      if (editing.screen !== null) commit(clone(list).filter((_, i) => i !== editing.screen));
    } else if (editing.index !== null) {
      const { screen, kind, index } = editing;
      changeScreen(screen, (p) => {
        (p[kind] as unknown[]).splice(index, 1);
      });
    }
    setEditing(null);
  }

  const done = list.reduce((n, p) => n + p.done.length, 0);
  const pending = list.reduce((n, p) => n + p.pending.length, 0);

  return (
    <>
      <ScrollView className="flex-1 bg-neutral-50" contentContainerClassName="px-4 pt-4 pb-10">
        <View className="flex-row items-center mb-3">
          <Text className="flex-1 text-xs text-neutral-500" numberOfLines={1}>
            {list.length} screen{list.length === 1 ? '' : 's'} · {done} done · {pending} pending
          </Text>
          <Pressable onPress={() => setEditing({ mode: 'screen', screen: null, text: '' })} accessibilityRole="button" className="flex-row items-center rounded-lg px-2.5 py-1.5 bg-white border border-neutral-200">
            <Ionicons name="add" size={15} color="#0F1F33" />
            <Text className="text-xs font-semibold text-neutral-800 ml-0.5">Add screen</Text>
          </Pressable>
        </View>
        <Text className="text-2xs text-neutral-400 mb-3">Tap an item to edit or delete it. Tap the circle to mark it done, or the tick to move it back to pending.</Text>
        {loaded
          ? list.map((p, si) => (
              <ScreenCard
                key={`${si}-${p.screen}`}
                p={p}
                open={!!open[p.screen]}
                onToggle={() => setOpen((o) => ({ ...o, [p.screen]: !o[p.screen] }))}
                onAddItem={(kind) => setEditing({ mode: 'item', screen: si, kind, index: null, text: '', from: 'Development' })}
                onEditItem={(kind, index) =>
                  setEditing({
                    mode: 'item',
                    screen: si,
                    kind,
                    index,
                    text: kind === 'needed' ? p.needed[index].item : p[kind][index],
                    from: kind === 'needed' ? p.needed[index].from : 'Development',
                  })
                }
                onMove={(from, index) => move(si, from, index)}
                onEditScreen={() => setEditing({ mode: 'screen', screen: si, text: p.screen })}
              />
            ))
          : null}
        <Pressable
          onPress={() => {
            if (!confirmReset) return setConfirmReset(true);
            commit(clone(APP_PROGRESS));
            setConfirmReset(false);
          }}
          accessibilityRole="button"
          className="self-center mt-4 px-3 py-2"
        >
          <Text className="text-xs" style={{ color: confirmReset ? '#DC2626' : '#9CA3AF' }}>
            {confirmReset ? 'Tap again to undo all changes and reset' : 'Reset to original list'}
          </Text>
        </Pressable>
      </ScrollView>
      <EditorSheet editing={editing} setEditing={setEditing} onSave={save} onDelete={remove} />
    </>
  );
}
