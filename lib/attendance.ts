import { devWarn } from './devLog';
import { formatTime12h } from './formatTime';
import { getDeviceManufacturer, getDeviceModel } from './locationTracking/deviceInfo';
import { WORK_HOURS_END_MINUTES } from './locationTracking/constants';
import { fetchProjectSettings } from './projectSettings';
import { supabase } from './supabase';

export type AttendanceType = 'CHECK_IN' | 'CHECK_OUT';

export interface AttendanceRecord {
  id: string;
  type: AttendanceType;
  clientCapturedAtISO: string;
  // Only ever set on the day's CHECK_IN row (see recordAttendance below —
  // captured once, at check-in). Exposed here so callers (the late-
  // checkout message on this same screen) can compare an eventual
  // check-out against the window that was actually scheduled for today,
  // without a second fetch.
  scheduledEndMinutes: number | null;
  // Already captured on every check-in/out (see recordAttendance's insert
  // below) but not previously selected here — exposed so the day-timeline
  // screen (lib/dayTimeline.ts) can plot and jump to these points on the
  // map same as any other event, without a second query against this same
  // table.
  latitude: number | null;
  longitude: number | null;
}

// Every project this app serves is in India — same explicit +5:30
// arithmetic as formatTime.ts/scorecard.ts, NOT `new Date(); setHours(0,0,0,0)`
// (which keys off the DEVICE's own system timezone). A device not
// configured for IST would otherwise compute the wrong "start of today"
// boundary here, either missing today's real check-in or pulling in
// yesterday's late-night one — the exact bug class already hit and fixed
// elsewhere in this app.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istStartOfToday(): Date {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const istMidnightAsUTC = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(istMidnightAsUTC - IST_OFFSET_MS);
}

export async function fetchTodaysAttendance(userId: string): Promise<AttendanceRecord[]> {
  const startOfToday = istStartOfToday();

  const { data, error } = await supabase
    .from('attendance_records')
    .select('id, type, client_captured_at, scheduled_end_minutes, latitude, longitude')
    .eq('user_id', userId)
    .gte('client_captured_at', startOfToday.toISOString())
    .order('client_captured_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    type: r.type as AttendanceType,
    clientCapturedAtISO: r.client_captured_at,
    scheduledEndMinutes: r.scheduled_end_minutes,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

// Thrown by the single-session-per-day guard in recordAttendance below —
// an expected validation outcome, not a bug (an expected
// validation outcome, not a bug, so callers can skip logging it as one).
export class AttendanceSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttendanceSessionError';
  }
}

// Build prompt point 1/2 — the project's shift window AT THE MOMENT of
// check-in, so a later admin edit to the window can't retroactively change
// what counted as "late" on a past day (see schema.prisma's own comment on
// AttendanceRecord.scheduledStartMinutes). Deliberately independent of
// captureAttendanceLocation above — the scheduled window has nothing to do
// with GPS, so it shouldn't silently go missing just because location
// permission was denied at that moment. Only ever called for CHECK_IN;
// null projectId or a fetch failure both just mean "no scheduled window on
// this row," which the scorecard already falls back to the project's
// current window for.
async function captureScheduledShiftWindow(projectId: string | null): Promise<{ scheduledStartMinutes: number | null; scheduledEndMinutes: number | null }> {
  if (!projectId) return { scheduledStartMinutes: null, scheduledEndMinutes: null };
  try {
    const settings = await fetchProjectSettings(projectId);
    return { scheduledStartMinutes: settings.shiftStartMinutes, scheduledEndMinutes: settings.shiftEndMinutes };
  } catch (err) {
    devWarn('[attendance] could not load project shift window for check-in:', err);
    return { scheduledStartMinutes: null, scheduledEndMinutes: null };
  }
}

