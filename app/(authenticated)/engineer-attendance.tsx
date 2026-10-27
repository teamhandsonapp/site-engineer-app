import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { fetchTeamAttendanceSummary, type EngineerAttendanceSummary } from '../../lib/attendanceReview';
import { useAttendanceRealtime } from '../../lib/attendanceRealtime';
import { Card } from '../../components/ui/Card';
import { buildDemoSummaries, DEMO_ATTENDANCE_PROJECT_ID } from '../../lib/demoAttendance';
import { EmptyState } from '../../components/ui/EmptyState';
import { PulsingDot } from '../../components/ui/PulsingDot';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchProjectSettings } from '../../lib/projectSettings';
import { computeTrackingHealth, type TrackingHealthLevel } from '../../lib/trackingHealth';

function scoreColor(score: number): { bg: string; text: string } {
  if (score >= 85) return { bg: '#DCFCE7', text: '#166534' };
  if (score >= 65) return { bg: '#FEF9C3', text: '#854D0E' };
  return { bg: '#FEE2E2', text: '#991B1B' };
}

const HEALTH_STYLE: Record<TrackingHealthLevel, { bg: string; dot: string; text: string }> = {
  green: { bg: 'bg-green-50', dot: '#16A34A', text: 'text-green-700' },
  red: { bg: 'bg-red-50', dot: '#DC2626', text: 'text-red-700' },
  grey: { bg: 'bg-neutral-100', dot: '#D4D4D4', text: 'text-neutral-500' },
};

// Live-status badge — now shows the SAME real tracking health regardless of
// check-in state (previously this collapsed straight to a generic grey "Off
// shift" for anyone not currently clocked in, hiding exactly the
// information that surfaced Prashuramu's background-killed Oppo: tracking
// is meant to run independent of check-in, so "not checked in" and "should
// be tracking but silently isn't" need to look different, not identical).
// See lib/trackingHealth.ts for the shared reason classification both this
// list and the per-engineer detail screen render from.
function LiveStatusChip({
  summary,
  shiftStartMinutes,
  nowMs,
}: {
  summary: EngineerAttendanceSummary;
  shiftStartMinutes: number | null;
  nowMs: number;
}) {
  const health = computeTrackingHealth({
    userId: summary.userId,
    isLocked: summary.isLocked,
    liveTrackingStatus: summary.liveTrackingStatus,
    liveTrackingStatusReason: summary.liveTrackingStatusReason,
    liveTrackingStatusAt: summary.liveTrackingStatusAt,
    isCurrentlyClockedIn: summary.isCurrentlyClockedIn,
    todayCheckInTime: summary.todayCheckInTime,
    shiftStartMinutes,
    now: new Date(nowMs),
  });
  const style = HEALTH_STYLE[health.level];

  return (
    <View>
      <View className={`flex-row items-center gap-1.5 px-2.5 py-1 rounded-full self-start ${style.bg}`}>
        {health.level === 'green' ? (
          <PulsingDot color={style.dot} size={6} />
        ) : (
          <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: style.dot }} />
        )}
        <Text className={`text-2xs font-semibold ${style.text}`}>{health.label}</Text>
      </View>
      {health.detail && <Text className="text-2xs text-neutral-400 mt-1">{health.detail}</Text>}
    </View>
  );
}

function EngineerRow({
  summary,
  shiftStartMinutes,
  nowMs,
}: {
  summary: EngineerAttendanceSummary;
  shiftStartMinutes: number | null;
  nowMs: number;
}) {
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
          <LiveStatusChip summary={summary} shiftStartMinutes={shiftStartMinutes} nowMs={nowMs} />
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
// Site Engineer Attendance — split out of Site Attendance (which now shows
// only the workforce view), by explicit request; sits under it in the
// drawer and has its own project-dashboard quick link.
export default function EngineerAttendanceScreen() {
  const { state } = useAuth();
  const isAdminOrManager = state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');
  const { selectedProjectId } = useProject();

  const [summaries, setSummaries] = useState<EngineerAttendanceSummary[]>([]);
  // Null when no project is selected (unscoped view) — LiveStatusChip/
  // computeTrackingHealth already fall back to the app-wide default window
  // in that case, same as fetchTeamAttendanceSummary's own "no project"
  // fallback above.
  const [shiftStartMinutes, setShiftStartMinutes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [summary, settings] = await Promise.all([
        fetchTeamAttendanceSummary(selectedProjectId),
        selectedProjectId ? fetchProjectSettings(selectedProjectId) : Promise.resolve(null),
      ]);
      setSummaries(summary);
      setShiftStartMinutes(settings?.shiftStartMinutes ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedProjectId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Drives computeTrackingHealth's own time-based staleness/window checks so
  // a chip can go from green to "No recent signal" purely from time passing
  // — without this, a device that silently stopped reporting would keep
  // showing its last-known-good status until some unrelated realtime event
  // happened to refetch the list.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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

  // Demo-only engineers for ROAST @ Kokapet (client presentation) — see
  // lib/demoAttendance.ts; nothing is written to the database.
  const demoSummaries = selectedProjectId === DEMO_ATTENDANCE_PROJECT_ID ? buildDemoSummaries(new Date(nowMs)) : [];
  const sorted = [...summaries, ...demoSummaries].sort((a, b) => a.averageScore - b.averageScore);

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
            sorted.map((s) => (
              <EngineerRow key={s.userId} summary={s} shiftStartMinutes={shiftStartMinutes} nowMs={nowMs} />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}
