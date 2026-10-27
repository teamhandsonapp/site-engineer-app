import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { isFieldRole, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { addDaysToKey, fetchCompletedDprTasks, todayDateKey, type DprTask } from '../../lib/dprEntries';

// Point 6 — a separate, read-only tab from the DPR form itself, not a
// section inside it. Default window is the last 7 days (real
// actual_end_date, not a guessed/cached flag) — confirmed with the user
// as the default scope since nothing elsewhere in the app specifies one.
const COMPLETED_WINDOW_DAYS = 7;

function CompletedTaskRow({ task }: { task: DprTask }) {
  return (
    <View className="py-2.5 border-b border-neutral-100">
      <Text className="text-xs font-semibold text-neutral-800">{task.taskCode} — {task.taskName}</Text>
      <View className="flex-row items-center justify-between mt-0.5">
        <Text className="text-2xs text-neutral-400">{task.workName}</Text>
        <Text className="text-2xs font-semibold text-green-700">Completed {task.plannedEndDate}</Text>
      </View>
    </View>
  );
}

export default function CompletedTasksScreen() {
  const { state } = useAuth();
  const isFieldEngineer = state.status === 'signed-in' && isFieldRole(state.profile.role);
  const { selectedProjectId } = useProject();

  const [tasks, setTasks] = useState<DprTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProjectId) {
      setTasks([]);
      return;
    }
    try {
      setError(null);
      const sinceKey = addDaysToKey(todayDateKey(), -COMPLETED_WINDOW_DAYS);
      setTasks(await fetchCompletedDprTasks(selectedProjectId, sinceKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedProjectId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!isFieldEngineer || state.status !== 'signed-in') {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-xs text-neutral-500">Tasks marked Completed in the last {COMPLETED_WINDOW_DAYS} days.</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="px-4 pb-8 flex-grow"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
        >
          {error && (
            <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-4">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          )}

          {!selectedProjectId ? (
            <EmptyState icon="checkmark-done-outline" iconColor="#9CA3AF" title="No project selected" />
          ) : tasks.length === 0 ? (
            <EmptyState icon="checkmark-done-outline" iconColor="#9CA3AF" title="Nothing completed recently" subtitle={`No tasks marked Completed in the last ${COMPLETED_WINDOW_DAYS} days.`} />
          ) : (
            <Card>
              {tasks.map((task) => (
                <CompletedTaskRow key={task.id} task={task} />
              ))}
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}
