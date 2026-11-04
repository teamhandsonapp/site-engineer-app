import { devWarn } from '../devLog';
import { fetchProjectSettings } from '../projectSettings';
import { minutesSinceMidnight, TEMPORARY_24H_TRACKING_USER_IDS, TRACKING_END_MINUTES } from './constants';
import { isTestModeActive } from './testModeConfig';
import { logAction, logError } from '../sentryLog';

// Background tracking, check-in/out, and daily updates are three fully
// independent concerns by explicit product decision (superseding this
// file's own earlier design, which ANDed the scheduled window together
// with manual clock-in/out via a since-removed computeEffectiveShiftOn()).
// Tracking now runs whenever a field-role engineer is logged in AND the
// current time falls within the project's scheduled window — full stop.
// Manual clock-in/out (lib/attendance.ts) still drives attendance semantics
// and the Check In/Out button exactly as before; it just no longer has any
// say over whether background location tracking is running.
//
// TEMPORARY_24H_TRACKING_USER_IDS (constants.ts) — a client-requested
// exception for exactly two real accounts, to genuinely track them around
// the clock instead of only during scheduled shift hours, so their real
// background-tracking reliability history can be reviewed afterward (see
// admin-web's /tracking/[userId] page). Deliberately scoped to just those
// two user ids rather than changing TRACKING_END_MINUTES/the default
// window for everyone — this is real off-shift location monitoring for
// two specific people, a materially bigger scope than what every other
// field account is still subject to, so it should not quietly become the
// new default for anyone else. Remove the check below (and that constant)
// once the 2-3 day test window closes.
//
// Fails OPEN (returns true) on a fetch failure, matching this codebase's
// existing convention elsewhere (evaluateGeofence's own "leave things as-is
// on a transient fetch failure") — a flaky network blip shouldn't be the
// thing that silently kills tracking mid-shift.
export async function isWithinScheduledShiftWindow(projectId: string | null, userId: string | null, now: Date = new Date()): Promise<boolean> {
  // Pre-launch 3-day test mode (see testModeConfig.ts's own TEST_MODE_
  // ALWAYS_TRACK comment) — ahead of the per-user check below since this
  // now covers every site engineer, not just those two accounts. Bypasses
  // the `!projectId` check too, on purpose: "track from the moment they
  // log in" means before a project has necessarily been selected yet, not
  // just during shift hours once one has.
  if (isTestModeActive(now)) return true;
  if (userId && TEMPORARY_24H_TRACKING_USER_IDS.has(userId)) return true;
  if (!projectId) return false;
  try {
    const settings = await fetchProjectSettings(projectId);
    const minutes = minutesSinceMidnight(now);
    // Upper bound is TRACKING_END_MINUTES (10pm), NOT settings.shiftEndMinutes
    // (6pm) — that column governs when CHECKOUT becomes available, a
    // separate, already-correct concern from how late background tracking
    // itself keeps running. See TRACKING_END_MINUTES's own comment.
    return minutes >= settings.shiftStartMinutes && minutes < TRACKING_END_MINUTES;
  } catch (err) {
    devWarn('[locationTracking] could not check scheduled shift window, assuming within it:', err);
    logError(err, 'shift_window_check');
    return true;
  }
}

// Module-level, not a React ref — this is a singleton process-wide concern
// (only one active tracking session at a time), matching geofence.ts's own
// zoneSeverityCache precedent for module-level state. Tracks only whether
// the LAST computed value was logged, so a whole day's tracking window
// produces exactly one "started"/"stopped" breadcrumb pair, not one per
// 60s tick.
let lastLoggedWithinWindow: boolean | null = null;

// Thin logging wrapper around isWithinScheduledShiftWindow — the one
// function useFieldLocationTracking actually calls on every tick, so the
// "tracking auto-started/stopped at the scheduled boundary" breadcrumbs
// stay in one place rather than duplicated at every call site.
export async function logShiftWindowTransition(projectId: string | null, userId: string | null): Promise<boolean> {
  const withinWindow = await isWithinScheduledShiftWindow(projectId, userId);
  if (withinWindow !== lastLoggedWithinWindow) {
    logAction(
      'shift',
      withinWindow ? 'Tracking started — within scheduled shift window' : 'Tracking stopped — outside scheduled shift window',
      { projectId }
    );
    lastLoggedWithinWindow = withinWindow;
  }
  return withinWindow;
}
