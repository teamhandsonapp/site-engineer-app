import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchProjectTimeline, type ProjectTimelineData } from '../../lib/projectTimeline';
import { GanttChart } from '../../components/gantt/GanttChart';
import { HatchStripe } from '../../components/gantt/HatchStripe';
import { EmptyState } from '../../components/ui/EmptyState';
import { ZOOM_LEVELS, type ZoomLevel } from '../../lib/ganttLayout';
import { withTimeout } from '../../lib/withTimeout';

const FETCH_TIMEOUT_MS = 12_000;

const EMPTY_TIMELINE: ProjectTimelineData = { works: [], delayById: {}, groundedIds: new Set(), taskTypeColors: {} };

// Same 3-item bar-type legend as admin-web's GanttBoard.tsx (Planned /
// Projected-actual / Behind plan) — not a task-status legend, which
// admin-web itself doesn't show as a standalone legend either (status
// colors only ever appear inline, on the projected bar itself and the
// left-panel status pill).

// Which project this shows is no longer this screen's own concern — it
// reads the single shared selection from ProjectContext (set on App Home /
// Project Dashboard) instead of fetching its own project list and showing
// its own picker chips, same re-plumbing as Flowchart.
export default function GanttScreen() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isStaff = profile ? appRoleFor(profile.role) === 'staff' : false;
  const { selectedProjectId } = useProject();

  const [timeline, setTimeline] = useState<ProjectTimelineData>(EMPTY_TIMELINE);
  const [zoom, setZoom] = useState<ZoomLevel>('Week');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (projectId: string) => {
    try {
      setError(null);
      setTimeline(await withTimeout(fetchProjectTimeline(projectId), FETCH_TIMEOUT_MS, "Couldn't reach the server — check your connection and try again."));
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

  // Gantt data isn't realtime-subscribed (unlike the alerts lists) — this
  // is the one manual way to confirm you're seeing the latest planned
  // dates/statuses without leaving and re-entering the screen.
  async function onRefresh() {
    if (!selectedProjectId) return;
    setRefreshing(true);
    await load(selectedProjectId);
    setRefreshing(false);
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
      <View className="border-b border-neutral-100 px-4 pt-3 pb-2.5 gap-2.5">
        <View className="flex-row items-center justify-between">
          <View className="flex-row gap-1.5">
            {ZOOM_LEVELS.map((level) => {
              const active = level === zoom;
              return (
                <Pressable
                  key={level}
                  onPress={() => setZoom(level)}
                  className={`px-3 py-1.5 rounded-full ${active ? 'bg-brand-amber' : 'bg-neutral-100'}`}
                >
                  <Text className={`text-xs font-semibold ${active ? 'text-brand-amber-deep' : 'text-neutral-600'}`}>{level}</Text>
                </Pressable>
              );
            })}
          </View>
          <View className="flex-row gap-2.5">
            <View className="flex-row items-center gap-1">
              <View className="w-2.5 h-2 rounded-sm" style={{ backgroundColor: '#9CA3AF99' }} />
              <Text className="text-2xs text-neutral-400">Planned</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <View className="w-2.5 h-2 rounded-sm bg-emerald-500" />
              <Text className="text-2xs text-neutral-400">Projected / actual</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <HatchStripe width={10} height={8} />
              <Text className="text-2xs text-neutral-400">Behind plan</Text>
            </View>
          </View>
        </View>
      </View>

      {error && (
        <View className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
          <Pressable
            onPress={retry}
            className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200"
          >
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <GanttChart
          works={timeline.works}
          delayById={timeline.delayById}
          groundedIds={timeline.groundedIds}
          taskTypeColors={timeline.taskTypeColors}
          zoom={zoom}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}
    </View>
  );
}
