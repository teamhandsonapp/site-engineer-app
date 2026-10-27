import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchProjectEngineers, type ProjectEngineer } from '../../lib/criticalAlertMessages';

// The flowchart's multi-select "Push to Site Engineer" — same recipient
// picker as ComposeCriticalAlertModal's own admin mode (fetchProjectEngineers:
// site_engineer/senior_site_engineer accounts actually assigned to this
// project via project_users), reused rather than a second copy.
export function PushToEngineerModal({
  visible,
  projectId,
  taskCount,
  pushing,
  onPush,
  onClose,
}: {
  visible: boolean;
  projectId: string;
  taskCount: number;
  pushing: boolean;
  onPush: (engineerId: string) => void;
  onClose: () => void;
}) {
  const [engineers, setEngineers] = useState<ProjectEngineer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSelectedId(null);
    setError(null);
    setLoading(true);
    fetchProjectEngineers(projectId)
      .then(setEngineers)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [visible, projectId]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4 w-full" style={{ maxWidth: 380, maxHeight: '75%' }}>
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-md font-bold text-neutral-900">Push to Site Engineer</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#9CA3AF" />
            </Pressable>
          </View>
          <Text className="text-xs text-neutral-400 mb-3">
            {taskCount} task{taskCount === 1 ? '' : 's'} selected — the engineer you pick will see {taskCount === 1 ? 'it' : 'them'} under DPR&apos;s own Urgent tab, regardless of the scheduled date.
          </Text>

          {loading ? (
            <ActivityIndicator color="#0F1F33" />
          ) : error ? (
            <Text className="text-xs text-red-600">{error}</Text>
          ) : engineers.length === 0 ? (
            <Text className="text-xs text-neutral-400">No engineers assigned to this project yet.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 220 }} className="mb-3">
              {engineers.map((eng) => {
                const active = eng.id === selectedId;
                return (
                  <Pressable
                    key={eng.id}
                    onPress={() => setSelectedId(eng.id)}
                    className={`flex-row items-center justify-between px-3 py-2.5 rounded-lg mb-1 ${active ? 'bg-neutral-100' : ''}`}
                  >
                    <Text className="text-sm font-medium text-neutral-800">{eng.fullName}</Text>
                    {active && <Ionicons name="checkmark-circle" size={16} color="#0F1F33" />}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <Pressable
            onPress={() => selectedId && onPush(selectedId)}
            disabled={!selectedId || pushing}
            className="flex-row items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-navy"
            style={{ opacity: !selectedId || pushing ? 0.4 : 1 }}
          >
            {pushing && <ActivityIndicator color="#fff" size="small" />}
            <Text className="text-sm font-bold text-white">{pushing ? 'Pushing…' : 'Push'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
