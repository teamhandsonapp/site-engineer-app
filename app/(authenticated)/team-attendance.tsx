import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { fetchTeamAttendanceSummary, type EngineerAttendanceSummary } from '../../lib/attendanceReview';
import { useAttendanceRealtime } from '../../lib/attendanceRealtime';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { formatTime12h } from '../../lib/formatTime';

function timeOnly(d: Date | null): string {
  return d ? formatTime12h(d) : '';
}

function scoreColor(score: number): { bg: string; text: string } {
  if (score >= 85) return { bg: '#DCFCE7', text: '#166534' };
  if (score >= 65) return { bg: '#FEF9C3', text: '#854D0E' };
  return { bg: '#FEE2E2', text: '#991B1B' };
}

// Live-status badge — mirrors admin-web's LiveStatusBadge exactly (same
// UserProfile.trackingStatus field, same three states), just as an RN
// component instead of a Next.js one.
function LiveStatusChip({ summary }: { summary: EngineerAttendanceSummary }) {
  if (!summary.isCurrentlyClockedIn) {
    return (
      <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-100">
        <View className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
        <Text className="text-2xs font-semibold text-neutral-500">Off shift</Text>
      </View>
    );
  }
  if (summary.liveTrackingStatus === 'degraded') {
    return (
      <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50">
        <View className="w-1.5 h-1.5 rounded-full bg-red-500" />
        <Text className="text-2xs font-semibold text-red-700">Tracking degraded</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50">
      <View className="w-1.5 h-1.5 rounded-full bg-green-500" />
      <Text className="text-2xs font-semibold text-green-700">On site · {timeOnly(summary.todayCheckInTime)}</Text>
    </View>
  );
}

function EngineerRow({ summary }: { summary: EngineerAttendanceSummary }) {
  const c = scoreColor(summary.averageScore);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/team-attendance-detail/[userId]', params: { userId: summary.userId, fullName: summary.fullName } })}
    >
      <Card className="mb-2.5">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-sm font-bold text-neutral-900 flex-1" numberOfLines={1}>{summary.fullName}</Text>
          <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: c.bg }}>
            <Text className="text-xs font-bold" style={{ color: c.text }}>{summary.averageScore}</Text>
          </View>
        </View>
        <View className="flex-row items-center justify-between">
          <LiveStatusChip summary={summary} />
          <Text className="text-2xs text-neutral-400">
            {summary.absentDays} absent · {summary.lateDays} late
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

// Admin/manager review of the whole team's attendance — reuses the SAME
// underlying data (attendance_records, geofence/zone alerts,
// trackingStatus) and score formula (lib/attendanceReview.ts) as
// admin-web's own /attendance/scorecard, just natively on mobile. The
// field role's own Attendance screen (check-in/out button) stays a
// completely separate route — see DrawerContent.tsx's own
// FIELD_ROLE_ONLY_ROUTES / ADMIN_MANAGER_ONLY_ROUTES split.
export default function TeamAttendanceScreen() {
  const { state } = useAuth();
  const isAdminOrManager = state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');
  const { selectedProjectId } = useProject();

  const [summaries, setSummaries] = useState<EngineerAttendanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSummaries(await fetchTeamAttendanceSummary(selectedProjectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedProjectId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Live updates — a check-in/out, location-off episode, or zone entry
  // anywhere on this project (or anywhere at all, if no project is
  // selected) refetches this list so status/hours never sit stale until a
  // manual pull-to-refresh.
  useAttendanceRealtime(load, { projectId: selectedProjectId });

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!isAdminOrManager) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  const sorted = [...summaries].sort((a, b) => a.averageScore - b.averageScore);

  return (
    <View className="flex-1 bg-neutral-50">
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="px-4 pt-4 pb-8"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
        >
          {error && (
            <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-4">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          )}
          <Text className="text-xs text-neutral-400 mb-3">
            Rolling 30-day attendance score{selectedProjectId ? ' for this project' : ' across all projects'}. Lowest scores first.
          </Text>
          {sorted.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No site engineers found"
              subtitle={selectedProjectId ? 'No engineers are assigned to this project yet.' : 'No site engineer accounts exist yet.'}
            />
          ) : (
            sorted.map((s) => <EngineerRow key={s.userId} summary={s} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}
