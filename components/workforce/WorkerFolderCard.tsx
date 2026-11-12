import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '../ui/Card';
import {
  addWorkforceMember,
  folderStats,
  removeWorkforceMember,
  ROLE_LABEL,
  type AttendanceStatus,
  type WorkforceFolder,
  type WorkforceMember,
  type WorkforceRole,
} from '../../lib/workforce';

// One department folder: header with today's counts, then its people with
// Present / Absent buttons. `manage` adds the Add person / Remove controls
// (Attendance tab only — the DPR section just marks attendance).

function MemberRow({
  member,
  status,
  saving,
  onMark,
  onRemove,
}: {
  member: WorkforceMember;
  status: AttendanceStatus | undefined;
  saving: boolean;
  onMark: (status: AttendanceStatus | null) => void;
  onRemove?: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2 py-2.5 border-t border-neutral-100">
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-sm font-semibold text-neutral-800" numberOfLines={1}>{member.name}</Text>
          <View className={`px-1.5 py-0.5 rounded ${member.role === 'manager' ? 'bg-brand-amber/20' : 'bg-neutral-100'}`}>
            <Text className={`text-2xs font-bold ${member.role === 'manager' ? 'text-brand-navy' : 'text-neutral-500'}`}>{ROLE_LABEL[member.role]}</Text>
          </View>
        </View>
        {member.identifier ? <Text className="text-2xs text-neutral-400 mt-0.5">ID: {member.identifier}</Text> : null}
      </View>
      {saving ? <ActivityIndicator size="small" color="#0F1F33" /> : null}
      {(['present', 'absent'] as AttendanceStatus[]).map((s) => {
        const active = status === s;
        const color = s === 'present' ? '#16A34A' : '#DC2626';
        return (
          <Pressable
            key={s}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${member.name}: ${s}`}
            disabled={saving}
            onPress={() => onMark(active ? null : s)}
            className="rounded-lg px-2.5 py-1.5 border"
            style={{ backgroundColor: active ? color : '#fff', borderColor: active ? color : '#E5E5E5' }}
          >
            <Text className="text-xs font-bold" style={{ color: active ? '#fff' : '#6B7280' }}>{s === 'present' ? 'P' : 'A'}</Text>
          </Pressable>
        );
      })}
      {onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${member.name}`} onPress={onRemove} hitSlop={8} className="pl-1">
          <Ionicons name="trash-outline" size={16} color="#9CA3AF" />
        </Pressable>
      ) : null}
    </View>
  );
}

function AddPersonForm({ folderId, onAdded, onCancel }: { folderId: string; onAdded: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState<WorkforceRole>('worker');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!name.trim()) {
      setError('Enter a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addWorkforceMember(folderId, name, identifier, role);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="mt-2 rounded-lg bg-neutral-50 border border-neutral-100 p-2.5 gap-2">
      <TextInput value={name} onChangeText={setName} placeholder="Name" className="border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white" />
      <TextInput value={identifier} onChangeText={setIdentifier} placeholder="ID (e.g. CIV-06 or phone)" className="border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white" />
      <View className="flex-row gap-2">
        {(['worker', 'manager'] as WorkforceRole[]).map((r) => (
          <Pressable
            key={r}
            onPress={() => setRole(r)}
            className="flex-1 items-center rounded-lg py-2 border"
            style={{ backgroundColor: role === r ? '#0F1F33' : '#fff', borderColor: role === r ? '#0F1F33' : '#E5E5E5' }}
          >
            <Text className="text-xs font-bold" style={{ color: role === r ? '#fff' : '#374151' }}>{ROLE_LABEL[r]}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text className="text-xs text-red-600">{error}</Text> : null}
      <View className="flex-row justify-end gap-2">
        <Pressable onPress={onCancel} disabled={saving} className="px-3 py-1.5 rounded-lg bg-neutral-100">
          <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
        </Pressable>
        <Pressable onPress={handleAdd} disabled={saving} className="px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
          {saving ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text className="text-xs font-semibold text-white">Add person</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function WorkerFolderCard({
  folder,
  marks,
  savingIds,
  onMark,
  manage = false,
  onChanged,
  defaultOpen = true,
}: {
  folder: WorkforceFolder;
  marks: Record<string, AttendanceStatus>;
  savingIds: Set<string>;
  onMark: (memberId: string, status: AttendanceStatus | null) => void;
  manage?: boolean;
  onChanged?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [adding, setAdding] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const s = folderStats(folder, marks);
  const pct = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;

  async function handleRemove(member: WorkforceMember) {
    setRemoveError(null);
    try {
      await removeWorkforceMember(member.id);
      onChanged?.();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Card className="mb-3">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} className="flex-row items-center gap-2">
        <Ionicons name={open ? 'folder-open-outline' : 'folder-outline'} size={18} color="#0F1F33" />
        <View className="flex-1">
          <Text className="text-sm font-bold text-neutral-900">{folder.workName}</Text>
          <Text className="text-2xs text-neutral-400 mt-0.5">
            {s.total} {s.total === 1 ? 'person' : 'people'} · {s.present} present · {s.absent} absent · {s.unmarked} not marked
          </Text>
        </View>
        {s.total > 0 ? (
          <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: pct >= 90 ? '#DCFCE7' : pct >= 70 ? '#FEF3C7' : '#F5F5F5' }}>
            <Text className="text-2xs font-bold" style={{ color: pct >= 90 ? '#15803D' : pct >= 70 ? '#B45309' : '#6B7280' }}>{pct}%</Text>
          </View>
        ) : null}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
      </Pressable>

      {open && (
        <View className="mt-2">
          {folder.members.length === 0 ? (
            <Text className="text-xs text-neutral-400 py-2">No people in this folder yet.</Text>
          ) : (
            folder.members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                status={marks[m.id]}
                saving={savingIds.has(m.id)}
                onMark={(st) => onMark(m.id, st)}
                onRemove={manage ? () => void handleRemove(m) : undefined}
              />
            ))
          )}
          {removeError ? <Text className="text-xs text-red-600 mt-1">{removeError}</Text> : null}
          {manage &&
            (adding ? (
              <AddPersonForm
                folderId={folder.id}
                onCancel={() => setAdding(false)}
                onAdded={() => {
                  setAdding(false);
                  onChanged?.();
                }}
              />
            ) : (
              <Pressable onPress={() => setAdding(true)} className="mt-2 flex-row items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 py-2">
                <Ionicons name="person-add-outline" size={14} color="#0F1F33" />
                <Text className="text-xs font-bold text-brand-navy">Add person</Text>
              </Pressable>
            ))}
        </View>
      )}
    </Card>
  );
}
