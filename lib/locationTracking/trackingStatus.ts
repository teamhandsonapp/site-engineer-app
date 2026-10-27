import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { devWarn } from '../devLog';
import { supabase } from '../supabase';
import { getDeviceManufacturer, getDeviceModel } from './deviceInfo';
import { hasBackgroundLocationPermission } from './geofence';
import { enqueueTrackingStatusEvent } from './trackingStatusQueue';
import { isWithinScheduledShiftWindow } from './shiftWindow';
import { TRACKING_STATUS_STATE_KEY } from './storageKeys';
import { logAction, logError } from '../sentryLog';
import { maybeLockForBackgroundPermissionRevoked, maybeLockForServicesDisabled } from './gpsLockout';

// Point 9 (part 2) + Addition A (part 3) — "silence should never be
// interpreted as everything is fine." Derived purely from local OS-state
// checks (no network call in the derivation itself), then a transition is
// (a) queued durably, (b) pushed to the backend best-effort, and (c)
// surfaced via a real OS notification, not just an in-app banner — see
// reportTrackingStatusIfChanged below for all three.
export type TrackingStatus = 'active' | 'degraded' | 'off';
export type TrackingDegradedReason = 'background_permission' | 'gps_disabled';

export interface TrackingStatusResult {
  status: TrackingStatus;
  reason: TrackingDegradedReason | null;
}

const OFF: TrackingStatusResult = { status: 'off', reason: null };

// How often the FOREGROUND hook re-checks. There is no expo-location
// equivalent of Android's PROVIDERS_CHANGED_ACTION broadcast, and no way to
// run arbitrary JS on a true system broadcast without a custom native
// module/config plugin outside Expo's managed workflow — the honest
// substitute this app can actually reach is: (1) this short foreground
// poll, (2) an AppState-resume check, and (3) locationPingTask.ts's own
// foreground-service-backed task, which is the only one of the three that
// can still fire while the app is fully backgrounded. None of the three
// reproduces "within a few seconds, even backgrounded" the way a real
// BroadcastReceiver would — see that file's own header for exactly what
// latency this leaves while backgrounded.
const POLL_MS = 5_000;

// Self-sufficient (does its own Location.hasServicesEnabledAsync check
// rather than taking it as a parameter) specifically so this same function
// can be called identically from the foreground hook below AND from
// locationPingTask.ts's headless TaskManager callback, which has no
// FieldLocationGuard-supplied poll result to reuse.
export async function checkTrackingStatusNow(): Promise<TrackingStatusResult> {
  const hasBackground = await hasBackgroundLocationPermission();
  if (!hasBackground) return { status: 'degraded', reason: 'background_permission' };
  const gpsEnabled = await Location.hasServicesEnabledAsync();
  if (!gpsEnabled) return { status: 'degraded', reason: 'gps_disabled' };
  return { status: 'active', reason: null };
}

async function syncTrackingStatusToBackend(userId: string, result: TrackingStatusResult): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({
      tracking_status: result.status,
      tracking_status_reason: result.reason,
      tracking_status_at: new Date().toISOString(),
      tracking_device_manufacturer: getDeviceManufacturer(),
      tracking_device_model: getDeviceModel(),
    })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

// Audit fix — reportTrackingStatusIfChanged's `nextKey === lastKey` dedup
// (below) is correct for its own job (log a transition once, fire one
// notification, retry a pending lockout), but it means `tracking_status_at`
// previously only ever advanced on a status CHANGE. A device that stays
// healthy the entire shift, never transitioning, never got this column
// refreshed — so trackingHealth.ts's staleness check (red past
// TRACKING_STALE_AFTER_MINUTES) would misleadingly flag a genuinely-live,
// continuously-pinging device as red partway into every shift. This is the
// unconditional counterpart: called on every successful ping
// (locationPingTask.ts), independent of whether the status key changed, so
// "last seen" stays honest. Deliberately does NOT touch tracking_status/
// tracking_status_reason — reportTrackingStatusIfChanged already owns
// writing those (via syncTrackingStatusToBackend above) whenever they
// actually change; this only ever moves the timestamp.
export async function touchTrackingHeartbeat(userId: string): Promise<void> {
  const { error } = await supabase.from('user_profiles').update({ tracking_status_at: new Date().toISOString() }).eq('id', userId);
  if (error) throw new Error(error.message);
}

