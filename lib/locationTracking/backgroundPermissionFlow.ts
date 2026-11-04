import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { devWarn } from '../devLog';
import { logAction, logError } from '../sentryLog';

// 'not-yet-asked' — foreground is granted but background permission has
// never been requested; the UI should show an explanation BEFORE
// triggering the system dialog (Part 1's own requirement — don't just pop
// the OS prompt with no context). 'while-using-only' — background was
// asked and denied (the user picked "While using the app" or "Don't
// allow"), a real OS-level choice this app must never try to force; the UI
// shows a persistent, non-blocking banner instead of re-prompting.
// 'unknown' covers web/not-a-field-role/foreground-not-granted-yet (Part
// 2's own gate owns that last case entirely).
export type BackgroundPermissionState = 'unknown' | 'not-yet-asked' | 'while-using-only' | 'granted';

async function checkNow(): Promise<BackgroundPermissionState> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return 'unknown';
  const background = await Location.getBackgroundPermissionsAsync();
  if (background.status === 'granted') return 'granted';
  if (background.status === 'undetermined') return 'not-yet-asked';
  return 'while-using-only';
}

export function useBackgroundPermissionState(enabled: boolean): BackgroundPermissionState {
  const [state, setState] = useState<BackgroundPermissionState>('unknown');
  const lastLoggedRef = useRef<BackgroundPermissionState | null>(null);

  useEffect(() => {
    if (!enabled) return; // nothing to check; the return value below already reports 'unknown' while disabled
    let cancelled = false;
    async function run() {
      try {
        const next = await checkNow();
        if (cancelled) return;
        setState(next);
        // Only the two transitions worth a breadcrumb: revoked (was
        // granted, no longer is) and (re-)granted — not every resume that
        // finds the same value as last time, which would just be noise.
        if (lastLoggedRef.current === 'granted' && next !== 'granted') {
          logAction('permission', 'Background permission revoked (detected on resume)', { newState: next });
        } else if (lastLoggedRef.current !== null && lastLoggedRef.current !== 'granted' && next === 'granted') {
          logAction('permission', 'Background permission granted', {});
        }
        lastLoggedRef.current = next;
      } catch (err) {
        devWarn('[locationTracking] background permission check failed:', err);
        logError(err, 'permission_check');
      }
    }
    run();
    const appStateSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') run();
    });
    return () => {
      cancelled = true;
      appStateSub.remove();
    };
  }, [enabled]);

  return enabled ? state : 'unknown';
}

// Called only from a real user tap (BackgroundLocationExplainer's Continue
// button) — both platforms expect a background-location prompt to follow
// direct user interaction, not fire silently from a background tick, which
// is exactly what this replaces (geofence.ts's evaluateGeofence now only
// ever CHECKS background status, never requests it).
export async function requestBackgroundLocationPermission(): Promise<void> {
  logAction('permission', 'Background permission requested', {});
  const result = await Location.requestBackgroundPermissionsAsync();
  logAction('permission', result.status === 'granted' ? 'Background permission granted' : 'Background permission denied', {
    status: result.status,
  });

  // Android 13+ needs POST_NOTIFICATIONS for the foreground-service
  // notification background location relies on. registerForPushNotificationsAsync
  // (lib/pushNotifications.ts) already requests this same OS permission at
  // sign-in time, but isn't guaranteed to have run first or succeeded —
  // this is a harmless no-op if already granted, requested here too since
  // this explainer flow is a real user gesture to anchor it to. Same
  // Expo-Go-safety reasoning as that file: expo-notifications must be
  // required lazily, not statically imported, or it throws at import time
  // inside Expo Go.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.requestPermissionsAsync();
  } catch (err) {
    devWarn('[locationTracking] notification permission request failed:', err);
    logError(err, 'notification_permission_request');
  }
}
