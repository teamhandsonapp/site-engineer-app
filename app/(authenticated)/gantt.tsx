import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from '../../components/ui/AppText';
import { router } from 'expo-router';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchFlowchartData, type FlowchartData } from '../../lib/flowchart/data';
import { GanttView } from '../../components/flowchart/GanttView';
import { EmptyState } from '../../components/ui/EmptyState';
import { withTimeout } from '../../lib/withTimeout';

const FETCH_TIMEOUT_MS = 12_000;

// "Gantt Chart" page (Project Dashboard → Gantt Chart). Since 2026-11-18 it
// shows the new Flowchart 2 Gantt (components/flowchart/GanttView.tsx, the
// same chart as Flowchart → Flowchart 2 → Gantt View): planned line, actual +
// projected bars, reasons for delay and links. The old Week/Month/Day chart
// (components/gantt/GanttChart.tsx) is no longer shown here.
// The project comes from the shared selection (ProjectContext).
export default function GanttScreen() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isStaff = profile ? appRoleFor(profile.role) === 'staff' : false;
  const { selectedProjectId, projects } = useProject();
  const projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? 'Project';

  const [data, setData] = useState<FlowchartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (projectId: string) => {
    try {
      setError(null);
      setData(await withTimeout(fetchFlowchartData(projectId, 'fc2'), FETCH_TIMEOUT_MS, "Couldn't reach the server — check your connection and try again."));
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
    if (!selectedProjectId) return;
    setLoading(true);
    load(selectedProjectId).finally(() => setLoading(false));
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
              ? 'Pick a project from Home to see its Gantt chart.'
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
        error ? null : (
          <EmptyState
            icon="calendar-outline"
            iconColor="#9CA3AF"
            title="No tasks yet"
            subtitle="This project doesn't have any Current Status tasks to show on the Gantt chart yet."
          />
        )
      ) : (
        <GanttView tasks={data.tasks} allTasks={data.tasks} seriesEdges={data.seriesEdges} projectName={projectName} filterText="" />
      )}
    </View>
  );
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
