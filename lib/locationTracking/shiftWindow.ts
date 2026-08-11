import { devWarn } from '../devLog';
import { fetchProjectSettings } from '../projectSettings';
import { minutesSinceMidnight } from './constants';
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
// Fails OPEN (returns true) on a fetch failure, matching this codebase's
// existing convention elsewhere (evaluateGeofence's own "leave things as-is
// on a transient fetch failure") — a flaky network blip shouldn't be the
// thing that silently kills tracking mid-shift.
export async function isWithinScheduledShiftWindow(projectId: string | null, now: Date = new Date()): Promise<boolean> {
  if (!projectId) return false;
  try {
    const settings = await fetchProjectSettings(projectId);
    const minutes = minutesSinceMidnight(now);
    return minutes >= settings.shiftStartMinutes && minutes < settings.shiftEndMinutes;
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
export async function logShiftWindowTransition(projectId: string | null): Promise<boolean> {
  const withinWindow = await isWithinScheduledShiftWindow(projectId);
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
