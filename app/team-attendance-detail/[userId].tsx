import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchEngineerDailyAttendance,
  fetchLiveTrackingStatus,
  type AttendanceSession,
  type DailyAttendanceRecord,
  type LiveTrackingStatus,
  type LocationDisabledEpisode,
  type RedZoneEntryEpisode,
} from '../../lib/attendanceReview';
import {
  fetchAccountLockStatus,
  LOCKOUT_REASON_LABEL,
  reactivateAccountLockout,
  type LatestAccountLockout,
} from '../../lib/accountLockouts';
import { useAttendanceRealtime } from '../../lib/attendanceRealtime';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PulsingDot } from '../../components/ui/PulsingDot';
import { DayTimelineView, type DayTimelineViewHandle } from '../../components/DayTimelineView';
import { useProject } from '../../lib/ProjectContext';
import { fetchProjectSettings } from '../../lib/projectSettings';
import { formatDateLabel, formatDateTimeLabel, formatTime12h, formatTimeRange12h } from '../../lib/formatTime';
import { computeTrackingHealth, type TrackingHealthLevel } from '../../lib/trackingHealth';
import { isDemoEngineerId } from '../../lib/demoAttendance';
import { DemoEngineerDetail } from '../../components/team/DemoEngineerDetail';

function deviceLabel(manufacturer: string | null, model: string | null): string | null {
  if (!manufacturer && !model) return null;
  return [manufacturer, model].filter(Boolean).join(' ');
}

function formatElapsed(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// A pin that opens the coordinates in the device's default maps app —
// mobile's own equivalent of admin-web's inline SiteLocationPreviewMap
// (no embeddable map library dependency here; leaving the app to view a
// pin is the natural mobile pattern, unlike a web dashboard where an
// inline preview makes more sense).
function LocationLink({ latitude, longitude, label }: { latitude: number; longitude: number; label: string }) {
  return (
    <Pressable onPress={() => Linking.openURL(`https://www.google.com/maps?q=${latitude},${longitude}`)} className="flex-row items-center gap-1 mt-0.5">
      <Ionicons name="location-outline" size={11} color="#9CA3AF" />
      <Text className="text-2xs text-neutral-400 underline">{label}</Text>
    </Pressable>
  );
}

// The "real reason" behind a tracking gap — 'no_heartbeat' is the newest
// entry here (supabase/tracking-silence-watcher.sql's server-side silence
// detector, for whatever OS-level cause stopped the device reporting
// entirely — a killed background service, force-stop, dead battery,
// airplane mode — the app can't tell which, only that it went silent).
const DISABLED_REASON_LABEL: Record<string, string> = {
  gps_disabled: 'GPS turned off',
  background_permission: 'Background location revoked',
  no_heartbeat: "Stopped reporting — phone likely killed the app",
  services: 'Location services turned off',
  permission: 'Location permission revoked',
};

function LocationDisabledRow({ episode }: { episode: LocationDisabledEpisode }) {
  const reasonLabel = DISABLED_REASON_LABEL[episode.reason] ?? episode.reason;
  const stillOpenLabel = episode.reason === 'no_heartbeat' ? 'Still silent' : 'Still off';
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <View className="flex-row items-center gap-1.5 flex-1">
        <Ionicons name="location-outline" size={13} color="#B45309" />
        <Text className="text-xs text-amber-800 flex-1">{reasonLabel} at {formatDateTimeLabel(episode.disabledAt)}</Text>
      </View>
      <Text className="text-2xs font-bold" style={{ color: episode.enabledAt ? '#166534' : '#B45309' }}>
        {episode.enabledAt ? `Back on at ${formatDateTimeLabel(episode.enabledAt)}` : stillOpenLabel}
      </Text>
    </View>
  );
}

function RedZoneEntryRow({ entry }: { entry: RedZoneEntryEpisode }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <View className="flex-row items-center gap-1.5 flex-1">
        <Ionicons name="warning-outline" size={13} color="#DC2626" />
        <Text className="text-xs text-red-800 flex-1">Entered &quot;{entry.zoneName}&quot; at {formatTime12h(entry.enteredAt)}</Text>
      </View>
      <Text className="text-2xs font-bold" style={{ color: entry.exitedAt ? '#166534' : '#DC2626' }}>
        {entry.exitedAt ? `Left at ${formatTime12h(entry.exitedAt)}` : 'Still inside'}
      </Text>
    </View>
  );
}

