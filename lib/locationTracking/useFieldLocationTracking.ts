import { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { devWarn } from '../devLog';
import { fetchProjectSettings } from '../projectSettings';
import { registerBackgroundSnapshotTask, unregisterBackgroundSnapshotTask } from './backgroundSnapshotTask';
import { runCheckpointCatchUp } from './checkpoints';
import {
  confirmPendingExitIfDue,
  confirmPendingZoneEntriesIfDue,
  hasBackgroundLocationPermission,
  hasPendingZoneEntry,
  isGeofenceRegistered,
  registerGeofence,
  unregisterGeofence,
  type RestrictedZoneBoundary,
  type SiteBoundary,
} from './geofence';
import { isLocationPingTaskRegistered, registerLocationPingTask, unregisterLocationPingTask } from './locationPingTask';
import { syncPendingPings } from './locationPings';
import { fetchRestrictedZones } from './restrictedZones';
import { logShiftWindowTransition } from './shiftWindow';
import { syncPendingTrackingStatusEvents } from './trackingStatusQueue';
import { syncPendingZoneEvents } from './zoneEventQueue';
import { persistSelectedProjectId } from './currentFieldSession';
import { CHECKPOINT_STATE_KEY, PENDING_EXIT_KEY, PENDING_ZONE_ENTRIES_KEY } from './storageKeys';
import { logAction, logError } from '../sentryLog';

const FOREGROUND_TICK_MS = 60_000;

// Encodes BOTH the site boundary and every restricted zone so a change in
// either (site location edited, a zone added/removed/moved) is detected —
// zones are sorted by id first since fetchRestrictedZones's own ordering
// isn't guaranteed to be stable across calls.
function regionsKey(b: SiteBoundary | null, zones: RestrictedZoneBoundary[]): string {
  const boundaryPart = b ? `${b.projectId}:${b.latitude}:${b.longitude}:${b.radiusMeters}` : 'none';
  const zonesPart = [...zones]
    .sort((a, b2) => a.zoneId.localeCompare(b2.zoneId))
    // severity included so a severity-only edit (no lat/lng/radius change)
    // still triggers registerGeofence again — that's what refreshes
    // geofence.ts's own zoneSeverityCache, which the debounce lookup reads.
    .map((z) => `${z.zoneId}:${z.latitude}:${z.longitude}:${z.radiusMeters}:${z.severity}`)
    .join(',');
  return `${boundaryPart}|${zonesPart}`;
}

async function evaluateGeofence(
  shouldTrack: boolean,
  projectId: string | null,
  lastRegionsKeyRef: { current: string }
): Promise<void> {
  if (!shouldTrack || !projectId) {
    if (await isGeofenceRegistered()) await unregisterGeofence();
    lastRegionsKeyRef.current = 'none';
    return;
  }

  let boundary: SiteBoundary | null = null;
  let zones: RestrictedZoneBoundary[] = [];
  try {
    const settings = await fetchProjectSettings(projectId);
    if (settings.siteLatitude != null && settings.siteLongitude != null && settings.siteRadiusMeters != null) {
      boundary = {
        projectId,
        latitude: settings.siteLatitude,
        longitude: settings.siteLongitude,
        radiusMeters: settings.siteRadiusMeters,
      };
    }
    const rawZones = await fetchRestrictedZones(projectId);
    zones = rawZones.map((z) => ({ zoneId: z.id, latitude: z.latitude, longitude: z.longitude, radiusMeters: z.radiusMeters, severity: z.severity }));
    logAction('geofence', 'Zones fetched from Supabase', { zoneCount: zones.length, hasBoundary: boundary != null });
  } catch (err) {
    devWarn('[locationTracking] could not load project site location/restricted zones:', err);
    logError(err, 'geofence_fetch_zones', { projectId });
    return; // leave existing registration as-is on a transient fetch failure
  }

  if (!boundary && zones.length === 0) {
    if (await isGeofenceRegistered()) await unregisterGeofence();
    lastRegionsKeyRef.current = 'none';
    return;
  }

  const key = regionsKey(boundary, zones);
  if (key === lastRegionsKeyRef.current) return; // nothing actually changed since the last check

  // Pure check — never prompts (see geofence.ts's own comment). Until the
  // user has gone through BackgroundLocationExplainer and granted "Allow
  // all the time," this just leaves geofencing unregistered rather than
  // silently requesting it from a background tick, which neither platform
  // reliably honors outside a real user gesture anyway.
  if (!(await hasBackgroundLocationPermission())) return;

  try {
    await registerGeofence(boundary, zones);
    lastRegionsKeyRef.current = key;
  } catch (err) {
    // Not re-reported here — registerGeofence itself already calls
    // logError before re-throwing (see geofence.ts), so this stays a
    // devWarn only to avoid a duplicate Sentry issue for the same failure.
    devWarn('[locationTracking] failed to register geofence:', err);
  }
}

// Addition B (part 3) — much simpler than evaluateGeofence above, since
// the ping task doesn't depend on any per-project zone/boundary data, just
// on/off. Same background-permission gate as geofencing (starting
// startLocationUpdatesAsync without it would just throw).
async function evaluateLocationPingTask(shiftOn: boolean): Promise<void> {
  if (!shiftOn) {
    if (await isLocationPingTaskRegistered()) await unregisterLocationPingTask();
    return;
  }
  if (await isLocationPingTaskRegistered()) return;
  if (!(await hasBackgroundLocationPermission())) return;
  try {
    await registerLocationPingTask();
  } catch (err) {
    devWarn('[locationTracking] failed to register location ping task:', err);
    logError(err, 'location_ping_register');
  }
}

// The single wiring point for Parts 2-4's tracking logic (Part 2's own
// permission/services check lives separately in locationGate.ts, consumed
// by FieldLocationGuard.tsx) — mounted once from that same guard component,
// gated on `active` (isFieldRole(role) AND the location gate has passed).
// Handles: persisting the selected project for the background context to
// read (Part 3/4), registering/unregistering the background snapshot task,
// registering/unregistering the geofence as the work-hours window or
// selected project/site-location changes, and running both the checkpoint
// catch-up and the pending-geofence-exit confirmation on every resume plus
// a modest foreground interval.
// How often to re-check a pending zone entry while at least one is
// outstanding, so a 10-30s severity-based debounce (see constants.ts's
// ZONE_CONFIRMATION_SECONDS) actually gets honored to within a few seconds
// while the app is in the foreground, instead of only ever being noticed on
// the next 60s FOREGROUND_TICK_MS tick. Self-stops the moment nothing is
// pending anymore, so this never runs as a permanent battery cost — only
// while it actually matters. Bounded by the same platform reality
// confirmPendingZoneEntriesIfDue's own comment already documents: while
// backgrounded/killed, the granularity is whatever the shared background
// task's own interval allows (BACKGROUND_TASK_MIN_INTERVAL_MINUTES, 15min)
// — there's no Expo equivalent of a precise, short-delay job surviving
// process death the way Android's WorkManager can promise natively.
const FAST_POLL_MS = 5_000;

// Tracking is gated ONLY on `active` (logged in as a field role, location
// gate passed) and the scheduled shift window — fully independent of
// manual clock-in/out (lib/attendance.ts) and of daily-update submissions,
// by explicit product decision. A clocked-out engineer still gets Part 3's
// checkpoint reminders and any already-confirmed-but-unsynced queue items
// flushed (both stay tied to `active` alone, same as before); the change
// is that background location monitoring itself no longer waits for a
// clock-in either — it starts the moment the window opens and stops the
// moment it closes, regardless of check-in/out state.
export function useFieldLocationTracking(
  active: boolean,
  userId: string | null,
  projectId: string | null,
  // Bumped by FieldLocationGuard right after the background-permission
  // explainer flow resolves — granting background permission alone doesn't
  // change active/projectId, so without this the main effect below has no
  // reason to re-run and registration would otherwise wait for the next
  // 60s tick (or an incidental AppState resume, which isn't guaranteed to
  // fire if the permission dialog stayed fully in-app rather than bouncing
  // through Settings). Any change in value forces an immediate re-run; the
  // actual number carries no meaning.
  permissionRecheckSignal: number = 0
): void {
  const lastUserIdRef = useRef<string | null>(null);
  const lastRegionsKeyRef = useRef('none');
  const fastPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A signed-out session, or a different account signing in on the same
  // device, invalidates whatever was persisted for the PREVIOUS identity —
  // without this, a stale selected-project value could seed a new
  // account's tracking before ProjectContext has loaded that account's own
  // selection. Deliberately does NOT clear the zone event queue
  // (zoneEventQueue.ts) here — an unsynced confirmed event already
  // happened and belongs to whoever the userId on that op says, not to
  // "whoever's currently signed in"; wiping it on a sign-out would be
  // exactly the silent event loss point 5 exists to prevent.
  useEffect(() => {
    if (lastUserIdRef.current !== null && lastUserIdRef.current !== userId) {
      AsyncStorage.multiRemove([CHECKPOINT_STATE_KEY, PENDING_EXIT_KEY, PENDING_ZONE_ENTRIES_KEY]).catch(() => {});
      lastRegionsKeyRef.current = 'none';
    }
    lastUserIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    persistSelectedProjectId(projectId).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    // None of expo-location's geofencing/background-permission APIs or
    // expo-task-manager/expo-background-task exist on web at all (not even
    // as a no-op — several throw or reject outright) — this whole feature
    // is native-only by design (see the plan this was built against), so
    // web skips it entirely rather than attempting register/unregister
    // calls against APIs that were never going to work there. Checked
    // first, before the `!active` branch below, since even THAT branch's
    // "cleanup" calls are native-only.
    if (Platform.OS === 'web') return;

    if (!active) {
      unregisterBackgroundSnapshotTask().catch(() => {});
      unregisterGeofence().catch(() => {});
      unregisterLocationPingTask().catch(() => {});
      lastRegionsKeyRef.current = 'none';
      if (fastPollTimeoutRef.current) clearTimeout(fastPollTimeoutRef.current);
      fastPollTimeoutRef.current = null;
      return;
    }

    registerBackgroundSnapshotTask().catch((err) => {
      devWarn('[locationTracking] failed to register background task:', err);
      logError(err, 'background_task_register');
    });

    // Self-scheduling, not setInterval — stops on its own the moment
    // hasPendingZoneEntry() reports nothing outstanding, rather than
    // running forever alongside the main 60s tick.
    async function fastPollIfPending() {
      const pending = await hasPendingZoneEntry().catch(() => false);
      if (!pending) {
        fastPollTimeoutRef.current = null;
        return;
      }
      await confirmPendingZoneEntriesIfDue().catch((err) => {
        devWarn('[locationTracking] fast pending-zone-entry check failed:', err);
        logError(err, 'geofence_confirm_zone_entry');
      });
      fastPollTimeoutRef.current = setTimeout(fastPollIfPending, FAST_POLL_MS);
    }

    function ensureFastPollRunning() {
      if (fastPollTimeoutRef.current) return; // already running
      fastPollTimeoutRef.current = setTimeout(fastPollIfPending, FAST_POLL_MS);
    }

    async function tick() {
      await runCheckpointCatchUp().catch((err) => devWarn('[locationTracking] checkpoint tick failed:', err));
      await confirmPendingExitIfDue().catch((err) => {
        devWarn('[locationTracking] pending-exit tick failed:', err);
        logError(err, 'geofence_confirm_exit');
      });
      await confirmPendingZoneEntriesIfDue().catch((err) => {
        devWarn('[locationTracking] pending-zone-entry tick failed:', err);
        logError(err, 'geofence_confirm_zone_entry');
      });
      await syncPendingZoneEvents().catch((err) => {
        devWarn('[locationTracking] zone event queue sync failed:', err);
        logError(err, 'zone_event_sync');
      });
      await syncPendingPings().catch((err) => {
        devWarn('[locationTracking] location ping sync failed:', err);
        logError(err, 'location_ping_sync');
      });
      await syncPendingTrackingStatusEvents().catch((err) => {
        devWarn('[locationTracking] tracking-status queue sync failed:', err);
        logError(err, 'tracking_status_sync');
      });
      // Independent of manual clock-in/out entirely — this auto-starts
      // tracking at shiftStartMinutes and auto-stops it at shiftEndMinutes
      // purely on the scheduled window, regardless of whether the engineer
      // ever checks in/out at all.
      const withinWindow = await logShiftWindowTransition(projectId);
      await evaluateGeofence(withinWindow, projectId, lastRegionsKeyRef);
      await evaluateLocationPingTask(withinWindow);
      if (await hasPendingZoneEntry().catch(() => false)) ensureFastPollRunning();
    }

    // Never called bare — tick() reaches real native APIs (permissions,
    // geofencing registration) that can genuinely fail even on a real
    // device (a denied prompt, a transient error), and an async function
    // called without a handler on its returned promise is an unhandled
    // rejection, not a caught error. This IS the fix for exactly that:
    // previously-uncaught failures here were surfacing as raw "Failed to
    // fetch"-style errors elsewhere in the app instead of staying local to
    // this hook.
    function runTick() {
      tick().catch((err) => {
        // A true backstop — every step inside tick() already reports its
        // own failures above, so anything reaching here escaped all of
        // them (a genuine bug, not one of the already-handled cases).
        devWarn('[locationTracking] tick failed:', err);
        logError(err, 'field_location_tick');
      });
    }

    runTick();
    const intervalId = setInterval(runTick, FOREGROUND_TICK_MS);
    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active') return;
      // Audit finding 2a (mitigating the lack of a BOOT_COMPLETED
      // receiver) — evaluateGeofence's own regionsKey diff is meant to
      // skip a redundant re-register when nothing has actually changed,
      // which is right for the normal 60s interval tick but wrong for a
      // resume specifically: a resume is exactly the moment this app can
      // no longer assume Play Services still has our geofences registered
      // (a reboot wipes them entirely, and the ref reset on a fresh app
      // launch already forces re-registration then — but a plain
      // background->foreground resume of a still-alive process, where
      // Play Services silently dropped the registration for some other
      // reason, would otherwise never be caught). Resetting the ref forces
      // evaluateGeofence to call registerGeofence again unconditionally on
      // every resume while on shift — startGeofencingAsync is a cheap,
      // local, idempotent call (no network, no fresh GPS fix), so doing
      // this defensively on every resume costs nothing meaningful.
      lastRegionsKeyRef.current = 'none';
      runTick();
    });

    return () => {
      clearInterval(intervalId);
      appStateSub.remove();
      if (fastPollTimeoutRef.current) clearTimeout(fastPollTimeoutRef.current);
      fastPollTimeoutRef.current = null;
    };
  }, [active, projectId, permissionRecheckSignal]);
}