// Bug 3.4 — the day's check-in session spans the full scheduled window
// (9 AM-6 PM); it can no longer be manually ended mid-day. Multiple check-
// in/check-out CYCLES were previously allowed (a 9-to-6 workday with
// breaks) specifically so an engineer could step out and back in — that
// need is now served by "Leave" (lib/leaveEvents.ts), which logs a trip
// without touching the check-in session at all, so this block no longer
// removes any real capability, just the specific path that let a checkout
// end the day early. This guard rejects the three states that are never
// valid: checking in while already checked in, checking out without an
// open check-in, and now checking out before the scheduled end time.
// Re-fetches today's records itself rather than trusting a caller-supplied
// "am I checked in" boolean — the UI button's own state should already
// make these unreachable in the normal case, but a backend guard closes
// the same gap a UI-only check can't (a stale screen, a retried request,
// two taps racing before the first response lands).
function assertValidSessionTransition(todaysRecords: AttendanceRecord[], type: AttendanceType): void {
  const lastRecord = todaysRecords[todaysRecords.length - 1] ?? null;

  if (type === 'CHECK_IN') {
    if (lastRecord?.type === 'CHECK_IN') {
      throw new AttendanceSessionError('You are already checked in.');
    }
  } else {
    if (lastRecord?.type !== 'CHECK_IN') {
      throw new AttendanceSessionError('You need to check in before you can check out.');
    }
    // Falls back to the default work-hours end (6 PM) when this check-in
    // has no stamped scheduled window (e.g. no project was assigned at the
    // moment of check-in) — the block should still apply rather than
    // silently not, since a missing schedule isn't evidence the day is over.
    const scheduledEndMinutes = lastRecord.scheduledEndMinutes ?? WORK_HOURS_END_MINUTES;
    const scheduledEndMs = istStartOfToday().getTime() + scheduledEndMinutes * 60_000;
    if (Date.now() < scheduledEndMs) {
      throw new AttendanceSessionError(
        `You can't check out yet — your shift runs until ${formatTime12h(new Date(scheduledEndMs))}. Use "Leave" if you need to step away.`
      );
    }
  }
}

// Confirmed live (real attendance_records data, 2026-08-14): a check-in
// was recorded with project_id NULL and coordinates in a different city
// entirely from the actual project site — not a geofencing bug, geofencing
// never ran at all. captureAttendanceLocation below (and the DB's own
// enforce_attendance_site_radius trigger, same reasoning) both correctly
// skip the distance check when projectId is null — a deliberate "distance
// check, not a location-required check" fallback — but nothing upstream
// of that ever required a project to be selected before allowing a
// check-in/out in the first place, so a screen that happens to render
// with no project selected yet (or a persisted selection that got lost)
// silently produces a real attendance row with zero geofence enforcement
// applied. Blocking here — not just relying on the UI to disable the
// button — is the same "backend guard closes what a UI-only check can't"
// reasoning assertValidSessionTransition's own comment already uses.
export async function recordAttendance(userId: string, projectId: string | null, type: AttendanceType): Promise<void> {
  if (!projectId) {
    throw new AttendanceSessionError('Select a project before you can check in or out.');
  }

  assertValidSessionTransition(await fetchTodaysAttendance(userId), type);

  const schedule = type === 'CHECK_IN'
    ? await captureScheduledShiftWindow(projectId)
    : { scheduledStartMinutes: null, scheduledEndMinutes: null };

  const { error } = await supabase.from('attendance_records').insert({
    user_id: userId,
    project_id: projectId,
    type,
    client_captured_at: new Date().toISOString(),
    // Location removed from the app — no GPS capture on check-in/out.
    latitude: null,
    longitude: null,
    accuracy_meters: null,
    distance_from_site_meters: null,
    is_flagged: false,
    flag_reason: null,
    mock_location_suspected: null,
    scheduled_start_minutes: schedule.scheduledStartMinutes,
    scheduled_end_minutes: schedule.scheduledEndMinutes,
    device_manufacturer: getDeviceManufacturer(),
    device_model: getDeviceModel(),
  });
  if (error) throw new Error(error.message);

}