// One check-in-to-check-out span, live-ticking its own duration while
// still open (nowMs updates every 30s from the parent) — multiple of
// these render per day now that multiple sessions/day are the confirmed
// model (a lunch-break out-and-back-in, or just repeated test taps),
// instead of collapsing everything into one summary check-in/check-out
// pair the way this screen used to.
function SessionRow({ session, nowMs }: { session: AttendanceSession; nowMs: number }) {
  const device = deviceLabel(session.deviceManufacturer, session.deviceModel);
  const isOpen = !session.checkOutTime;
  const elapsedMs = (session.checkOutTime ?? new Date(nowMs)).getTime() - session.checkInTime.getTime();
  return (
    <View className="flex-row items-center justify-between py-2 border-b border-neutral-50">
      <View className="flex-1">
        <Text className="text-sm font-semibold text-neutral-800">
          {formatTime12h(session.checkInTime)} – {isOpen ? 'now' : formatTime12h(session.checkOutTime)}
        </Text>
        {device && <Text className="text-2xs text-neutral-400 mt-0.5">{device}</Text>}
        {session.checkInLocation && (
          <LocationLink latitude={session.checkInLocation.latitude} longitude={session.checkInLocation.longitude} label="View check-in" />
        )}
      </View>
      <Text className="text-xs font-bold text-neutral-500">{formatElapsed(elapsedMs)}</Text>
    </View>
  );
}

// isLocked keeps its own distinct dark/red treatment (matches
// computeTrackingHealth's own "Account locked" red-level result) so a
// locked account still reads as categorically different from a plain red
// tracking failure at a glance — this badge doesn't need to special-case it
// separately anymore, computeTrackingHealth already checks isLocked first.
const HEALTH_BADGE_STYLE: Record<TrackingHealthLevel, { bg: string; dot: string; text: string }> = {
  green: { bg: '#DCFCE7', dot: '#16A34A', text: '#166534' },
  red: { bg: '#FEE2E2', dot: '#DC2626', text: '#991B1B' },
  grey: { bg: '#F3F4F6', dot: '#9CA3AF', text: '#6B7280' },
};

// Now shows the exact reason behind a red state, not just "not on shift" —
// see lib/trackingHealth.ts for why (built directly from the Prashuramu/
// Oppo debugging session, where this screen previously had no way to tell
// "off shift, nothing expected" apart from "should be tracking and silently
// isn't").
function StatusBadge({ level, label, isLocked }: { level: TrackingHealthLevel; label: string; isLocked: boolean }) {
  // A locked account additionally gets the darker, more alarming treatment
  // the old badge used — distinct from a plain red tracking failure, since
  // "can't log in at all until an admin acts" is a categorically bigger
  // deal than "phone stopped reporting."
  const style = isLocked ? { bg: '#1F2937', dot: '#EF4444', text: '#F87171' } : HEALTH_BADGE_STYLE[level];
  return (
    <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ backgroundColor: style.bg }}>
      {level === 'green' ? <PulsingDot color={style.dot} size={6} /> : <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: style.dot }} />}
      <Text className="text-2xs font-bold" style={{ color: style.text }}>{label}</Text>
    </View>
  );
}

// Own-reason text kept generic-but-informative for admin (unlike the
// locked-out engineer's own screen — AuthContext.tsx's GPS_LOCKED_MESSAGE
// — which deliberately never mentions GPS/location specifics; an admin
// deciding whether to reactivate needs the real trigger).
function LockedNotice({
  lockout,
  reactivating,
  onReactivate,
}: {
  lockout: LatestAccountLockout;
  reactivating: boolean;
  onReactivate: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <View className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 mb-3">
      <Text className="text-xs font-semibold text-red-800">
        Locked at {formatDateTimeLabel(new Date(lockout.lockedAtISO))} — {(LOCKOUT_REASON_LABEL[lockout.reason] ?? lockout.reason).toLowerCase()}.
      </Text>
      <Pressable
        onPress={() => setConfirming(true)}
        disabled={reactivating}
        className="self-start flex-row items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-700 mt-2.5"
        style={{ opacity: reactivating ? 0.6 : 1 }}
      >
        {reactivating && <ActivityIndicator size="small" color="#fff" />}
        <Text className="text-xs font-bold text-white">Reactivate account</Text>
      </Pressable>

      {confirming && (
        <ConfirmDialog
          title="Reactivate this account?"
          description="This engineer will be able to log in again. This is logged against your account."
          confirmLabel="Reactivate"
          variant="warning"
          busy={reactivating}
          onConfirm={onReactivate}
          onCancel={() => setConfirming(false)}
        />
      )}
    </View>
  );
}

