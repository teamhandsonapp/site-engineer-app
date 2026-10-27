import { formatTime12h, istMinutesSinceMidnight } from './formatTime';
import { TEMPORARY_24H_TRACKING_USER_IDS, TRACKING_END_MINUTES, WORK_HOURS_START_MINUTES } from './locationTracking/constants';
import { isTestModeActive } from './locationTracking/testModeConfig';

// Shared by team-attendance.tsx's list chip and team-attendance-detail's own
// status badge — one reason-classification function so the two screens can
// never show a different verdict for the same engineer. Built directly out
// of the real live debugging session that found the previous chip logic
// (an all-or-nothing "Off shift" vs "On shift") was hiding exactly the
// information needed to diagnose a background-killed device: an engineer
// not currently checked in got shown as a plain grey "Off shift" with no
// way to tell "nothing expected right now" apart from "should be tracking
// and silently isn't."
export type TrackingHealthLevel = 'green' | 'red' | 'grey';

export interface TrackingHealthInput {
  // Only needed to check against TEMPORARY_24H_TRACKING_USER_IDS below —
  // remove this field along with that constant once the 2-3 day test
  // window closes.
  userId: string | null;
  isLocked: boolean;
  liveTrackingStatus: string | null; // 'active' | 'degraded' | 'off' | null
  liveTrackingStatusReason: string | null; // 'background_permission' | 'gps_disabled' | null
  liveTrackingStatusAt: Date | null;
  isCurrentlyClockedIn: boolean;
  todayCheckInTime: Date | null;
  // The relevant project's own shift start, in IST minutes-since-midnight —
  // pass null to fall back to the app-wide default (used for an unscoped
  // "all projects" view, where there's no single project to look up).
  shiftStartMinutes: number | null;
  now?: Date;
}

export interface TrackingHealthResult {
  level: TrackingHealthLevel;
  // Short enough to sit inside a compact pill (list screen).
  label: string;
  // Extra context shown alongside/below the pill — e.g. "last seen 9:14 AM"
  // — kept separate from `label` so the pill itself never has to wrap on a
  // narrow list row; null when there's nothing more specific to add.
  detail: string | null;
}

// How stale liveTrackingStatusAt can be before this stops trusting it as
// "still true right now" and calls it out as a real gap instead.
//
// Audit fix — this used to be 12, sized against the CONFIGURED 5-minute
// cadence ("two missed cycles"), not against real device behavior. Once
// item 1's fix made tracking_status_at a true per-ping heartbeat (see
// trackingStatus.ts's touchTrackingHeartbeat), a live-data pull of a real
// device's actual consecutive ping gaps (2026-08-12, ~2h41m shift, 16
// non-trivial gaps) showed mean=10.05min, median=7.51min, p90=23.44min,
// max=33.93min — i.e. real Android background throttling routinely runs
// 1.5-7x the configured interval, not close to it. 12 would have flagged
// this same genuinely-healthy device red on roughly a third of its real
// gaps. Raised to 15 (the top of the recommended 10-15 range) since 12/14/
// 15 all caught the exact same 4 outlier gaps (16.51/19.00/23.44/33.93min)
// in this sample — none of the real gaps fall between 12 and 15, so 15 is
// strictly more forgiving for the same catch rate, not a weaker check.
//
// Honest limitation, not fully solved by this number alone: even at 15,
// 4 of the 16 real gaps sampled (25%) still exceed it — a single bad
// throttle spell can still read as "No recent signal" on a device that's
// actually fine. A fixed threshold can't fully absorb OS-level throttling
// variance; re-sample real gaps periodically and re-tune this constant if
// that false-positive rate turns out to matter in practice.
export const TRACKING_STALE_AFTER_MINUTES = 15;

export function computeTrackingHealth(input: TrackingHealthInput): TrackingHealthResult {
  if (input.isLocked) return { level: 'red', label: 'Account locked', detail: null };

  const now = input.now ?? new Date();
  const startMinutes = input.shiftStartMinutes ?? WORK_HOURS_START_MINUTES;
  const nowMinutes = istMinutesSinceMidnight(now);
  const isTemporary24hOverride = isTestModeActive(now) || (!!input.userId && TEMPORARY_24H_TRACKING_USER_IDS.has(input.userId));
  const withinWindow = isTemporary24hOverride || (nowMinutes >= startMinutes && nowMinutes < TRACKING_END_MINUTES);

  // Nothing is expected to be tracking outside the scheduled window at
  // all — this is the normal, healthy "nothing to report" state, not a
  // failure, so it stays the neutral grey rather than red.
  if (!withinWindow) return { level: 'grey', label: 'Off shift', detail: null };

  const at = input.liveTrackingStatusAt;
  const staleMs = at ? now.getTime() - at.getTime() : null;
  const isStale = staleMs == null || staleMs > TRACKING_STALE_AFTER_MINUTES * 60_000;

  // Checked BEFORE the reported status/reason below on purpose: a device
  // that stopped reporting altogether (background-killed, like Oppo/ColorOS
  // silently ending the foreground service) still has whatever status it
  // last self-reported sitting in the database — trusting that stale value
  // would show a healthy green chip for a phone that hasn't said anything
  // in hours, exactly the blind spot this was built to close.
  if (isStale) {
    return {
      level: 'red',
      label: 'No recent signal',
      detail: at ? `Last seen ${formatTime12h(at)}` : 'Never tracked',
    };
  }

  if (input.liveTrackingStatus === 'degraded') {
    if (input.liveTrackingStatusReason === 'background_permission') return { level: 'red', label: 'No location permission', detail: null };
    if (input.liveTrackingStatusReason === 'gps_disabled') return { level: 'red', label: 'Location services off', detail: null };
    return { level: 'red', label: 'Tracking degraded', detail: null };
  }

  if (input.isCurrentlyClockedIn && input.todayCheckInTime) {
    return { level: 'green', label: 'Tracking live', detail: `On site since ${formatTime12h(input.todayCheckInTime)}` };
  }
  return { level: 'green', label: 'Tracking live', detail: null };
}