// Tapped from BackgroundLocationBanner/TrackingDegradedBanner AND from a
// degraded-tracking notification's tap action (see notificationRouting.ts)
// — kept here, not duplicated in a component, so both call sites open the
// exact same Settings screen for the exact same reason.
export async function openTrackingFixSettings(reason: TrackingDegradedReason): Promise<void> {
  try {
    if (reason === 'gps_disabled') {
      // A device-wide setting, not scoped to this app — Linking has no
      // equivalent of Settings.ACTION_LOCATION_SOURCE_SETTINGS.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const IntentLauncher = require('expo-intent-launcher') as typeof import('expo-intent-launcher');
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS);
    } else {
      await Linking.openSettings();
    }
  } catch (err) {
    devWarn('[locationTracking] could not open settings for degraded tracking:', err);
    logError(err, 'tracking_fix_settings_open');
  }
}

interface PersistedTrackingState {
  status: TrackingStatus;
  reason: TrackingDegradedReason | null;
  notificationId: string | null;
}

async function readPersistedState(): Promise<PersistedTrackingState | null> {
  const raw = await AsyncStorage.getItem(TRACKING_STATUS_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedTrackingState;
  } catch {
    return null;
  }
}

async function writePersistedState(state: PersistedTrackingState): Promise<void> {
  await AsyncStorage.setItem(TRACKING_STATUS_STATE_KEY, JSON.stringify(state));
}

// Fires a real OS notification (Addition A) — deliberately NOT gated on
// app foreground state; expo-notifications displays this identically
// whether the app is open, backgrounded, or fully killed (the OS owns
// notification delivery once scheduled), which is exactly what makes this,
// not the in-app banner alone, satisfy "notify even if they don't have the
// app open." Lazily required — see pushNotifications.ts's own comment on
// why a static import of expo-notifications crashes Expo Go.
async function fireDegradedNotification(reason: TrackingDegradedReason): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Site tracking has stopped',
        body:
          reason === 'background_permission'
            ? 'Background location permission was turned off. Tap to fix.'
            : 'Location (GPS) was turned off. Tap to fix.',
        data: { kind: 'tracking-degraded', reason },
        // `true` (not the string 'default') — expo-notifications' Android
        // implementation treats the literal string 'default' here as a
        // request to look up a CUSTOM bundled sound file named "default"
        // (per its own docs: content.sound expects either a boolean or a
        // real filename registered in the config plugin's sounds array),
        // logging a console warning when it doesn't find one. `true` plays
        // the OS default sound without that file-lookup check.
        sound: true,
      },
      trigger: null,
    });
  } catch (err) {
    devWarn('[locationTracking] failed to schedule degraded-tracking notification:', err);
    logError(err, 'tracking_degraded_notification_schedule');
    return null;
  }
}

async function dismissNotification(notificationId: string | null): Promise<void> {
  if (!notificationId) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.dismissNotificationAsync(notificationId);
  } catch (err) {
    devWarn('[locationTracking] failed to dismiss degraded-tracking notification:', err);
    logError(err, 'tracking_degraded_notification_dismiss');
  }
}