// Shown once a lock has already been cleared — a small persistent audit
// note (not a transient toast) so "who did it and when" stays visible
// whenever this screen is viewed later, not just in the moment.
function ReactivatedNotice({ lockout }: { lockout: LatestAccountLockout }) {
  if (!lockout.reactivatedAtISO) return null;
  return (
    <View className="rounded-lg bg-neutral-50 px-3 py-2 mb-3">
      <Text className="text-2xs text-neutral-500">
        Reactivated by {lockout.reactivatedByName ?? 'an admin'} at {formatTime12h(new Date(lockout.reactivatedAtISO))}
      </Text>
    </View>
  );
}

// The "right now" half of this screen — current status and every session
// today (live-ticking while any is still open), sitting above the
// trailing-30-day history list below.
function LiveStatusCard({
  userId,
  today,
  fullName,
  isLocked,
  latestLockout,
  reactivating,
  onReactivate,
  liveTracking,
  shiftStartMinutes,
}: {
  userId: string | null;
  today: DailyAttendanceRecord | undefined;
  fullName: string;
  isLocked: boolean;
  latestLockout: LatestAccountLockout | null;
  reactivating: boolean;
  onReactivate: () => void;
  liveTracking: LiveTrackingStatus | null;
  shiftStartMinutes: number | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isOnShift = today?.isCurrentlyClockedIn ?? false;

  // Always ticks now, not just while on shift — computeTrackingHealth's own
  // window/staleness checks are time-based (see trackingHealth.ts), so a
  // device that silently stops reporting needs this to keep re-evaluating
  // even for an engineer who was never checked in to begin with.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const health = computeTrackingHealth({
    userId,
    isLocked,
    liveTrackingStatus: liveTracking?.status ?? null,
    liveTrackingStatusReason: liveTracking?.reason ?? null,
    liveTrackingStatusAt: liveTracking?.at ?? null,
    isCurrentlyClockedIn: isOnShift,
    todayCheckInTime: today?.checkInTime ?? null,
    shiftStartMinutes,
    now: new Date(nowMs),
  });

  const sessions = today?.sessions ?? [];
  const totalElapsedMs = sessions.reduce(
    (sum, s) => sum + ((s.checkOutTime ?? new Date(nowMs)).getTime() - s.checkInTime.getTime()),
    0
  );
  // Item 3 — the RAW gap between scheduled start and actual check-in, not
  // net of the scoring grace period (wasLate itself already accounts for
  // the grace period when deciding WHETHER to show this line at all — a
  // check-in a few minutes past 9 isn't flagged — but once it IS late
  // enough to show, the displayed duration is the true gap, matching what
  // the spec's own example expects: a 12:41 check-in against a 9:00 start
  // reads "3h 41m late," not "3h 31m" net of a 10-minute grace).
  const lateMs = today?.wasLate && today.checkInTime && today.scheduledStart
    ? today.checkInTime.getTime() - today.scheduledStart.getTime()
    : null;
  const unresolvedEpisodes = today?.locationDisabledEpisodes.filter((e) => !e.enabledAt) ?? [];
  const unresolvedZoneEntries = today?.redZoneEntries.filter((e) => !e.exitedAt) ?? [];

  return (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-md font-bold text-neutral-900">{fullName}</Text>
        <StatusBadge level={health.level} label={health.label} isLocked={isLocked} />
      </View>
      {health.detail && <Text className="text-2xs text-neutral-400 text-right mb-2">{health.detail}</Text>}

      {isLocked && latestLockout && (
        <LockedNotice lockout={latestLockout} reactivating={reactivating} onReactivate={onReactivate} />
      )}
      {!isLocked && latestLockout && <ReactivatedNotice lockout={latestLockout} />}

      {sessions.length > 0 ? (
        <>
          {/* Item 3 — only ever shown when genuinely late (gated on
              wasLate, which already nets out the scoring grace period);
              on-time/early omits this line entirely, no "0m late" or
              positive "On time" confirmation, per spec's own stated
              default. */}
          {lateMs != null && (
            <Text className="text-xs font-bold text-amber-700 mb-1.5">
              Checked in {formatElapsed(lateMs)} late
            </Text>
          )}
          <Text className="text-2xs text-neutral-500 mb-1">
            {sessions.length} session{sessions.length === 1 ? '' : 's'} today · {formatElapsed(totalElapsedMs)} total
          </Text>
          {sessions.map((s, i) => <SessionRow key={i} session={s} nowMs={nowMs} />)}

          {today && today.locationDisabledEpisodes.length > 0 && (
            <View className="mt-3 pt-3 border-t border-neutral-100">
              <Text className="text-2xs font-bold uppercase tracking-wide text-amber-700 mb-1">
                {unresolvedEpisodes.length > 0 ? 'Location currently off' : 'Location was turned off today'}
              </Text>
              {today.locationDisabledEpisodes.map((ep, i) => <LocationDisabledRow key={i} episode={ep} />)}
            </View>
          )}

          {today && today.redZoneEntries.length > 0 && (
            <View className="mt-3 pt-3 border-t border-neutral-100">
              <Text className="text-2xs font-bold uppercase tracking-wide text-red-700 mb-1">
                {unresolvedZoneEntries.length > 0 ? 'Currently in a red zone' : 'Red zone entry today'}
              </Text>
              {today.redZoneEntries.map((entry, i) => <RedZoneEntryRow key={i} entry={entry} />)}
            </View>
          )}
        </>
      ) : (
        <Text className="text-sm text-neutral-400">Not checked in today.</Text>
      )}
    </Card>
  );
}

