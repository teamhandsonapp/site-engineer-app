import { supabase } from './supabase';
import { fetchUnresolvedAccountLockouts } from './accountLockouts';

// Admin/manager-facing "review the team's attendance" data layer — reads
// the SAME underlying tables the field role's own lib/attendance.ts writes
// to (attendance_records) plus the geofencing/tracking-status tables
// already built (geofence_alerts, restricted_zone_alerts,
// location_disabled_alerts, user_profiles.trackingStatus). This is the
// mobile-native counterpart to admin-web's lib/data/attendanceScorecard.ts
// — same data, same score formula, queried via Supabase (RLS already
// allows any staff role to read all of these — see the various
// "readable by staff" policies) instead of Prisma, since mobile has no
// direct-Postgres access and there's no shared package between the two
// apps to import the admin-web version from directly.

const GRACE_PERIOD_MINUTES = 10;
const LATE_PENALTY = 10;
const EARLY_DEPARTURE_PENALTY = 10;
const RED_ZONE_ENTRY_PENALTY = 5;
const DEGRADED_TRACKING_PENALTY_PER_10_MIN = 1;
const MAX_DEGRADED_TRACKING_PENALTY = 20;
const DEFAULT_LOOKBACK_DAYS = 30;

export interface DailyAttendanceScoreInput {
  isAbsent: boolean;
  wasLate: boolean;
  leftEarly: boolean;
  unresolvedRedZoneEntryCount: number;
  trackingDegradedMinutes: number;
}

export interface DailyAttendanceScoreResult {
  score: number;
  isAbsent: boolean;
}

