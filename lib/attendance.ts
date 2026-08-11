import * as Location from 'expo-location';
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

// Standard haversine — the only place this app needs great-circle distance
// (Part 4's geofencing lets the OS's native region-monitoring API handle
// that internally instead), so it lives here rather than as a shared util.
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Matches PING_MAX_ACCEPTABLE_ACCURACY_METERS (lib/locationTracking/
// constants.ts) — same 50m convention, kept as its own constant here rather
// than importing that one directly since it's named/scoped for the
// separate background-ping feature, not this one-shot foreground capture.
// A reading noisier than this is common GPS drift, not a real "outside the
// site" signal — see the blocking logic in recordAttendance below for why
// this specifically gates whether a too-far reading is allowed to actually
// reject the check-in/out or merely flag it for review. Exported so the UI
// can surface the same "this reading was too noisy to trust fully" warning
// it's used to compute, instead of duplicating the number.
export const LOCATION_ACCURACY_THRESHOLD_METERS = 50;

interface AttendanceCapture {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceFromSiteMeters: number | null;
  siteRadiusMeters: number | null;
  isFlagged: boolean;
  flagReason: string | null;
  mockLocationSuspected: boolean | null;
}

// Thrown by the single-session-per-day guard in recordAttendance below —
// distinct from OutsideSiteRadiusError for the same reason (an expected
// validation outcome, not a bug, so callers can skip logging it as one).
export class AttendanceSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttendanceSessionError';
  }
}

// Thrown specifically for the outside-radius hard block below — a distinct
// class (not a plain Error) so callers that need to tell "you're too far
// away" apart from a genuine network/DB failure can do so (e.g. to avoid
// logging it as a real error), even though attendance.tsx's own catch
// today just shows err.message either way.
export class OutsideSiteRadiusError extends Error {
  constructor(public readonly distanceMeters: number, public readonly radiusMeters: number) {
    super(`You need to be at the site to check in — you're currently ${distanceMeters}m away (site radius: ${radiusMeters}m).`);
    this.name = 'OutsideSiteRadiusError';
  }
}