function dateLabel(dateKey: string): string {
  return formatDateLabel(new Date(`${dateKey}T00:00:00`));
}

function scoreColor(score: number): { bg: string; text: string } {
  if (score >= 85) return { bg: '#DCFCE7', text: '#166534' };
  if (score >= 65) return { bg: '#FEF9C3', text: '#854D0E' };
  return { bg: '#FEE2E2', text: '#991B1B' };
}

function DayCard({ day }: { day: DailyAttendanceRecord }) {
  const c = scoreColor(day.score);
  return (
    <Card className={`mb-2.5 ${day.isAbsent ? 'opacity-60' : ''}`}>
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm font-bold text-neutral-900">{dateLabel(day.date)}</Text>
        <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: c.bg }}>
          <Text className="text-xs font-bold" style={{ color: c.text }}>{day.isAbsent ? 'Absent' : day.score}</Text>
        </View>
      </View>

      {!day.isAbsent && (
        <>
          {/* Every session that day, not just a collapsed first-check-in/
              last-check-out pair — multiple sessions per day (a lunch
              break, or repeated real taps) are the confirmed model. */}
          {day.sessions.map((s, i) => (
            <View key={i} className="flex-row items-center justify-between mb-1.5">
              <View className="flex-1">
                <Text className="text-2xs text-neutral-500">Session {i + 1}</Text>
                <Text className="text-sm font-semibold text-neutral-800">
                  {formatTime12h(s.checkInTime)} – {s.checkOutTime ? formatTime12h(s.checkOutTime) : 'Ongoing'}
                </Text>
                {s.checkInLocation && <LocationLink latitude={s.checkInLocation.latitude} longitude={s.checkInLocation.longitude} label="View" />}
              </View>
            </View>
          ))}

          <View className="mt-1">
            <Text className="text-xs text-neutral-500">Scheduled</Text>
            <Text className="text-sm font-semibold text-neutral-800">
              {formatTimeRange12h(day.scheduledStart, day.scheduledEnd)}
            </Text>
          </View>

          <View className="flex-row items-center flex-wrap gap-1.5 mt-2">
            {day.wasLate && (
              <View className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200">
                <Text className="text-2xs font-bold text-amber-700">Late</Text>
              </View>
            )}
            {day.leftEarly && (
              <View className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200">
                <Text className="text-2xs font-bold text-amber-700">Left Early</Text>
              </View>
            )}
            {day.unresolvedRedZoneEntryCount > 0 && (
              <View className="px-2 py-0.5 rounded-full bg-red-50 border border-red-200">
                <Text className="text-2xs font-bold text-red-700">
                  {day.unresolvedRedZoneEntryCount} unresolved red-zone {day.unresolvedRedZoneEntryCount === 1 ? 'entry' : 'entries'}
                </Text>
              </View>
            )}
            {day.trackingDegradedMinutes > 0 && (
              <View className="px-2 py-0.5 rounded-full bg-neutral-100">
                <Text className="text-2xs font-bold text-neutral-500">{day.trackingDegradedMinutes}m degraded tracking</Text>
              </View>
            )}
            {day.totalHoursOnSite != null && (
              <View className="px-2 py-0.5 rounded-full bg-neutral-100">
                <Text className="text-2xs font-bold text-neutral-500">{day.totalHoursOnSite}h on site</Text>
              </View>
            )}
            {deviceLabel(day.deviceManufacturer, day.deviceModel) && (
              <View className="px-2 py-0.5 rounded-full bg-neutral-100 flex-row items-center gap-1">
                <Ionicons name="phone-portrait-outline" size={10} color="#6B7280" />
                <Text className="text-2xs font-bold text-neutral-500">{deviceLabel(day.deviceManufacturer, day.deviceModel)}</Text>
              </View>
            )}
            {day.locationDisabledEpisodes.length > 0 && (
              <View className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200">
                <Text className="text-2xs font-bold text-amber-700">
                  Location off {day.locationDisabledEpisodes.length} {day.locationDisabledEpisodes.length === 1 ? 'time' : 'times'}
                </Text>
              </View>
            )}
            {day.redZoneEntries.length > 0 && (
              <View className="px-2 py-0.5 rounded-full bg-red-50 border border-red-200">
                <Text className="text-2xs font-bold text-red-700">
                  Red zone entry {day.redZoneEntries.length} {day.redZoneEntries.length === 1 ? 'time' : 'times'}
                </Text>
              </View>
            )}
          </View>
        </>
      )}
    </Card>
  );
}

