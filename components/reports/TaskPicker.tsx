import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import type { ProjectTaskOption } from '../../lib/reports/taskList';

// Trigger card + bottom-sheet modal, matching CalendarPicker.tsx's own
// transparent-fade-backdrop + inner no-op-Pressable-card idiom. Filtering is
// entirely client-side (this project's task count is small), capped at 50
// displayed results — same cap admin-web's own TaskPicker uses.
interface TaskPickerProps {
  options: ProjectTaskOption[];
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
}

const MAX_RESULTS = 50;

export function TaskPicker({ options, selectedTaskId, onSelect }: TaskPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((o) => o.id === selectedTaskId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? options
      : options.filter(
          (o) => o.taskCode.toLowerCase().includes(q) || o.taskName.toLowerCase().includes(q) || o.workName.toLowerCase().includes(q)
        );
    return base.slice(0, MAX_RESULTS);
  }, [options, query]);

  return (
    <>
      <Pressable onPress={() => setOpen(true)}>
        <Card className="mb-3 flex-row items-center justify-between">
          <View className="flex-1 pr-2">
            <Text className="text-2xs font-semibold uppercase tracking-wide text-neutral-400 mb-0.5">Task</Text>
            {selected ? (
              <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>
                {selected.taskCode} — {selected.taskName}
              </Text>
            ) : (
              <Text className="text-sm text-neutral-400">Select a task to generate its report</Text>
            )}
          </View>
          <Ionicons name="chevron-down" size={18} color="#9CA3AF" />
        </Card>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/40 justify-end" onPress={() => setOpen(false)}>
          <Pressable onPress={() => {}} className="bg-white rounded-t-2xl" style={{ maxHeight: '80%' }}>
            <View className="p-4 border-b border-neutral-100">
              <Text className="text-md font-bold text-neutral-900 mb-3">Select a task</Text>
              <View className="flex-row items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2">
                <Ionicons name="search-outline" size={16} color="#9CA3AF" />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search by task or work..."
                  className="flex-1 text-sm text-neutral-900"
                  autoFocus
                />
              </View>
            </View>
            <ScrollView contentContainerClassName="p-2 pb-6">
              {filtered.length === 0 ? (
                <Text className="text-center text-sm text-neutral-400 py-8">No matching tasks</Text>
              ) : (
                filtered.map((o) => (
                  <Pressable
                    key={o.id}
                    onPress={() => {
                      onSelect(o.id);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="px-3 py-3 rounded-xl"
                    style={{ backgroundColor: o.id === selectedTaskId ? 'rgba(240,162,39,0.14)' : 'transparent' }}
                  >
                    <Text className="text-sm font-semibold text-neutral-800">
                      {o.taskCode} — {o.taskName}
                    </Text>
                    <Text className="text-xs text-neutral-400 mt-0.5">{o.workName}</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
