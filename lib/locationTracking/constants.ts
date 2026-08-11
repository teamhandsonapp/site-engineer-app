// Shared by the thrice-daily snapshot (Part 3) and geofence exit tracking
// (Part 4) so both read the same "is this a work hour" definition instead of
// two independently-drifting windows. Aligned to the same 9:00-18:00
// working window as projects.shiftStartMinutes/shiftEndMinutes — briefly
// 9:00-19:00 (fix-shift-end-to-7pm.sql), reverted back to 6:00 PM as the
// actually-correct end time; every time boundary in the app still agrees
// with each other, per the original "no mismatch between screens"
// instruction, just at the corrected hour.
export const WORK_HOURS_START_MINUTES = 9 * 60; // 9:00 AM
export const WORK_HOURS_END_MINUTES = 18 * 60; // 6:00 PM

export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function isWithinWorkHours(date: Date): boolean {
  const minutes = minutesSinceMidnight(date);
  return minutes >= WORK_HOURS_START_MINUTES && minutes < WORK_HOURS_END_MINUTES;
}

// The three daily snapshot checkpoints (Part 3) — defaults per the brief
// ("9 AM, 1 PM, 4:30 PM") since no specific times were required. Each has a
// window either side of the target: a background wake landing anywhere in
// that window still counts as "checkpoint caught," since neither iOS nor
// Android background scheduling can guarantee an exact-minute fire (see
// backgroundSnapshotTask.ts's own comment for why).
export interface Checkpoint {
  id: string;
  label: string;
  targetMinutes: number;
  windowMinutes: number;
}

export const CHECKPOINTS: Checkpoint[] = [
  { id: 'morning', label: '9:00 AM', targetMinutes: 9 * 60, windowMinutes: 45 },
  { id: 'midday', label: '1:00 PM', targetMinutes: 13 * 60, windowMinutes: 45 },
  { id: 'afternoon', label: '4:30 PM', targetMinutes: 16 * 60 + 30, windowMinutes: 45 },
];

// How long a device must stay outside the SITE BOUNDARY (the single
// general safe-radius zone, Project.siteLatitude/siteLongitude/
// siteRadiusMeters) before Part 4 turns it into a real GeofenceAlert — the
// brief's own suggested default, to absorb GPS drift / brief signal loss
// (e.g. walking through a building on-site) rather than alerting on one
// bad reading. Deliberately UNCHANGED by the restricted-zone debounce
// retiming below — this is a separate, already-tuned feature.
export const GEOFENCE_CONFIRMATION_MINUTES = 3;

// How long a device must stay INSIDE a restricted (red) zone before it
// turns into a real RestrictedZoneAlert — looked up by the zone's own
// severity, per the geofencing rebuild spec's own requirement ("a
// hazard-zone entry is higher priority to catch quickly than a general
// safe-radius exit"). A lookup, not a separate code path, so adding a
// third severity level later is a one-line change here, not a new branch
// in geofence.ts.
export const ZONE_CONFIRMATION_SECONDS: Record<'warning' | 'critical', number> = {
  warning: 10,
  critical: 12,
};

// Hysteresis multipliers applied to every zone's (and the site boundary's)
// own admin-set radius — registered as two real geofence regions instead
// of one, so a device sitting near the nominal edge can't flicker
// enter/exit on every new GPS fix. See geofence.ts's own comment on
// exactly which transition (inner vs. outer, enter vs. exit) counts as the
// "for real" signal for each zone kind. Configurable here, not inlined at
// the registration call site, since real-world GPS drift on an actual site
// will likely need this tuned.
export const HYSTERESIS_INNER_FACTOR = 0.85;
export const HYSTERESIS_OUTER_FACTOR = 1.15;

// Play Services / Core Location both cap circular-region geofences at 100
// per app, shared across the site boundary (2 regions, inner+outer) and
// every restricted zone (2 regions each) — see geofence.ts's own
// registerGeofence for how this is enforced rather than just assumed
// never to matter.
export const MAX_GEOFENCE_REGIONS = 100;

export const BACKGROUND_SNAPSHOT_TASK = 'field-location-background-snapshot';
export const GEOFENCE_TASK = 'field-location-geofence-events';

// Addition B (part 3) — a periodic location-updates task, distinct from
// GEOFENCE_TASK above (region-monitoring transitions, not periodic
// reporting). This one genuinely runs as an Android foreground service
// (see locationPingTask.ts's own registerLocationPingTask) while a shift is
// active, which is what also makes it the most reliable available vehicle
// for Addition A's "detect location turned off even while backgrounded"
// requirement — see trackingStatus.ts's own comment on why a real
// BroadcastReceiver-equivalent isn't reachable from Expo without a custom
// native module.
export const LOCATION_PING_TASK = 'field-location-ping-updates';

// The single source of truth for the ping cadence — named here (not
// inlined at the startLocationUpdatesAsync call site) specifically so it
// can be retuned again later without hunting through the codebase; the one
// real call site is locationPingTask.ts's registerLocationPingTask. Lowered
// from 10 to 5 (an explicit decision) — the spec's own floor was "do not
// default this below 5 minutes without a specific reason," so 5 is the
// tightest cadence considered acceptable, not an arbitrary halving.
export const LOCATION_PING_INTERVAL_MINUTES = 5;

export const LOCATION_PING_RETENTION_DAYS = 7;

// Part 1's own point 2 ("GPS accuracy filtering") asked for a configurable
// discard threshold for readings used by secondary UI features — not the
// core OS-level geofence transitions, which Play Services/Core Location
// already filter internally, and not the diagnostic position captured
// alongside a confirmed geofence/zone event, which is logged regardless of
// how poor it is (disputed-alert evidence needs the real reading, not a
// filtered one). The location-ping trail (Addition B) is the one genuine
// "secondary UI feature" reading in this codebase, so this is what it
// filters against — a ping this inaccurate would just show an engineer
// somewhere they weren't on an admin-facing trail view.
export const PING_MAX_ACCEPTABLE_ACCURACY_METERS = 50;

// iOS's BGTaskScheduler only ever grants ONE permitted background-task
// identifier per the expo-background-task config plugin (hardcoded to
// com.expo.modules.backgroundtask.processing regardless of the JS task
// name passed to registerTaskAsync) — there is no second slot for a
// separate "confirm pending geofence exit" background task, so that check
// piggybacks on this same periodic wake instead of getting its own.
export const BACKGROUND_TASK_MIN_INTERVAL_MINUTES = 15;

// Section 5 — GPS lockout. Applies to BOTH cases (dead-zone logging and the
// toggle-off lockout) equally: no lockout logic of either kind evaluates
// anything until this many minutes have passed since login, so a slow first
// fix right after signing in (or briefly fiddling with permission prompts)
// can never be mistaken for either condition. Anchored to the same
// session-started-at timestamp forceLogoutWatch.ts already stamps on every
// real sign-in (see gpsLockout.ts).
export const STARTUP_GRACE_PERIOD_MINUTES = 10;

// Case A (weak signal/dead zone) — permission and services are BOTH still
// on, but no GPS fix has arrived in this long. A wide margin over
// LOCATION_PING_INTERVAL_MINUTES's own documented worst-case background
// latency, so a couple of genuinely slow/skipped wake cycles can't false-
// positive into a "degraded" report — this only ever logs (see
// gpsLockout.ts's checkDeadZoneAndReport), it never locks the account. Not
// retuned to track LOCATION_PING_INTERVAL_MINUTES's own value 1:1 — a wider
// margin here is strictly safer (fewer false positives), never worse.
export const DEAD_ZONE_TIMEOUT_MINUTES = 30;
