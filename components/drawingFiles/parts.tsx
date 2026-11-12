import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from '../ui/AppText';
import { colors, radius, space } from '../../lib/theme';
import type { Department } from '../../lib/departments';
import {
  createLocation,
  locationChain,
  type DrawingKind,
  type PickerTask,
  type ProjectLocation,
} from '../../lib/drawingFiles';

// Small building blocks shared by the drawing upload sheet, the File Manager
// drawings browser, the file detail and the task "Drawings" section.

export const KIND_ICON: Record<DrawingKind, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  pdf: { icon: 'document-text', color: '#DC2626', label: 'PDF' },
  dwg: { icon: 'cube-outline', color: '#1D4ED8', label: 'DWG' },
  image: { icon: 'image', color: '#15803D', label: 'IMG' },
  other: { icon: 'document-outline', color: colors.textMuted, label: 'FILE' },
};

export function KindBadge({ kind, size = 36 }: { kind: DrawingKind; size?: number }) {
  const k = KIND_ICON[kind];
  return (
    <View style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: `${k.color}14`, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={k.icon} size={size * 0.5} color={k.color} />
      <Text style={{ fontSize: 9, fontWeight: '700', color: k.color, marginTop: -1 }}>{k.label}</Text>
    </View>
  );
}

export function SectionLabel({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <View className="flex-row items-end justify-between mb-2">
      <View className="flex-1">
        <Text className="text-sm font-bold text-neutral-900">{title}</Text>
        {hint ? <Text className="text-2xs text-neutral-500 mt-0.5">{hint}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  color,
  icon,
  dashed,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  dashed?: boolean;
}) {
  const tint = color ?? colors.navy;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: selected ? tint : colors.borderStrong,
        backgroundColor: selected ? tint : colors.surface,
      }}
    >
      {icon ? <Ionicons name={icon} size={14} color={selected ? '#fff' : tint} /> : null}
      <Text style={{ fontSize: 13, fontWeight: '600', color: selected ? '#fff' : colors.text }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── "Where?" — floor / room / wall tap chips ───────────────────────────

function AddChip({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <Chip label="Add" icon="add" dashed onPress={() => setOpen(true)} />;
  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await onAdd(name);
      setName('');
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ width: '100%' }}>
      <View className="flex-row items-center gap-2">
        <TextInput
          autoFocus
          value={name}
          onChangeText={setName}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
          style={{ flex: 1, minHeight: 40, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: 10, fontSize: 14, color: colors.text, backgroundColor: colors.surface }}
        />
        <Pressable onPress={() => void submit()} disabled={busy || !name.trim()} style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: name.trim() ? colors.navy : colors.borderStrong, justifyContent: 'center' }}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Add</Text>}
        </Pressable>
        <Pressable onPress={() => { setOpen(false); setErr(null); }} hitSlop={8} accessibilityLabel="Cancel">
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
      {err ? <Text className="text-2xs mt-1" style={{ color: colors.danger }}>{err}</Text> : null}
    </View>
  );
}

const LEVEL_LABEL = { floor: 'Floor', room: 'Room', wall: 'Wall' } as const;

