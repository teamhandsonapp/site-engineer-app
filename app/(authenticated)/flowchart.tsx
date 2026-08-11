import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchFlowchartData, type FlowchartData } from '../../lib/flowchart/data';
import { FlowchartCanvas } from '../../components/flowchart/FlowchartCanvas';
import { PhaseCompletionBar } from '../../components/flowchart/PhaseCompletionBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { withTimeout } from '../../lib/withTimeout';

const FETCH_TIMEOUT_MS = 12_000;

// Which project this shows is no longer this screen's own concern — it
// reads the single shared selection from ProjectContext (set on App Home /
// Project Dashboard) instead of fetching its own project list and showing
// its own picker chips, same re-plumbing as Gantt.
export default function FlowchartScreen() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isStaff = profile ? appRoleFor(profile.role) === 'staff' : false;
  const { selectedProjectId } = useProject();

  const [data, setData] = useState<FlowchartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (projectId: string) => {
    try {
      setError(null);
      setData(await withTimeout(fetchFlowchartData(projectId), FETCH_TIMEOUT_MS, "Couldn't reach the server — check your connection and try again."));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    load(selectedProjectId).finally(() => setLoading(false));
  }, [selectedProjectId, load]);

  function retry() {
    if (selectedProjectId) load(selectedProjectId);
  }

  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  if (!selectedProjectId) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <EmptyState
          icon="briefcase-outline"
          iconColor="#9CA3AF"
          title={isStaff ? 'No project selected' : 'No project assigned'}
          subtitle={
            isStaff
              ? 'Pick a project from Home to see its flowchart.'
              : "Your account isn't linked to a project yet. Contact your PMC office to get this set up."
          }
        />
        {isStaff && (
          <Pressable onPress={() => router.push('/home')} className="mt-4 px-4 py-2 rounded-lg bg-brand-navy">
            <Text className="text-xs font-semibold text-white">Go to Home</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {error && (
        <View className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
          <Pressable onPress={retry} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : !data || data.tasks.length === 0 ? (
        <EmptyState
          icon="git-network-outline"
          iconColor="#9CA3AF"
          title="No tasks yet"
          subtitle="This project doesn't have any tasks to chart yet."
        />
      ) : (
        <>
          <PhaseCompletionBar tasks={data.tasks} seriesEdges={data.seriesEdges} />
          <FlowchartCanvas
            projectId={selectedProjectId}
            initialTasks={data.tasks}
            seriesEdges={data.seriesEdges}
            parallelEdges={data.parallelEdges}
            taskTypes={data.taskTypes}
            canEdit={isStaff}
          />
        </>
      )}
    </View>
  );
}
