import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { DayTimelineView, type DayTimelineViewHandle } from '../../components/DayTimelineView';
import { isFieldRole, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';

// Sections 1-2 — the map trail and the chronological checklist, on one
// screen sharing one fetch (lib/dayTimeline.ts's fetchDayTimeline via the
// shared DayTimelineView, also used by admin/manager's own per-engineer
// detail view for Section 4.1/4.2). Field-role only, same gate as
// attendance.tsx — this is an engineer's view of their OWN day.
export default function DayTimelineScreen() {
  const { state } = useAuth();
  const isField = state.status === 'signed-in' && isFieldRole(state.profile.role);
  const { selectedProjectId } = useProject();
  const [refreshing, setRefreshing] = useState(false);
  const viewRef = useRef<DayTimelineViewHandle>(null);

  if (!isField || state.status !== 'signed-in') {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  async function onRefresh() {
    setRefreshing(true);
    await viewRef.current?.refresh();
    setRefreshing(false);
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <ScrollView
        contentContainerClassName="px-4 pt-4 pb-8"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
      >
        <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Today&apos;s activity</Text>
        <DayTimelineView ref={viewRef} userId={state.profile.id} projectId={selectedProjectId} />
      </ScrollView>
    </View>
  );
}