// The one shared entry point for every "did tracking health just change"
// caller — the foreground hook below AND locationPingTask.ts's headless
// task both funnel through this, so a transition is only ever queued/
// notified ONCE regardless of which context's check actually caught it
// first (the AsyncStorage-persisted last-known state, not a React ref, is
// what makes that shared across a real headless task boundary).
//
// Three cases: (1) newly degraded — enqueue a 'degraded' op (Addition A's
// own "queue like zone events" requirement) and fire a notification; (2)
// leaving degraded (recovered to active, OR the shift just ended) —
// enqueue a 'restored' op and dismiss the notification; (3) plain active
// <-> off with no degraded episode involved — no episode to open or close,
// just keep the live UserProfile.trackingStatus field fresh. The queued
// ops are the durable, retried-forever source of truth for the audit
// trail; the direct syncTrackingStatusToBackend call is only a best-effort
// freshness mirror on top of that, never the only copy of the fact.
export async function reportTrackingStatusIfChanged(
  userId: string,
  projectId: string | null,
  next: TrackingStatusResult
): Promise<void> {
  // Section 5, Case B — checked BEFORE the "is this actually new" dedup
  // below (and unconditionally, every call), not just on the transition
  // into 'degraded'. Once persisted state is already 'degraded:<reason>'
  // for THIS episode, everything below this point short-circuits on every
  // later call — but the lock itself might still be pending (e.g. the
  // toggle-off/permission-revoke happened during the startup grace period).
  // Re-attempting on every call is what lets it catch up as soon as grace
  // elapses, instead of only ever getting the one attempt at the original
  // transition. This call site is the one that also runs from
  // locationPingTask.ts's headless background task (see that file's own
  // follow-up block), which is what makes the lockout reachable even while
  // the app is fully backgrounded, not just foregrounded. Both
  // maybeLockFor* calls are idempotent and internally grace-gated, so
  // calling either unconditionally here is safe.
  //
  // Audit fix — 'background_permission' used to fall through to neither
  // branch here at all: it produced a degraded alert/notification (below)
  // but never locked, no matter how long it persisted, unlike gps_disabled.
  // Treated identically now — same mechanism, same grace period, no
  // separate leniency for permission specifically (see gpsLockout.ts's own
  // comment on why).
  if (next.status === 'degraded' && next.reason === 'gps_disabled') {
    maybeLockForServicesDisabled().catch(() => {});
  } else if (next.status === 'degraded' && next.reason === 'background_permission') {
    maybeLockForBackgroundPermissionRevoked().catch(() => {});
  }

  const last = await readPersistedState();
  const nextKey = `${next.status}:${next.reason ?? ''}`;
  const lastKey = last ? `${last.status}:${last.reason ?? ''}` : null;
  if (nextKey === lastKey) return;

  let notificationId: string | null = null;

  if (next.status === 'degraded' && next.reason) {
    logAction('permission', next.reason === 'gps_disabled' ? 'GPS toggle detected off' : 'Background permission revoked (detected)', {
      reason: next.reason,
    });
    await enqueueTrackingStatusEvent({ type: 'degraded', userId, projectId, reason: next.reason });
    logAction('permission', 'Tracking-degraded status set', { reason: next.reason });
    notificationId = await fireDegradedNotification(next.reason);
  } else if (last?.status === 'degraded') {
    await enqueueTrackingStatusEvent({ type: 'restored', userId });
    logAction('permission', 'Tracking-restored status set', { previousReason: last.reason });
    await dismissNotification(last.notificationId);
  }

  await writePersistedState({ status: next.status, reason: next.reason, notificationId });
  syncTrackingStatusToBackend(userId, next).catch((err) => {
    devWarn('[locationTracking] tracking-status live-field sync failed (queued copy will still land):', err);
    logError(err, 'tracking_status_live_sync');
  });
}

// `active` here means "logged in as a field role, location gate passed" —
// the same input useFieldLocationTracking takes, NOT manual clock-in/out.
// Degraded background permission or GPS is only worth alarming about while
// tracking is actually supposed to be running, which — by explicit product
// decision — is the scheduled shift window, independent of check-in/out
// state entirely. Checked internally on every poll (like
// useFieldLocationTracking's own logShiftWindowTransition call) rather
// than taken as a prop, so this can react to the window opening/closing
// without needing a parent re-render to supply a fresh boolean.
export function useTrackingStatus(active: boolean, userId: string | null, projectId: string | null): TrackingStatusResult {
  const [result, setResult] = useState<TrackingStatusResult>(OFF);

  useEffect(() => {
    if (!active || !userId || Platform.OS === 'web') {
      // The return value below already reports OFF while disabled; this
      // still needs to report the transition (a degraded episode open at
      // the moment tracking stops should close, not linger forever).
      if (userId) reportTrackingStatusIfChanged(userId, projectId, OFF).catch(() => {});
      return;
    }
    const uid = userId; // narrowed to non-null for the closure below

    let cancelled = false;
    let withinWindow = false;

    async function run() {
      try {
        withinWindow = await isWithinScheduledShiftWindow(projectId, uid);
        if (cancelled) return;
        const next = withinWindow ? await checkTrackingStatusNow() : OFF;
        if (cancelled) return;
        setResult(next);
        await reportTrackingStatusIfChanged(uid, projectId, next);
      } catch (err) {
        devWarn('[locationTracking] tracking-status check failed:', err);
        logError(err, 'tracking_status_check');
      }
    }

    run();
    const pollId = setInterval(run, POLL_MS);
    const appStateSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') run();
    });

    return () => {
      cancelled = true;
      clearInterval(pollId);
      appStateSub.remove();
    };
  }, [active, userId, projectId]);

  return active && userId && Platform.OS !== 'web' ? result : OFF;
}
