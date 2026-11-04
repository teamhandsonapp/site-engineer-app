import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { devWarn } from '../devLog';
import { logAction, logError } from '../sentryLog';
import { maybeLockForServicesDisabled } from './gpsLockout';

// expo-location has no subscription for "permission or services-enabled
// state changed" — both are point-in-time queries, so catching a mid-
// session toggle (Part 2's own requirement: re-block immediately if
// location is disabled while the app is open) means polling. Kept short
// (5s) since both checks are cheap local OS calls, not network requests —
// same "poll as a backstop, but also react to AppState immediately" shape
// as lib/forceLogoutWatch.ts, just without that hook's realtime layer
// (there's no server-side signal to subscribe to here).
const POLL_MS = 5_000;

export interface LocationGateStatus {
  permissionGranted: boolean;
  servicesEnabled: boolean;
  // False until the first check resolves — the caller should treat this as
  // "don't render a verdict yet" rather than either blocked or unblocked,
  // so a slow first check doesn't flash the block screen for a field role
  // whose location is actually fine.
  checked: boolean;
}

async function checkNow(): Promise<{ permissionGranted: boolean; servicesEnabled: boolean }> {
  const [{ status }, servicesEnabled] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.hasServicesEnabledAsync(),
  ]);
  return { permissionGranted: status === 'granted', servicesEnabled };
}

// `enabled` is the caller's isFieldRole(role) check — when false (admin/
// manager/client), this hook does no work at all and always reports a
// non-blocking status, rather than checking location for roles this
// feature was never meant to touch.
export function useLocationGateStatus(enabled: boolean): LocationGateStatus {
  const [status, setStatus] = useState<LocationGateStatus>({
    permissionGranted: true,
    servicesEnabled: true,
    checked: false,
  });
  const lastLoggedRef = useRef<{ permissionGranted: boolean; servicesEnabled: boolean } | null>(null);

  useEffect(() => {
    // hasServicesEnabledAsync in particular has no real meaning on web
    // (there's no OS-level "location services" toggle distinct from the
    // browser's own permission prompt) and isn't guaranteed implemented —
    // this whole gate is native-only by design, so web always reports
    // non-blocking rather than risking an unhandled rejection from a
    // platform API that was never going to behave the same way here.
    if (!enabled || Platform.OS === 'web') {
      setStatus({ permissionGranted: true, servicesEnabled: true, checked: false });
      return;
    }

    let cancelled = false;
    async function run() {
      try {
        const result = await checkNow();
        if (cancelled) return;
        setStatus({ ...result, checked: true });
        const prev = lastLoggedRef.current;
        if (prev && prev.permissionGranted && !result.permissionGranted) {
          logAction('permission', 'Foreground permission revoked (detected)', {});
        } else if (prev && !prev.permissionGranted && result.permissionGranted) {
          logAction('permission', 'Foreground permission granted', {});
        }
        if (prev && prev.servicesEnabled && !result.servicesEnabled) {
          logAction('permission', 'GPS toggle detected off', {});
        } else if (prev && !prev.servicesEnabled && result.servicesEnabled) {
          logAction('permission', 'GPS toggle detected on', {});
        }
        lastLoggedRef.current = result;

        // Section 5, Case B — checked on every poll tick while services are
        // off (not just on the transition above), so a lock that's still
        // pending past the startup grace period catches up as soon as it
        // elapses, not only at the instant of the original toggle-off. This
        // hook is only ever mounted for field roles (see its own enabled
        // param) — never for admin/manager/client.
        if (!result.servicesEnabled) {
          maybeLockForServicesDisabled().catch(() => {});
        }
      } catch (err) {
        // A transient failure here must not throw as an unhandled
        // rejection (this runs bare from a timer/AppState callback, not
        // awaited by anything) — leave the last-known status in place and
        // try again on the next poll/resume instead.
        devWarn('[locationTracking] permission/services check failed:', err);
        logError(err, 'permission_check');
      }
    }

    run();
    const pollId = setInterval(run, POLL_MS);
    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') run();
    });

    return () => {
      cancelled = true;
      clearInterval(pollId);
      appStateSub.remove();
    };
  }, [enabled]);

  return status;
}