export function LocationChips({
  projectId,
  userId,
  locations,
  value,
  onChange,
  onLocationAdded,
  recentIds = [],
  canAdd = true,
}: {
  projectId: string;
  userId: string | null;
  locations: ProjectLocation[];
  value: string | null;
  onChange: (id: string | null) => void;
  onLocationAdded: (l: ProjectLocation) => void;
  recentIds?: string[];
  canAdd?: boolean;
}) {
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const chain = locationChain(byId, value);
  const childrenOf = (parentId: string | null) => locations.filter((l) => l.parentId === parentId);
  const recent = recentIds.filter((id) => byId.has(id) && id !== value);

  // Rows: floors, then rooms of the chosen floor, then walls of the chosen room.
  const rows: { parent: ProjectLocation | null; level: 'floor' | 'room' | 'wall'; selectedId: string | null }[] = [
    { parent: null, level: 'floor', selectedId: chain[0]?.id ?? null },
  ];
  if (chain[0]) rows.push({ parent: chain[0], level: 'room', selectedId: chain[1]?.id ?? null });
  if (chain[1]) rows.push({ parent: chain[1], level: 'wall', selectedId: chain[2]?.id ?? null });

  return (
    <View>
      {/* Breadcrumb of the current choice; each level can be cleared. */}
      <View className="flex-row flex-wrap items-center mb-2" style={{ gap: 4, minHeight: 28 }}>
        <Ionicons name="location-outline" size={14} color={colors.navy} />
        {chain.length === 0 ? (
          <Text className="text-xs text-neutral-500">No location (optional)</Text>
        ) : (
          chain.map((l, i) => (
            <View key={l.id} className="flex-row items-center" style={{ gap: 4 }}>
              {i > 0 ? <Ionicons name="chevron-forward" size={12} color={colors.textMuted} /> : null}
              <Pressable onPress={() => onChange(l.id)} disabled={i === chain.length - 1}>
                <Text className="text-xs font-bold" style={{ color: i === chain.length - 1 ? colors.text : colors.info }}>{l.name}</Text>
              </Pressable>
            </View>
          ))
        )}
        {chain.length > 0 ? (
          <Pressable onPress={() => onChange(chain.length > 1 ? chain[chain.length - 2].id : null)} hitSlop={8} accessibilityLabel="Clear last level" style={{ marginLeft: 6 }}>
            <Text className="text-2xs font-bold" style={{ color: colors.danger }}>Clear {LEVEL_LABEL[chain[chain.length - 1].level].toLowerCase()}</Text>
          </Pressable>
        ) : null}
      </View>

      {recent.length > 0 ? (
        <View className="mb-2">
          <Text className="text-2xs font-semibold text-neutral-500 mb-1">Recent</Text>
          <View className="flex-row flex-wrap" style={{ gap: space.xs }}>
            {recent.map((id) => (
              <Chip key={id} label={locationChain(byId, id).map((l) => l.name).join(' › ')} icon="time-outline" onPress={() => onChange(id)} />
            ))}
          </View>
        </View>
      ) : null}

      {rows.map((row) => {
        const options = childrenOf(row.parent?.id ?? null);
        return (
          <View key={row.level} className="mb-2">
            <Text className="text-2xs font-semibold text-neutral-500 mb-1">
              {LEVEL_LABEL[row.level]}
              {row.parent ? ` in ${row.parent.name}` : ''}
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: space.xs }}>
              {options.map((o) => (
                <Chip
                  key={o.id}
                  label={o.name}
                  selected={row.selectedId === o.id}
                  onPress={() => onChange(row.selectedId === o.id ? (row.parent?.id ?? null) : o.id)}
                />
              ))}
              {options.length === 0 && !canAdd ? <Text className="text-2xs text-neutral-400">None yet</Text> : null}
              {canAdd ? (
                <AddChip
                  placeholder={`New ${LEVEL_LABEL[row.level].toLowerCase()} name`}
                  onAdd={async (name) => {
                    const created = await createLocation(projectId, row.parent, name, userId, options.length);
                    onLocationAdded(created);
                    onChange(created.id);
                  }}
                />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Department tiles ───────────────────────────────────────────────────

export function DepartmentTiles({
  departments,
  value,
  onChange,
  counts,
}: {
  departments: Department[];
  value: string | null;
  onChange: (id: string) => void;
  counts?: Map<string, number>;
}) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: space.sm }}>
      {departments.map((d) => {
        const selected = value === d.id;
        return (
          <Pressable
            key={d.id}
            onPress={() => onChange(d.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              flexBasis: '31%',
              flexGrow: 1,
              minHeight: 56,
              padding: 10,
              borderRadius: radius.md,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? d.color : colors.border,
              backgroundColor: selected ? `${d.color}1A` : colors.surface,
              justifyContent: 'center',
            }}
          >
            <View className="flex-row items-center" style={{ gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: d.color }} />
              <Text className="text-xs font-bold text-neutral-900 flex-1" numberOfLines={2}>
                {d.name}
              </Text>
              {selected ? <Ionicons name="checkmark-circle" size={16} color={d.color} /> : null}
            </View>
            {counts ? <Text className="text-2xs text-neutral-500 mt-1">{counts.get(d.id) ?? 0} files</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Task picker (department-filtered, multi-select) ────────────────────

const STATUS_COLOR: Record<string, string> = {
  completed: colors.success,
  in_progress: colors.info,
  blocked: colors.danger,
  not_started: colors.textMuted,
};

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })}`;
}

export function TaskPickerList({
  tasks,
  loading,
  selected,
  onToggle,
  emptyText,
}: {
  tasks: PickerTask[];
  loading: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyText: string;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? tasks.filter((t) => t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) : tasks;
  if (loading) return <ActivityIndicator color={colors.navy} style={{ marginVertical: 12 }} />;
  if (tasks.length === 0) return <Text className="text-xs text-neutral-500 py-2">{emptyText}</Text>;
  return (
    <View>
      {tasks.length > 5 ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search tasks"
          placeholderTextColor={colors.placeholder}
          style={{ minHeight: 40, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, marginBottom: 8, fontSize: 14, color: colors.text, backgroundColor: colors.surfaceMuted }}
        />
      ) : null}
      {shown.map((t) => {
        const on = selected.has(t.id);
        return (
          <Pressable
            key={t.id}
            onPress={() => onToggle(t.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            className="flex-row items-center py-2.5 border-b border-neutral-100"
            style={{ gap: 10 }}
          >
            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.navy : colors.borderStrong} />
            <View className="flex-1">
              <Text className="text-xs font-bold text-neutral-900" numberOfLines={2}>
                {t.name}
              </Text>
              <Text className="text-2xs text-neutral-500 mt-0.5">
                {t.code} · {shortDate(t.startISO)} – {shortDate(t.dueISO)}
              </Text>
            </View>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: `${STATUS_COLOR[t.status] ?? colors.textMuted}1A` }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: STATUS_COLOR[t.status] ?? colors.textMuted }}>{t.status.replace(/_/g, ' ')}</Text>
            </View>
          </Pressable>
        );
      })}
      {shown.length === 0 ? <Text className="text-xs text-neutral-500 py-2">No task matches “{query}”.</Text> : null}
    </View>
  );
}