// Demo-only engineers (lib/demoAttendance.ts) get a dummy activity page;
// everyone else gets the real detail screen below.
export default function TeamAttendanceDetailRoute() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  if (isDemoEngineerId(userId)) return <DemoEngineerDetail userId={userId} />;
  return <TeamAttendanceDetailScreen />;
}

function TeamAttendanceDetailScreen() {
  const { userId, fullName } = useLocalSearchParams<{ userId: string; fullName?: string }>();
  const { selectedProjectId } = useProject();

  const [daily, setDaily] = useState<DailyAttendanceRecord[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [latestLockout, setLatestLockout] = useState<LatestAccountLockout | null>(null);
  const [liveTracking, setLiveTracking] = useState<LiveTrackingStatus | null>(null);
  const [shiftStartMinutes, setShiftStartMinutes] = useState<number | null>(null);
  const [reactivating, setReactivating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timelineViewRef = useRef<DayTimelineViewHandle>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setError(null);
      const [attendance, lockStatus, tracking, settings] = await Promise.all([
        fetchEngineerDailyAttendance(userId, { projectId: selectedProjectId }),
        fetchAccountLockStatus(userId),
        fetchLiveTrackingStatus(userId),
        selectedProjectId ? fetchProjectSettings(selectedProjectId) : Promise.resolve(null),
      ]);
      setDaily(attendance);
      setIsLocked(lockStatus.isLocked);
      setLatestLockout(lockStatus.latest);
      setLiveTracking(tracking);
      setShiftStartMinutes(settings?.shiftStartMinutes ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [userId, selectedProjectId]);

  async function handleReactivate() {
    if (!latestLockout) return;
    setReactivating(true);
    try {
      await reactivateAccountLockout(latestLockout.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReactivating(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Live updates — this exact engineer's own check-in/out, location-off
  // episodes, zone entries, or trackingStatus change refetches this screen,
  // so a check-in performed live during testing shows up here immediately
  // instead of requiring a manual refresh or leaving/re-entering the screen.
  // Also refreshes the map/timeline section (Section 4.1/4.2) below on the
  // same trigger, so a new red-zone entry or Leave shows up on the map
  // without a separate poll.
  const loadAll = useCallback(async () => {
    await Promise.all([load(), timelineViewRef.current?.refresh()]);
  }, [load]);
  useAttendanceRealtime(loadAll, { userId });

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title: fullName || 'Attendance Detail',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <ScrollView contentContainerClassName="px-4 pt-4 pb-8">
          {error && (
            <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-4">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          )}
          {/* daily[0] is today — fetchEngineerDailyAttendance returns most
              recent day first (see its own comment). */}
          <LiveStatusCard
            userId={userId ?? null}
            today={daily[0]}
            fullName={fullName || 'This engineer'}
            isLocked={isLocked}
            latestLockout={latestLockout}
            reactivating={reactivating}
            onReactivate={handleReactivate}
            liveTracking={liveTracking}
            shiftStartMinutes={shiftStartMinutes}
          />

          {/* Section 4.1/4.2 — today's map trail + chronological checklist,
              admin's per-engineer view of the exact same feature the field
              role sees for themselves on day-timeline.tsx. */}
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Today&apos;s Trail</Text>
          {userId && (
            <View className="mb-4">
              <DayTimelineView ref={timelineViewRef} userId={userId} projectId={selectedProjectId} emptyLabel="No activity recorded yet today." />
            </View>
          )}

          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">History</Text>
          <Text className="text-xs text-neutral-400 mb-3">Trailing 30 days, most recent first.</Text>
          {daily.map((d) => <DayCard key={d.date} day={d} />)}
        </ScrollView>
      )}
    </View>
  );
}