// One-shot foreground capture at the moment of check-in/out — distinct
// from Parts 2-4's persistent tracking (lib/locationTracking/), which is
// site_engineer/senior_site_engineer-only and requires background
// permission; this is a plain foreground read available to every staff
// role, matching this screen's own existing appRoleFor() === 'staff' gate.
// A denied permission or a failed GPS read still falls back to the same
// "no location data" shape this app already wrote before this pass, rather
// than making attendance itself unusable when location isn't available at
// all — but a SUCCESSFUL reading that's confidently outside the site's
// radius is now a hard block (see recordAttendance below), not just a flag
// — confirmed as the intended behavior despite the tradeoff that testing
// this from off-site now requires a mock-location app.
async function captureAttendanceLocation(projectId: string | null): Promise<AttendanceCapture> {
  const empty: AttendanceCapture = {
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    distanceFromSiteMeters: null,
    siteRadiusMeters: null,
    isFlagged: false,
    flagReason: null,
    mockLocationSuspected: null,
  };

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return empty;

    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const { latitude, longitude, accuracy } = position.coords;
    // Only ever a real signal on Android (isFromMockProvider under the
    // hood) — iOS has no OS-level equivalent, so `mocked` stays
    // undefined/false there regardless of the actual device. Stored as
    // null (not false) when the platform doesn't report it at all, so
    // "confirmed not mocked" and "unknown" don't look the same to admin.
    const mockLocationSuspected = position.mocked ?? null;

    let distanceFromSiteMeters: number | null = null;
    let siteRadiusMeters: number | null = null;
    let isFlagged = mockLocationSuspected === true;
    const reasons: string[] = [];
    if (mockLocationSuspected) reasons.push('Mock location suspected');

    if (projectId) {
      try {
        const site = await fetchProjectSettings(projectId);
        if (site.siteLatitude != null && site.siteLongitude != null) {
          distanceFromSiteMeters = Math.round(haversineMeters(latitude, longitude, site.siteLatitude, site.siteLongitude));
          siteRadiusMeters = site.siteRadiusMeters ?? null;
          if (siteRadiusMeters != null && distanceFromSiteMeters > siteRadiusMeters) {
            isFlagged = true;
            reasons.push(`${distanceFromSiteMeters}m from site (radius ${siteRadiusMeters}m)`);
          }
        }
      } catch (err) {
        devWarn('[attendance] could not load project site location for distance check:', err);
      }
    }

    return {
      latitude,
      longitude,
      accuracyMeters: accuracy != null ? Math.round(accuracy * 10) / 10 : null,
      distanceFromSiteMeters,
      siteRadiusMeters,
      isFlagged,
      flagReason: reasons.length > 0 ? reasons.join('; ') : null,
      mockLocationSuspected,
    };
  } catch (err) {
    devWarn('[attendance] location capture failed, recording without it:', err);
    return empty;
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

// Doesn't change the block/allow decision by itself — accuracyMeters is
// exposed purely so the UI can warn "this reading was noisy, the recorded
// location may not be precise" on an otherwise-successful check-in/out,
// per the spec's own "surface uncertainty, don't silently trust a noisy
// reading" requirement. A caller that doesn't care can ignore the field.
export interface RecordAttendanceResult {
  accuracyMeters: number | null;
}

export async function recordAttendance(userId: string, projectId: string | null, type: AttendanceType): Promise<RecordAttendanceResult> {
  assertValidSessionTransition(await fetchTodaysAttendance(userId), type);

  const capture = await captureAttendanceLocation(projectId);

  // Hard block — applies to CHECK_IN and CHECK_OUT alike (the same gap
  // existed on both). Only enforced when the GPS reading itself is
  // reliable (LOCATION_ACCURACY_THRESHOLD_METERS) — a noisy reading from
  // someone actually standing on site can easily read as 100m+ away on a
  // bad fix, and confidently rejecting that would lock out a legitimate
  // check-in over GPS drift, not an actual site-boundary violation. A poor-
  // accuracy reading still outside the radius falls through to the
  // existing isFlagged/flagReason path below (recorded, not rejected) —
  // exactly the "warning, not confident block" the request called for.
  // No location data at all (permission denied, GPS off, capture failed)
  // also falls through un-blocked, same as before this change — this is a
  // distance check, not a location-required check.
  if (
    capture.distanceFromSiteMeters != null &&
    capture.siteRadiusMeters != null &&
    capture.distanceFromSiteMeters > capture.siteRadiusMeters &&
    capture.accuracyMeters != null &&
    capture.accuracyMeters <= LOCATION_ACCURACY_THRESHOLD_METERS
  ) {
    throw new OutsideSiteRadiusError(capture.distanceFromSiteMeters, capture.siteRadiusMeters);
  }

  const schedule = type === 'CHECK_IN'
    ? await captureScheduledShiftWindow(projectId)
    : { scheduledStartMinutes: null, scheduledEndMinutes: null };

  const { error } = await supabase.from('attendance_records').insert({
    user_id: userId,
    project_id: projectId,
    type,
    client_captured_at: new Date().toISOString(),
    latitude: capture.latitude,
    longitude: capture.longitude,
    accuracy_meters: capture.accuracyMeters,
    distance_from_site_meters: capture.distanceFromSiteMeters,
    is_flagged: capture.isFlagged,
    flag_reason: capture.flagReason,
    mock_location_suspected: capture.mockLocationSuspected,
    scheduled_start_minutes: schedule.scheduledStartMinutes,
    scheduled_end_minutes: schedule.scheduledEndMinutes,
    device_manufacturer: getDeviceManufacturer(),
    device_model: getDeviceModel(),
  });
  if (error) throw new Error(error.message);

  return { accuracyMeters: capture.accuracyMeters };
}
