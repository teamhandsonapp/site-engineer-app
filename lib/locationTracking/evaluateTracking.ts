import { devWarn } from '../devLog';
import { fetchProjectSettings } from '../projectSettings';
import {
  hasBackgroundLocationPermission,
  isGeofenceRegistered,
  registerGeofence,
  unregisterGeofence,
  type RestrictedZoneBoundary,
  type SiteBoundary,
} from './geofence';
import { isLocationPingTaskRegistered, registerLocationPingTask, unregisterLocationPingTask } from './locationPingTask';
import { fetchRestrictedZones } from './restrictedZones';
import { logAction, logError } from '../sentryLog';

// Pulled out of useFieldLocationTracking.ts into their own module (not left
// there with a re-export) specifically so backgroundSnapshotTask.ts can
// import them WITHOUT creating a circular dependency —
// useFieldLocationTracking.ts already imports FROM backgroundSnapshotTask.ts
// (register/unregisterBackgroundSnapshotTask), so the reverse import would
// have made the two modules depend on each other. Both the foreground tick
// (useFieldLocationTracking.ts) and the periodic background wake
// (backgroundSnapshotTask.ts) call the exact same two functions here so a
// background wake can genuinely START tracking on its own, not just
// confirm/sync what the foreground tick already registered.

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

export async function evaluateGeofence(
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
export async function evaluateLocationPingTask(shiftOn: boolean): Promise<void> {
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