// MUST stay in sync with admin-web/lib/data/attendanceScorecard.ts's own
// calculateDailyAttendanceScore() — same weights, same formula, ported
// (not imported — no shared package exists between the two apps) so a
// score computed here and one computed there can never quietly disagree.
// If the weights below are ever retuned, retune the admin-web copy too.
export function calculateDailyAttendanceScore(input: DailyAttendanceScoreInput): DailyAttendanceScoreResult {
  if (input.isAbsent) return { score: 0, isAbsent: true };

  let score = 100;
  if (input.wasLate) score -= LATE_PENALTY;
  if (input.leftEarly) score -= EARLY_DEPARTURE_PENALTY;
  score -= input.unresolvedRedZoneEntryCount * RED_ZONE_ENTRY_PENALTY;
  const degradedPenalty = Math.min(
    Math.floor(input.trackingDegradedMinutes / 10) * DEGRADED_TRACKING_PENALTY_PER_10_MIN,
    MAX_DEGRADED_TRACKING_PENALTY
  );
  score -= degradedPenalty;

  return { score: Math.max(0, Math.min(100, score)), isAbsent: false };
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

// A single red-zone entry, surfaced per-day with the zone's own name — same
// "WHEN + is it still ongoing" shape as LocationDisabledEpisode below, just
// for restricted_zone_alerts instead of location_disabled_alerts.
export interface RedZoneEntryEpisode {
  zoneName: string;
  enteredAt: Date;
  exitedAt: Date | null;
}

// A single "location turned off while on shift" episode — same shape as a
// location_disabled_alerts row, surfaced per-day (not just aggregated into
// trackingDegradedMinutes) so admin's live detail view can show WHEN it
// happened and WHETHER it's since recovered, not just a total-minutes count.
export interface LocationDisabledEpisode {
  disabledAt: Date;
  enabledAt: Date | null;
  reason: string;
}

// One check-in-to-check-out span — multiple sessions per day are allowed
// (confirmed: not a single-session model, e.g. a lunch-break out-and-back-
// in), so a day can have more than one of these. checkOutTime is null for
// a still-open session (checked in, not yet checked out — at most the LAST
// session of a day still open, since a real check-in always closes any
// prior open one first, per lib/attendance.ts's own session guard).
export interface AttendanceSession {
  checkInTime: Date;
  checkOutTime: Date | null;
  checkInLocation: GeoPoint | null;
  checkOutLocation: GeoPoint | null;
  deviceManufacturer: string | null;
  deviceModel: string | null;
}

export interface DailyAttendanceRecord {
  date: string; // YYYY-MM-DD, local
  // Every check-in/check-out span for this day, in order — the actual
  // source of truth for display. checkInTime/checkOutTime/checkInLocation/
  // checkOutLocation/deviceManufacturer/deviceModel below are FIRST
  // session's check-in / LAST *closed* session's check-out specifically
  // for scoring (wasLate/leftEarly) and the existing single-session
  // callers, not a claim that only one session happened.
  sessions: AttendanceSession[];
  // Derived from the day's actual LAST record being a CHECK_IN with no
  // matching CHECK_OUT yet — NOT from "checkOutTime is null," which used
  // to also true (wrongly) for a day like [in, out, in] where an earlier
  // completed session's checkout was the only one this record type
  // tracked. This is what admin's live status card should treat as "on
  // shift right now."
  isCurrentlyClockedIn: boolean;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  checkInLocation: GeoPoint | null;
  checkOutLocation: GeoPoint | null;
  // Build.MANUFACTURER/Build.MODEL captured on the FIRST CHECK_IN row for
  // this day — null for rows predating this column, or if the device
  // didn't report one.
  deviceManufacturer: string | null;
  deviceModel: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  totalHoursOnSite: number | null;
  wasLate: boolean;
  leftEarly: boolean;
  zoneExitCount: number;
  redZoneEntryCount: number;
  unresolvedRedZoneEntryCount: number;
  trackingDegradedMinutes: number;
  locationDisabledEpisodes: LocationDisabledEpisode[];
  redZoneEntries: RedZoneEntryEpisode[];
  isAbsent: boolean;
  score: number;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toGeoPoint(lat: unknown, lng: unknown): GeoPoint | null {
  if (lat == null || lng == null) return null;
  return { latitude: Number(lat), longitude: Number(lng) };
}

function toSession(checkIn: RawAttendanceRow, checkOut: RawAttendanceRow | null): AttendanceSession {
  return {
    checkInTime: new Date(checkIn.client_captured_at),
    checkOutTime: checkOut ? new Date(checkOut.client_captured_at) : null,
    checkInLocation: toGeoPoint(checkIn.latitude, checkIn.longitude),
    checkOutLocation: checkOut ? toGeoPoint(checkOut.latitude, checkOut.longitude) : null,
    deviceManufacturer: checkIn.device_manufacturer,
    deviceModel: checkIn.device_model,
  };
}

// Pairs a day's CHECK_IN/CHECK_OUT rows (already chronologically ordered,
// per attendanceQuery's own .order()) into individual sessions — multiple
// per day are allowed (confirmed, not a single-session model). Each
// CHECK_IN starts a session, closed by the next CHECK_OUT after it; a
// CHECK_IN with no CHECK_OUT yet (the day's current, still-open session,
// always at most the LAST one — lib/attendance.ts's own session guard
// rejects a second CHECK_IN while one's already open) yields a session
// with checkOutTime: null. An orphan CHECK_OUT with no pending CHECK_IN is
// skipped rather than crashing — that guard should make it unreachable in
// practice, but this stays defensive against old/malformed data rather
// than throwing on it.
function buildSessions(dayRecords: RawAttendanceRow[]): AttendanceSession[] {
  const sessions: AttendanceSession[] = [];
  let pending: RawAttendanceRow | null = null;
  for (const r of dayRecords) {
    if (r.type === 'CHECK_IN') {
      if (pending) sessions.push(toSession(pending, null));
      pending = r;
    } else if (pending) {
      sessions.push(toSession(pending, r));
      pending = null;
    }
  }
  if (pending) sessions.push(toSession(pending, null));
  return sessions;
}

// Sums, in minutes, however much of [start, end] overlaps [dayStart, dayEnd)
// — mirrors admin-web's identical overlapMinutesWithDay helper.
function overlapMinutesWithDay(start: Date, end: Date, dayStart: Date, dayEnd: Date): number {
  const s = start > dayStart ? start : dayStart;
  const e = end < dayEnd ? end : dayEnd;
  if (e <= s) return 0;
  return (e.getTime() - s.getTime()) / 60_000;
}

interface RawAttendanceRow {
  type: 'CHECK_IN' | 'CHECK_OUT';
  client_captured_at: string;
  latitude: number | string | null;
  longitude: number | string | null;
  scheduled_start_minutes: number | null;
  scheduled_end_minutes: number | null;
  device_manufacturer: string | null;
  device_model: string | null;
}

interface RangeOptions {
  projectId?: string | null;
  days?: number;
  now?: Date;
}

// One engineer's daily breakdown over the trailing N days — the same shape
// admin-web's per-engineer scorecard detail page shows, just fetched via
// Supabase. Bounded to the engineer's own first real check-in (see below),
// not account creation date, so a provisioned-but-not-yet-active account
// doesn't show fabricated "absent" days for time before they ever started.
export async function fetchEngineerDailyAttendance(userId: string, options: RangeOptions = {}): Promise<DailyAttendanceRecord[]> {
  const now = options.now ?? new Date();
  const days = options.days ?? DEFAULT_LOOKBACK_DAYS;
  const today = startOfLocalDay(now);
  const requestedStart = startOfLocalDay(addDays(today, -(days - 1)));

  // Bounded to the engineer's actual FIRST real check-in/out — not account
  // creation date. A registered-but-never-used account (or one whose real
  // first day on site came well after the account was provisioned) was
  // showing every day in the lookback window before their real first
  // session as a fabricated "absent," inflating absentDays for time they
  // were never expected to be tracked at all. Falls back to requestedStart
  // when there's no attendance record at all yet (a genuinely
  // never-active account) — fetchTeamAttendanceSummary's own
  // presentDays > 0 filter is what actually keeps such an account off the
  // team list; this fallback just avoids an unbounded query, not a second
  // filter.
  let firstRecordQuery = supabase
    .from('attendance_records')
    .select('client_captured_at')
    .eq('user_id', userId)
    .order('client_captured_at', { ascending: true })
    .limit(1);
  if (options.projectId) firstRecordQuery = firstRecordQuery.eq('project_id', options.projectId);
  const { data: firstRecordRow } = await firstRecordQuery.maybeSingle();
  const firstAttendanceAt = firstRecordRow?.client_captured_at ? startOfLocalDay(new Date(firstRecordRow.client_captured_at)) : null;
  const rangeStart = firstAttendanceAt && firstAttendanceAt > requestedStart ? firstAttendanceAt : requestedStart;
  const rangeStartISO = rangeStart.toISOString();

  let attendanceQuery = supabase
    .from('attendance_records')
    .select('type, client_captured_at, latitude, longitude, scheduled_start_minutes, scheduled_end_minutes, device_manufacturer, device_model')
    .eq('user_id', userId)
    .gte('client_captured_at', rangeStartISO)
    .order('client_captured_at', { ascending: true });
  if (options.projectId) attendanceQuery = attendanceQuery.eq('project_id', options.projectId);

  let geofenceQuery = supabase
    .from('geofence_alerts')
    .select('confirmed_at')
    .eq('user_id', userId)
    .gte('confirmed_at', rangeStartISO);
  if (options.projectId) geofenceQuery = geofenceQuery.eq('project_id', options.projectId);

  let zoneQuery = supabase
    .from('restricted_zone_alerts')
    .select('entered_at, exited_at, resolved, restricted_zones(name)')
    .eq('user_id', userId)
    .gte('entered_at', rangeStartISO);
  if (options.projectId) zoneQuery = zoneQuery.eq('project_id', options.projectId);

  // Only the degraded-tracking reasons count toward "degraded tracking" for
  // scoring — 'permission'/'services' are the separate whole-app gate.
  // 'no_heartbeat' (supabase/tracking-silence-watcher.sql's server-side
  // silence detector) counts the same as the other two — a background-
  // killed device not reporting for X minutes is exactly as much
  // "degraded tracking" as a revoked permission, just a different cause.
  const disabledQuery = supabase
    .from('location_disabled_alerts')
    .select('disabled_at, enabled_at, reason')
    .eq('user_id', userId)
    .in('reason', ['background_permission', 'gps_disabled', 'no_heartbeat'])
    .lte('disabled_at', now.toISOString())
    .or(`enabled_at.is.null,enabled_at.gte.${rangeStartISO}`);

  const [attendanceRes, geofenceRes, zoneRes, disabledRes] = await Promise.all([
    attendanceQuery,
    geofenceQuery,
    zoneQuery,
    disabledQuery,
  ]);
  if (attendanceRes.error) throw new Error(attendanceRes.error.message);
  if (geofenceRes.error) throw new Error(geofenceRes.error.message);
  if (zoneRes.error) throw new Error(zoneRes.error.message);
  if (disabledRes.error) throw new Error(disabledRes.error.message);

  const attendance = (attendanceRes.data as RawAttendanceRow[]) ?? [];
  const geofenceAlerts = (geofenceRes.data as { confirmed_at: string }[]) ?? [];
  const zoneAlerts = (zoneRes.data as {
    entered_at: string;
    exited_at: string | null;
    resolved: boolean;
    restricted_zones: { name: string }[];
  }[]) ?? [];
  const disabledAlerts = (disabledRes.data as { disabled_at: string; enabled_at: string | null; reason: string }[]) ?? [];

  const results: DailyAttendanceRecord[] = [];
  for (let day = rangeStart; day <= today; day = addDays(day, 1)) {
    const key = localDateKey(day);
    const dayEnd = addDays(day, 1);

    const dayRecords = attendance.filter((r) => localDateKey(new Date(r.client_captured_at)) === key);
    const checkIn = dayRecords.find((r) => r.type === 'CHECK_IN') ?? null;
    const lastRecord = dayRecords.length > 0 ? dayRecords[dayRecords.length - 1] : null;
    // Whether the day is currently OPEN (last action was a check-in with no
    // matching check-out yet) — NOT "checkOutTime is null," which used to
    // also (wrongly) read true for e.g. [in, out, in]: an earlier
    // completed session's checkout existed, but the day is still actually
    // open right now.
    const isCurrentlyClockedIn = lastRecord?.type === 'CHECK_IN';
    // "Closed" checkout — only set once the day's LAST action was actually
    // a check-out, i.e. genuinely done for the day. A mid-day checkout
    // followed by a later check-in must NOT read as "left early" (they
    // haven't left for the day at all), which is exactly what using the
    // LAST check-out row unconditionally used to do.
    const lastCheckOut = !isCurrentlyClockedIn && lastRecord?.type === 'CHECK_OUT' ? lastRecord : null;
    const sessions = buildSessions(dayRecords);

    const isAbsent = !checkIn;
    const checkInTime = checkIn ? new Date(checkIn.client_captured_at) : null;
    const checkOutTime = lastCheckOut ? new Date(lastCheckOut.client_captured_at) : null;

    const scheduledStart = checkIn?.scheduled_start_minutes != null ? new Date(day.getTime() + checkIn.scheduled_start_minutes * 60_000) : null;
    const scheduledEnd = checkIn?.scheduled_end_minutes != null ? new Date(day.getTime() + checkIn.scheduled_end_minutes * 60_000) : null;

    const wasLate = !!(checkInTime && scheduledStart && checkInTime.getTime() > scheduledStart.getTime() + GRACE_PERIOD_MINUTES * 60_000);
    const leftEarly = !!(checkOutTime && scheduledEnd && checkOutTime.getTime() < scheduledEnd.getTime() - GRACE_PERIOD_MINUTES * 60_000);

    // Sum of each individual session's own duration — not "first check-in
    // to last check-out," which would wrongly count a mid-day break gap as
    // time on site. An open session on TODAY counts up to `now`; an open
    // session on a PAST day (a forgotten checkout, or a crash) caps at
    // that day's own end instead — extending it to `now` would otherwise
    // blow up to however many days/weeks have passed since, for a session
    // that realistically never ran that long.
    const openSessionEnd = day.getTime() === today.getTime() ? now : dayEnd;
    const totalHoursOnSite = sessions.length > 0
      ? Math.round(sessions.reduce((sum, s) => sum + ((s.checkOutTime ?? openSessionEnd).getTime() - s.checkInTime.getTime()), 0) / 60_000 / 6) / 10
      : null;

    const zoneExitCount = geofenceAlerts.filter((a) => localDateKey(new Date(a.confirmed_at)) === key).length;
    const dayZoneAlerts = zoneAlerts.filter((a) => localDateKey(new Date(a.entered_at)) === key);
    const redZoneEntryCount = dayZoneAlerts.length;
    const unresolvedRedZoneEntryCount = dayZoneAlerts.filter((a) => !a.resolved).length;
    const redZoneEntries: RedZoneEntryEpisode[] = dayZoneAlerts.map((a) => ({
      zoneName: a.restricted_zones?.[0]?.name ?? 'a restricted zone',
      enteredAt: new Date(a.entered_at),
      exitedAt: a.exited_at ? new Date(a.exited_at) : null,
    }));

    const trackingDegradedMinutes = disabledAlerts.reduce(
      (sum, a) => sum + overlapMinutesWithDay(new Date(a.disabled_at), a.enabled_at ? new Date(a.enabled_at) : now, day, dayEnd),
      0
    );
    // Same overlap filter as the minutes sum above, but keeping the actual
    // episodes (not just a total) — admin's live detail view needs to show
    // WHEN it happened and whether it's since recovered, not just a count.
    const locationDisabledEpisodes: LocationDisabledEpisode[] = disabledAlerts
      .filter((a) => overlapMinutesWithDay(new Date(a.disabled_at), a.enabled_at ? new Date(a.enabled_at) : now, day, dayEnd) > 0)
      .map((a) => ({ disabledAt: new Date(a.disabled_at), enabledAt: a.enabled_at ? new Date(a.enabled_at) : null, reason: a.reason }));

    const { score } = calculateDailyAttendanceScore({
      isAbsent,
      wasLate,
      leftEarly,
      unresolvedRedZoneEntryCount,
      trackingDegradedMinutes,
    });

    results.push({
      date: key,
      sessions,
      isCurrentlyClockedIn,
      checkInTime,
      checkOutTime,
      checkInLocation: checkIn ? toGeoPoint(checkIn.latitude, checkIn.longitude) : null,
      checkOutLocation: lastCheckOut ? toGeoPoint(lastCheckOut.latitude, lastCheckOut.longitude) : null,
      deviceManufacturer: checkIn?.device_manufacturer ?? null,
      deviceModel: checkIn?.device_model ?? null,
      scheduledStart,
      scheduledEnd,
      totalHoursOnSite,
      wasLate,
      leftEarly,
      zoneExitCount,
      redZoneEntryCount,
      unresolvedRedZoneEntryCount,
      trackingDegradedMinutes: Math.round(trackingDegradedMinutes),
      locationDisabledEpisodes,
      redZoneEntries,
      isAbsent,
      score,
    });
  }

  return results.reverse(); // most recent day first
}

export interface EngineerAttendanceSummary {
  userId: string;
  fullName: string;
  role: string;
  averageScore: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  earlyDepartureDays: number;
  totalUnresolvedRedZoneEntries: number;
  isCurrentlyClockedIn: boolean;
  todayCheckInTime: Date | null;
  // Set once checked out — lets the live detail view show a final "today"
  // total even after the shift ends, not just while still clocked in.
  todayCheckOutTime: Date | null;
  todayDeviceManufacturer: string | null;
  todayDeviceModel: string | null;
  // Today's location-disabled episodes specifically — the admin Attendance
  // tab's own live detail surfaces these tied to today's session, distinct
  // from the historical per-day list fetchEngineerDailyAttendance returns.
  todayLocationDisabledEpisodes: LocationDisabledEpisode[];
  // Same "today, tied to this live view" reasoning as
  // todayLocationDisabledEpisodes above, for restricted-zone entries.
  todayRedZoneEntries: RedZoneEntryEpisode[];
  liveTrackingStatus: string | null;
  liveTrackingStatusReason: string | null;
  liveTrackingStatusAt: Date | null;
  // Section 5's GPS-lockout flag — batched from fetchUnresolvedAccountLockouts
  // (one query for the whole list) rather than a per-engineer lookup, same
  // reasoning as every other N-query-avoidance in this file.
  isLocked: boolean;
}

// The team-wide list — scoped to the currently-selected project via
// project_users (staff-readable, same as every table this reads). Runs
// fetchEngineerDailyAttendance per engineer, same shared score function,
// so this list and each engineer's own drill-down can never disagree.
export async function fetchTeamAttendanceSummary(projectId: string | null, days = DEFAULT_LOOKBACK_DAYS): Promise<EngineerAttendanceSummary[]> {
  let engineerIds: string[] | null = null;
  if (projectId) {
    const { data: assignments, error: assignError } = await supabase
      .from('project_users')
      .select('user_id')
      .eq('project_id', projectId);
    if (assignError) throw new Error(assignError.message);
    engineerIds = (assignments ?? []).map((a) => a.user_id as string);
    if (engineerIds.length === 0) return [];
  }

  let engineerQuery = supabase
    .from('user_profiles')
    .select('id, full_name, role, tracking_status, tracking_status_reason, tracking_status_at')
    .in('role', ['site_engineer', 'senior_site_engineer'])
    .is('deleted_at', null)
    .order('full_name', { ascending: true });
  if (engineerIds) engineerQuery = engineerQuery.in('id', engineerIds);

  const [{ data: engineers, error }, unresolvedLockouts] = await Promise.all([
    engineerQuery,
    fetchUnresolvedAccountLockouts(),
  ]);
  if (error) throw new Error(error.message);
  if (!engineers || engineers.length === 0) return [];
  const lockedUserIds = new Set(unresolvedLockouts.map((l) => l.userId));

  const now = new Date();
  const summaries = await Promise.all(
    engineers.map(async (e) => {
      const daily = await fetchEngineerDailyAttendance(e.id, { projectId, days, now });
      const presentDays = daily.filter((d) => !d.isAbsent).length;
      const absentDays = daily.filter((d) => d.isAbsent).length;
      const lateDays = daily.filter((d) => d.wasLate).length;
      const earlyDepartureDays = daily.filter((d) => d.leftEarly).length;
      const totalUnresolvedRedZoneEntries = daily.reduce((sum, d) => sum + d.unresolvedRedZoneEntryCount, 0);
      const averageScore = daily.length > 0 ? Math.round(daily.reduce((sum, d) => sum + d.score, 0) / daily.length) : 0;
      const today = daily[0];
      // today.isCurrentlyClockedIn (the day's actual LAST record) — not
      // "checkInTime && !checkOutTime," which used to read false-positive
      // "off shift" for a real [in, out, in] mid-day-break day, since an
      // earlier completed session's checkout made checkOutTime non-null
      // even while the engineer was still on shift right now.
      const isCurrentlyClockedIn = today?.isCurrentlyClockedIn ?? false;

      return {
        userId: e.id as string,
        fullName: e.full_name as string,
        role: e.role as string,
        averageScore,
        presentDays,
        absentDays,
        lateDays,
        earlyDepartureDays,
        totalUnresolvedRedZoneEntries,
        isCurrentlyClockedIn,
        todayCheckInTime: today?.checkInTime ?? null,
        todayCheckOutTime: today?.checkOutTime ?? null,
        todayDeviceManufacturer: today?.deviceManufacturer ?? null,
        todayDeviceModel: today?.deviceModel ?? null,
        todayLocationDisabledEpisodes: today?.locationDisabledEpisodes ?? [],
        todayRedZoneEntries: today?.redZoneEntries ?? [],
        liveTrackingStatus: e.tracking_status as string | null,
        liveTrackingStatusReason: e.tracking_status_reason as string | null,
        liveTrackingStatusAt: e.tracking_status_at ? new Date(e.tracking_status_at as string) : null,
        isLocked: lockedUserIds.has(e.id as string),
      };
    })
  );

  // An engineer who has never actually checked in even once in this window
  // (presentDays === 0, every day absent) is almost always a registered-
  // but-never-used account, not a real attendance gap — showing them with
  // a misleading "0" score and an all-absent history reads as a problem
  // when there's simply nothing to report yet. They start appearing the
  // moment they check in for real (presentDays >= 1), no separate
  // "activate" step needed.
  return summaries.filter((s) => s.presentDays > 0);
}

export interface LiveTrackingStatus {
  status: string | null;
  reason: string | null;
  at: Date | null;
}

// The per-engineer detail screen's own equivalent of the columns
// fetchTeamAttendanceSummary above already reads for the whole list — split
// out so that screen isn't forced to re-derive the full team summary (and
// its N fetchEngineerDailyAttendance calls) just to read one person's live
// status/reason/timestamp.
export async function fetchLiveTrackingStatus(userId: string): Promise<LiveTrackingStatus> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('tracking_status, tracking_status_reason, tracking_status_at')
    .eq('id', userId)
    .single();
  if (error) throw new Error(error.message);
  return {
    status: data.tracking_status as string | null,
    reason: data.tracking_status_reason as string | null,
    at: data.tracking_status_at ? new Date(data.tracking_status_at as string) : null,
  };
}
