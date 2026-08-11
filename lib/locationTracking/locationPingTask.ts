import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { devWarn } from '../devLog';
import { LOCATION_PING_INTERVAL_MINUTES, LOCATION_PING_TASK, PING_MAX_ACCEPTABLE_ACCURACY_METERS } from './constants';
import { getCurrentFieldSession } from './currentFieldSession';
import { enqueuePing, syncPendingPings } from './locationPings';
import { isWithinScheduledShiftWindow } from './shiftWindow';
import { checkTrackingStatusNow, reportTrackingStatusIfChanged } from './trackingStatus';
import { syncPendingTrackingStatusEvents } from './trackingStatusQueue';
import { logAction, logError } from '../sentryLog';
import { checkDeadZoneAndReport, recordSuccessfulFix } from './gpsLockout';

// Addition B (part 3) — registered and unregistered purely on the
// scheduled shift window (see useFieldLocationTracking.ts's own
// evaluateLocationPingTask), independent of manual clock-in/out entirely,
// same window-only gating as geofencing. Unlike GEOFENCE_TASK (native region
// monitoring, no persistent notification needed), this genuinely runs as
// an Android foreground service — `foregroundService` below is what makes
// startLocationUpdatesAsync hold a real, visible, kill-resistant service
// rather than the OS being free to reclaim it at will. This is also the
// closest thing this app has to Addition A's requested BroadcastReceiver
// for PROVIDERS_CHANGED_ACTION: there is no way to register a true system
// broadcast receiver from Expo's managed workflow without a custom native
// module/config plugin, so this task's own periodic wake (every
// LOCATION_PING_INTERVAL_MINUTES, i.e. up to that many minutes' latency in the
// worst case while fully backgrounded) plus the foreground 5s poll
// (trackingStatus.ts) and an AppState-resume check are the full set of
// detection paths this app can actually reach. None of them reproduces
// "within a few seconds, even backgrounded" — that specific bar needs a
// real native module this codebase doesn't have.
TaskManager.defineTask(LOCATION_PING_TASK, async ({ data, error }) => {
  const session = await getCurrentFieldSession();
  if (!session) return; // signed out / no longer a field-role account

  // Point 1's fixed shift window, independent of manual clock-in/out
  // entirely — same tighter safety net as geofence.ts's own identical
  // check, for a ping that arrives after the scheduled end but before the
  // next tick unregisters this task.
  if (!(await isWithinScheduledShiftWindow(session.projectId))) return;

  if (!error) {
    const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations ?? [];
    const latest = locations[locations.length - 1];
    const accuracyMeters = latest?.coords.accuracy ?? null;
    if (latest) {
      logAction('location_ping', 'Ping captured', { accuracyMeters });
      // Section 5, Case A bookkeeping — a fix arriving at all (even one
      // discarded just below for poor accuracy) means signal was present,
      // which is the only thing the dead-zone check cares about; a noisy
      // fix is a different, already-handled condition (PING_MAX_ACCEPTABLE_
      // ACCURACY_METERS), not a dead zone.
      await recordSuccessfulFix(session.userId);
    }
    if (latest && accuracyMeters != null && accuracyMeters > PING_MAX_ACCEPTABLE_ACCURACY_METERS) {
      devWarn(`[locationTracking] discarding location ping — accuracy ${accuracyMeters}m exceeds the ${PING_MAX_ACCEPTABLE_ACCURACY_METERS}m threshold`);
      logAction('location_ping', 'Ping discarded for poor accuracy', {
        accuracyMeters,
        thresholdMeters: PING_MAX_ACCEPTABLE_ACCURACY_METERS,
      });
    } else if (latest) {
      await enqueuePing({
        userId: session.userId,
        projectId: session.projectId,
        latitude: latest.coords.latitude,
        longitude: latest.coords.longitude,
        accuracyMeters,
        occurredAt: new Date(latest.timestamp).toISOString(),
      });
    }
  } else {
    // A real, unexpected failure of the native location-updates subsystem
    // — worth a Sentry issue, not just a breadcrumb. Deliberately does NOT
    // try to parse error.message to guess "was this GPS-disabled or
    // something else" — expo-location documents no structured error code
    // for this task, only a free-text message. checkTrackingStatusNow()
    // below re-derives the answer from real OS state instead of
    // interpreting an undocumented string, and runs whether this
    // particular wake succeeded or errored.
    devWarn('[locationTracking] location ping task error:', error.message);
    logError(error, 'location_ping_task', { message: error.message });
  }

  try {
    await syncPendingPings();
    const status = await checkTrackingStatusNow();
    await reportTrackingStatusIfChanged(session.userId, session.projectId, status);
    await syncPendingTrackingStatusEvents();
    // Section 5, Case A — runs every ping cycle (~LOCATION_PING_INTERVAL_
    // MINUTES), the same cadence that both writes (recordSuccessfulFix
    // above) and reads the last-fix timestamp, so this is the one place
    // that owns the full dead-zone lifecycle rather than splitting it
    // across the foreground poll too.
    await checkDeadZoneAndReport(session.userId, session.projectId, status);
  } catch (err) {
    devWarn('[locationTracking] location ping task follow-up work failed:', err);
    logError(err, 'location_ping_task_followup');
  }
});

export async function isLocationPingTaskRegistered(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_PING_TASK);
  } catch {
    return false;
  }
}

export async function registerLocationPingTask(): Promise<void> {
  if (await isLocationPingTaskRegistered()) return;
  await Location.startLocationUpdatesAsync(LOCATION_PING_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: LOCATION_PING_INTERVAL_MINUTES * 60_000,
    // Time-based, not distance-based — an engineer standing still at one
    // spot for hours should still produce a periodic trail, not silence.
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: 'PMC Portal',
      // Kept deliberately generic — Android requires SOME persistent
      // notification while a foreground location service runs (an OS
      // transparency requirement, not something a compliant build can
      // suppress), but nothing requires it to describe what's actually
      // being measured (zone names, coordinates, attendance purpose). A
      // generic "tracking active" gives a motivated person nothing extra
      // to reason about — real anti-spoofing defense is detection
      // (mock-provider flags, accuracy/speed sanity checks), not wording.
      notificationBody: 'Site tracking active.',
      // Kept running independently of the JS/React process being killed
      // (a normal "swipe app away from recents," not `adb force-stop`,
      // which revokes ALL of an app's wake abilities regardless of this
      // setting) — this is what makes this specific mechanism the most
      // kill-resistant piece of the whole feature, not tied to the app
      // process's own lifetime the way killServiceOnDestroy: true would be.
      killServiceOnDestroy: false,
    },
  });
}

export async function unregisterLocationPingTask(): Promise<void> {
  if (!(await isLocationPingTaskRegistered())) return;
  await Location.stopLocationUpdatesAsync(LOCATION_PING_TASK);
}
