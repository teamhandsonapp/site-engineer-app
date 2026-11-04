import { AppState } from 'react-native';
import * as Battery from 'expo-battery';
import { supabase } from '../supabase';
import { devWarn } from '../devLog';
import { logAction, logError } from '../sentryLog';
import { requestIgnoreBatteryOptimizations } from './batteryOptimization';
import { isLocationPingTaskRegistered, registerLocationPingTask } from './locationPingTask';
import { TEMPORARY_24H_TRACKING_USER_IDS } from './constants';
import { isTestModeActive } from './testModeConfig';

// TEMPORARY (added 2026-08-15, remove this whole file — and its one call
// site in useFieldLocationTracking.ts/backgroundSnapshotTask.ts — once the
// 2-3 day Oppo/ColorOS debug window closes) — reuses the SAME debug-user
// gate as the 24h-tracking override (TEMPORARY_24H_TRACKING_USER_IDS)
// rather than a separate flag, since this is investigating exactly the
// same two accounts' tracking reliability, not a new/different scope.
//
// What this can and can't actually verify, and why — read before trusting
// the numbers this produces:
//   - Foreground service + killServiceOnDestroy: false already existed
//     (locationPingTask.ts, registerLocationPingTask) before this file —
//     that's what survives the JS process dying; only a real force-stop
//     (or the OS fully killing the service, which is exactly what's being
//     investigated) defeats it.
//   - expo-location's LocationTaskServiceOptions (Location.types.d.ts) only
//     exposes notificationTitle/Body/Color and killServiceOnDestroy — there
//     is NO field for Android notification-channel importance or an
//     explicit "non-dismissible" flag. That's a real gap in what this
//     managed-workflow API can configure, not something skipped here — a
//     custom native module/config plugin would be needed to set channel
//     importance directly. In practice, Android already refuses to let a
//     genuine ACTIVE foreground service notification be swiped away while
//     the service is running, regardless of channel importance — so the
//     practical "can't be dismissed" outcome is very likely already true,
//     just not something this app can independently prove via this API.
//   - "Was the phone locked/idle" has no direct API either (true Doze/idle
//     state isn't exposed to a managed Expo app). AppState.currentState
//     (foreground/background) is the closest available proxy and is
//     labeled as exactly that below — not a claim of true OS idle state.
export const DEBUG_WATCHDOG_ENABLED_USER_IDS = TEMPORARY_24H_TRACKING_USER_IDS;

// isWatchdogEnabledFor — the actual gate runDebugWatchdog uses below.
// Broadened (2026-08-15) to cover EVERY site engineer while the pre-launch
// TEST_MODE_ALWAYS_TRACK window is active (see testModeConfig.ts), not
// just the 2 named accounts above — this is the "periodically verify the
// task is still registered, restart and log it if not" requirement from
// that spec, reusing this file's already-built mechanism rather than a
// second parallel watchdog. DEBUG_WATCHDOG_ENABLED_USER_IDS is kept
// separately so the narrower Kabilan/Prashuramu investigation still works
// on its own even after test mode ends.
function isWatchdogEnabledFor(userId: string): boolean {
  return isTestModeActive() || DEBUG_WATCHDOG_ENABLED_USER_IDS.has(userId);
}

async function captureDebugSnapshot(): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {
    app_state: AppState.currentState, // 'active' | 'background' | 'inactive' — a proxy for foregrounded, NOT true OS idle/locked state (see this file's header)
  };
  try {
    snapshot.battery_level = await Battery.getBatteryLevelAsync();
  } catch (err) {
    devWarn('[debugWatchdog] battery level read failed:', err);
  }
  try {
    snapshot.low_power_mode = await Battery.isLowPowerModeEnabledAsync();
  } catch (err) {
    devWarn('[debugWatchdog] low power mode read failed:', err);
  }
  try {
    // True means battery optimization is ACTIVE for this app right now —
    // i.e. the OS-level exemption requested via requestIgnoreBatteryOptimizations
    // is NOT (or no longer) in effect. If this reads true right before a
    // restart, that's a strong, direct signal of the actual cause.
    snapshot.battery_optimization_enabled = await Battery.isBatteryOptimizationEnabledAsync();
  } catch (err) {
    devWarn('[debugWatchdog] battery optimization state read failed:', err);
  }
  return snapshot;
}

async function writeDebugEvent(userId: string, eventType: 'watchdog_check' | 'watchdog_restart' | 'battery_snapshot', detail: Record<string, unknown>): Promise<void> {
  try {
    await supabase.from('tracking_debug_events').insert({ user_id: userId, event_type: eventType, detail });
  } catch (err) {
    // Best-effort — a failed debug log write should never block the
    // actual watchdog restart it's describing.
    devWarn('[debugWatchdog] failed to write debug event:', err);
  }
}

// Called from BOTH the foreground tick (useFieldLocationTracking) and the
// background task's own wake (backgroundSnapshotTask) — same "checked from
// multiple independent places" reasoning already used for geofence exit
// confirmation elsewhere in this app, so a kill is caught by whichever
// path runs next regardless of foreground/background state at the time.
export async function runDebugWatchdog(userId: string, withinTrackingWindow: boolean): Promise<void> {
  if (!isWatchdogEnabledFor(userId)) return;
  if (!withinTrackingWindow) return;

  const isRegistered = await isLocationPingTaskRegistered();
  const snapshot = await captureDebugSnapshot();

  if (isRegistered) {
    await writeDebugEvent(userId, 'watchdog_check', { task_registered: true, ...snapshot });
    return;
  }

  // Task is supposed to be running (within the tracking window) but isn't
  // — this is the actual kill event, caught at the next tick after it
  // happened, not at the exact moment. Log the snapshot BEFORE attempting
  // the restart so a restart failure doesn't also swallow the diagnostic
  // data explaining why.
  await writeDebugEvent(userId, 'watchdog_restart', { task_registered: false, ...snapshot });
  logAction('tracking_debug', 'Watchdog found location task dead — restarting', { userId, ...snapshot });

  try {
    await registerLocationPingTask();
    // Re-request the exemption too — if battery_optimization_enabled read
    // true above, the OS re-enabled it (or it was never actually granted),
    // which is exactly the scenario this re-triggers a fix for instead of
    // just waiting on the user to have done it manually.
    await requestIgnoreBatteryOptimizations();
  } catch (err) {
    logError(err, 'tracking_debug_watchdog_restart', { userId });
  }
}
