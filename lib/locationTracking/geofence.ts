import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { devWarn } from '../devLog';
import {
  GEOFENCE_CONFIRMATION_MINUTES,
  GEOFENCE_TASK,
  HYSTERESIS_INNER_FACTOR,
  HYSTERESIS_OUTER_FACTOR,
  MAX_GEOFENCE_REGIONS,
  ZONE_CONFIRMATION_SECONDS,
} from './constants';
import { getCurrentFieldSession } from './currentFieldSession';
import { getDeviceManufacturer, getDeviceModel } from './deviceInfo';
import { isWithinScheduledShiftWindow } from './shiftWindow';
import { enqueueZoneEvent } from './zoneEventQueue';
import { PENDING_EXIT_KEY, PENDING_ZONE_ENTRIES_KEY } from './storageKeys';
import { logAction, logError } from '../sentryLog';

// Region identifiers encode kind + base id + inner/outer — e.g.
// "site:<projectId>:outer", "zone:<zoneId>:inner". Both kinds of region
// arrive through the same TaskManager task (expo-location only supports
// one registered geofencing task at a time, all sharing one region list).
const SITE_IDENTIFIER_PREFIX = 'site:';
const ZONE_IDENTIFIER_PREFIX = 'zone:';

function newLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Best-effort device position + GPS accuracy at the moment an event is
// CONFIRMED (not at the raw transition instant, which fires from an
// unreliable background-callback context) — diagnostic data only, per the
// geofencing rebuild spec's point 2. Prefers a cached fix (cheap, no new
// GPS round-trip) and only requests a fresh one if nothing recent is
// cached; never throws — a failed/missing reading must never block writing
// the confirmed event itself.
async function captureCurrentPosition(): Promise<{ latitude: number; longitude: number; accuracyMeters: number } | null> {
  try {
    const cached = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
    const position = cached ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (!position) return null;
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy ?? 0,
    };
  } catch (err) {
    // A breadcrumb, not logError/captureException — a failed/missing GPS
    // read here is an accepted, designed-for outcome (see this function's
    // own header), not a silent failure that would otherwise go unnoticed;
    // it's already handled gracefully by returning null.
    devWarn('[locationTracking] could not capture position for a confirmed event:', err);
    logAction('geofence', 'Position capture failed, proceeding without it', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

interface PendingExit {
  projectId: string;
  userId: string;
  exitAt: string; // ISO — set once, on the FIRST outer-exit event, never reset by duplicate exits
  confirmed: boolean;
  refLocalId?: string; // set once confirmed — the zoneEventQueue 'create' op this pairs with
}

async function readPendingExit(): Promise<PendingExit | null> {
  const raw = await AsyncStorage.getItem(PENDING_EXIT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingExit;
  } catch {
    return null;
  }
}

async function writePendingExit(state: PendingExit | null): Promise<void> {
  if (state) {
    await AsyncStorage.setItem(PENDING_EXIT_KEY, JSON.stringify(state));
  } else {
    await AsyncStorage.removeItem(PENDING_EXIT_KEY);
  }
}

// Fired on the OUTER region's EXIT event — the "for real" leave signal for
// the site boundary (see registerGeofence's own comment on why OUTER-exit/
// INNER-enter is the hysteresis pair used here, not the other two
// combinations). Deliberately does NOT insert a DB row or wait out the
// confirmation window here — a TaskManager background callback isn't a
// safe place to hold a promise open for GEOFENCE_CONFIRMATION_MINUTES (iOS
// in particular expects this to resolve promptly, not stay alive for
// minutes) — so this only ever records "an exit happened at this instant"
// and returns immediately. Confirming (or discarding, on a re-entry)
// happens in confirmPendingExitIfDue() below.
async function handleExit(projectId: string, userId: string): Promise<void> {
  const existing = await readPendingExit();
  if (existing && existing.projectId === projectId && !existing.confirmed) {
    return; // already tracking an unconfirmed exit for this region — keep the original exitAt
  }
  await writePendingExit({ projectId, userId, exitAt: new Date().toISOString(), confirmed: false });
}

// Fired on the INNER region's ENTER event — the "definitely back" signal.
async function handleEnter(projectId: string): Promise<void> {
  const pending = await readPendingExit();
  if (!pending || pending.projectId !== projectId) return;

  if (!pending.confirmed) {
    // Returned before the confirmation window elapsed — exactly the false
    // alarm (GPS drift, walking through a building on-site) the window
    // exists to absorb. No alert was ever written, so there's nothing to
    // update, just the pending state to clear.
    logAction('geofence', 'Debounce canceled — returned before confirmation window elapsed', { projectId });
    await writePendingExit(null);
    return;
  }

  if (pending.refLocalId) {
    await enqueueZoneEvent({ type: 'mark-return', kind: 'boundary', refLocalId: pending.refLocalId });
  }
  await writePendingExit(null);
}

// Mirror of PendingExit above, but for restricted-zone ENTRY — the
// alertable event is entering, not leaving, so enteredAt/exitedAt read in
// the opposite direction. Keyed by zoneId in a map (not a single slot like
// PendingExit) since a device could plausibly be near more than one
// restricted zone's edge at once, unlike the single site boundary.
// severity/confirmationSeconds are captured at ENTER time (not re-read
// from the zone list at confirm time) so a mid-window admin edit to a
// zone's severity can't retroactively change an already-ticking window.
interface PendingZoneEntry {
  zoneId: string;
  projectId: string;
  userId: string;
  enteredAt: string; // ISO — set once, on the FIRST inner-enter event, never reset by duplicate enters
  confirmationSeconds: number;
  confirmed: boolean;
  refLocalId?: string; // set once confirmed — the zoneEventQueue 'create' op this pairs with
}

async function readPendingZoneEntries(): Promise<Record<string, PendingZoneEntry>> {
  const raw = await AsyncStorage.getItem(PENDING_ZONE_ENTRIES_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, PendingZoneEntry>;
  } catch {
    return {};
  }
}

async function writePendingZoneEntries(state: Record<string, PendingZoneEntry>): Promise<void> {
  if (Object.keys(state).length === 0) {
    await AsyncStorage.removeItem(PENDING_ZONE_ENTRIES_KEY);
  } else {
    await AsyncStorage.setItem(PENDING_ZONE_ENTRIES_KEY, JSON.stringify(state));
  }
}

export async function hasPendingZoneEntry(): Promise<boolean> {
  const entries = await readPendingZoneEntries();
  return Object.values(entries).some((e) => !e.confirmed);
}

// Fired on the INNER region's ENTER event for a restricted zone — the
// "definitely inside" signal (see registerGeofence's own comment). Same
// "record the instant, confirm later" split as handleExit above.
async function handleZoneEnter(zoneId: string, userId: string, projectId: string | null, severity: 'warning' | 'critical'): Promise<void> {
  if (!projectId) return;
  const entries = await readPendingZoneEntries();
  if (entries[zoneId] && !entries[zoneId].confirmed) return; // already tracking an unconfirmed entry for this zone
  entries[zoneId] = {
    zoneId,
    projectId,
    userId,
    enteredAt: new Date().toISOString(),
    confirmationSeconds: ZONE_CONFIRMATION_SECONDS[severity],
    confirmed: false,
  };
  await writePendingZoneEntries(entries);
}

// Fired on the OUTER region's EXIT event for a restricted zone — the
// "definitely left" signal.
async function handleZoneExit(zoneId: string): Promise<void> {
  const entries = await readPendingZoneEntries();
  const pending = entries[zoneId];
  if (!pending) return;

  if (!pending.confirmed) {
    // Left before the confirmation window elapsed — a false alarm (GPS
    // drift right at the zone's edge), same reasoning as handleEnter's
    // early-return above. No alert was ever written.
    logAction('geofence', 'Debounce canceled — left zone before confirmation window elapsed', { zoneId });
    delete entries[zoneId];
    await writePendingZoneEntries(entries);
    return;
  }

  if (pending.refLocalId) {
    await enqueueZoneEvent({ type: 'mark-exit', kind: 'zone', refLocalId: pending.refLocalId });
  }
  delete entries[zoneId];
  await writePendingZoneEntries(entries);
}

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    // A real, unexpected failure of the native geofencing subsystem
    // itself — not a benign/expected case, so this is a Sentry issue, not
    // just a breadcrumb (see this file's captureCurrentPosition for the
    // contrasting case where a breadcrumb alone is the right call).
    devWarn('[locationTracking] geofence task error:', error.message);
    logError(error, 'geofence_task', { message: error.message });
    return;
  }
  const { eventType, region } = data as {
    eventType: Location.LocationGeofencingEventType;
    region: Location.LocationRegion;
  };
  const identifier = region.identifier;
  if (!identifier) return;

  const session = await getCurrentFieldSession();
  if (!session) return; // signed out / no longer a field-role account — ignore

  // Point 1's fixed shift window — a tighter safety net than relying
  // solely on the next foreground/background tick to unregisterGeofence():
  // a transition that arrives after the scheduled end but before that next
  // tick runs is rejected here too, rather than processed and then only
  // caught retroactively.
  if (!(await isWithinScheduledShiftWindow(session.projectId))) return;

  const parts = identifier.split(':');
  const ring = parts[parts.length - 1]; // 'inner' | 'outer'

  // Logged even before debounce resolves it, per the instrumentation
  // brief — this is the raw OS signal, kept visible in the trail
  // separately from whichever confirmed/canceled breadcrumb follows it.
  logAction('geofence', 'Raw transition received', {
    identifier,
    ring,
    transitionType: eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit',
  });

  if (identifier.startsWith(ZONE_IDENTIFIER_PREFIX)) {
    const zoneId = parts[1];
    // Only the "for real" transition per ring counts — the other
    // combination (outer-enter, inner-exit) is the deliberate dead zone
    // between the two circles that actually gives hysteresis its value;
    // see registerGeofence's own comment for the full reasoning.
    if (ring === 'inner' && eventType === Location.GeofencingEventType.Enter) {
      const severity = await getPendingZoneSeverity(zoneId);
      await handleZoneEnter(zoneId, session.userId, session.projectId, severity);
    } else if (ring === 'outer' && eventType === Location.GeofencingEventType.Exit) {
      await handleZoneExit(zoneId);
    }
    return;
  }

  if (identifier.startsWith(SITE_IDENTIFIER_PREFIX)) {
    const projectId = parts[1];
    if (ring === 'outer' && eventType === Location.GeofencingEventType.Exit) {
      await handleExit(projectId, session.userId);
    } else if (ring === 'inner' && eventType === Location.GeofencingEventType.Enter) {
      await handleEnter(projectId);
    }
  }
});

// The task handler only has a zoneId + eventType to work with, not the
// zone's own severity (region metadata is limited to what
// startGeofencingAsync was given, which is just lat/lng/radius) — this
// reads it back from whatever registerGeofence most recently cached, so a
// fresh pending entry starts its debounce at the right duration without
// needing a network round-trip from inside the background callback.
const zoneSeverityCache = new Map<string, 'warning' | 'critical'>();
async function getPendingZoneSeverity(zoneId: string): Promise<'warning' | 'critical'> {
  return zoneSeverityCache.get(zoneId) ?? 'warning';
}

// Called from three independent places, so a confirmed exit is caught
// regardless of what the app was doing at the time: (a) a foreground poll
// while useFieldLocationTracking is mounted and active — the common case,
// since the confirmation window elapses while the phone is normally still
// on and near the site; (b) the shared background task's periodic wake
// (Part 3's own wake, reused here — see constants.ts's comment on why
// there's only one background slot available at all); (c) the app-resume
// hook, catching an exit whose window fully elapsed while backgrounded.
// Confirmation is "no ENTER arrived within the window," not a fresh
// position re-check — re-checking position on a timer would just be the
// continuous polling this feature is explicitly meant to avoid. The
// confirmed event itself goes through zoneEventQueue's 'create' op, NOT a
// direct network call — see that file's own header for why (never let a
// live network call decide whether a confirmed event was "handled").
export async function confirmPendingExitIfDue(): Promise<void> {
  const pending = await readPendingExit();
  if (!pending || pending.confirmed) return;

  const elapsedMinutes = (Date.now() - new Date(pending.exitAt).getTime()) / 60_000;
  if (elapsedMinutes < GEOFENCE_CONFIRMATION_MINUTES) return;

  const position = await captureCurrentPosition();
  const refLocalId = newLocalId();
  await enqueueZoneEvent({
    type: 'create',
    kind: 'boundary',
    refLocalId,
    projectId: pending.projectId,
    userId: pending.userId,
    exitAt: pending.exitAt,
    latitude: position?.latitude ?? null,
    longitude: position?.longitude ?? null,
    accuracyMeters: position?.accuracyMeters ?? null,
    deviceManufacturer: getDeviceManufacturer(),
    deviceModel: getDeviceModel(),
  });
  logAction('geofence', 'Debounce confirmed — boundary exit', {
    projectId: pending.projectId,
    accuracyMeters: position?.accuracyMeters ?? null,
  });
  await writePendingExit({ ...pending, confirmed: true, refLocalId });
}

// Restricted-zone counterpart to confirmPendingExitIfDue above — called
// from the same three places, in the same tick, plus a tighter foreground
// poll while anything here is pending (see useFieldLocationTracking.ts's
// own FAST_POLL_MS). Iterates every zone currently pending (there can be
// more than one, unlike the single-slot site-boundary case) and confirms
// whichever have been continuously inside their zone for that zone's own
// severity-based window.
export async function confirmPendingZoneEntriesIfDue(): Promise<void> {
  const entries = await readPendingZoneEntries();
  let changed = false;

  for (const zoneId of Object.keys(entries)) {
    const pending = entries[zoneId];
    if (pending.confirmed) continue;

    const elapsedSeconds = (Date.now() - new Date(pending.enteredAt).getTime()) / 1000;
    if (elapsedSeconds < pending.confirmationSeconds) continue;

    const position = await captureCurrentPosition();
    const refLocalId = newLocalId();
    await enqueueZoneEvent({
      type: 'create',
      kind: 'zone',
      refLocalId,
      restrictedZoneId: pending.zoneId,
      projectId: pending.projectId,
      userId: pending.userId,
      enteredAt: pending.enteredAt,
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
      accuracyMeters: position?.accuracyMeters ?? null,
      deviceManufacturer: getDeviceManufacturer(),
      deviceModel: getDeviceModel(),
    });
    logAction('geofence', 'Debounce confirmed — zone entry', {
      zoneId: pending.zoneId,
      accuracyMeters: position?.accuracyMeters ?? null,
    });
    entries[zoneId] = { ...pending, confirmed: true, refLocalId };
    changed = true;
  }

  if (changed) await writePendingZoneEntries(entries);
}

export async function isGeofenceRegistered(): Promise<boolean> {
  try {
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch {
    return false;
  }
}

// Pure status check — never prompts. The actual request only ever happens
// from BackgroundLocationExplainer's Continue button (a real user tap,
// which both platforms expect a background-location prompt to follow, not
// a silent call from a background tick — see
// lib/locationTracking/backgroundPermissionFlow.ts for that flow). This
// just tells evaluateGeofence whether it's safe to register yet.
export async function hasBackgroundLocationPermission(): Promise<boolean> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return false;
  const background = await Location.getBackgroundPermissionsAsync();
  return background.status === 'granted';
}

export interface SiteBoundary {
  projectId: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface RestrictedZoneBoundary {
  zoneId: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  severity: 'warning' | 'critical';
}

// Only ever called while inside the work-hours window, with a field-role
// session and either a configured site boundary or at least one restricted
// zone (see useFieldLocationTracking.ts) — registering outside that
// window, or with nothing to watch at all, is exactly the always-on
// battery drain Part 4 was scoped to avoid. boundary is nullable — a
// project can have restricted zones configured with no site boundary set
// at all, and those should still be watched.
//
// Each zone (and the site boundary) registers as TWO regions, not one —
// hysteresis, per the geofencing rebuild spec's point 4. Read
// constants.ts's own comment for the multipliers; the actual state-machine
// meaning is:
//   - Site boundary (what matters: confirmed EXIT) — INNER-enter is the
//     unambiguous "definitely back inside" signal; OUTER-exit is the
//     unambiguous "definitely left" signal. The middle band between the
//     two circles (an inner-exit or an outer-enter alone) is deliberately
//     ignored — that dead zone is the entire point: a device wobbling
//     right at the nominal radius no longer flips state on every fix.
//   - Restricted zone (what matters: confirmed ENTRY) — same shape,
//     mirrored: INNER-enter is "definitely inside" (starts the pending
//     entry), OUTER-exit is "definitely left" (cancels/confirms exit).
// expo-location's startGeofencingAsync takes the FULL region list on every
// call (it replaces whatever was previously registered, it doesn't add to
// it) — that's why this always passes every region together in one call
// rather than registering the boundary and zones separately.
export async function registerGeofence(boundary: SiteBoundary | null, zones: RestrictedZoneBoundary[] = []): Promise<void> {
  zoneSeverityCache.clear();
  for (const zone of zones) zoneSeverityCache.set(zone.zoneId, zone.severity);

  const regions: Location.LocationRegion[] = [];

  if (boundary) {
    regions.push(
      {
        identifier: `${SITE_IDENTIFIER_PREFIX}${boundary.projectId}:inner`,
        latitude: boundary.latitude,
        longitude: boundary.longitude,
        radius: boundary.radiusMeters * HYSTERESIS_INNER_FACTOR,
        notifyOnEnter: true,
        notifyOnExit: true,
      },
      {
        identifier: `${SITE_IDENTIFIER_PREFIX}${boundary.projectId}:outer`,
        latitude: boundary.latitude,
        longitude: boundary.longitude,
        radius: boundary.radiusMeters * HYSTERESIS_OUTER_FACTOR,
        notifyOnEnter: true,
        notifyOnExit: true,
      }
    );
  }

  // Play Services / Core Location cap circular geofences at
  // MAX_GEOFENCE_REGIONS per app — each zone costs 2 regions (hysteresis),
  // so this can be hit at far fewer zones than the raw limit suggests.
  // Never silently truncates without saying so: critical-severity zones
  // are kept first (a dropped hazard zone is worse than a dropped general
  // one), then whatever else fits, and every zone that didn't make the cut
  // is named in a single warning rather than just vanishing.
  const remainingSlots = MAX_GEOFENCE_REGIONS - regions.length;
  const maxZones = Math.max(0, Math.floor(remainingSlots / 2));
  const sortedZones = [...zones].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
  const zonesToRegister = sortedZones.slice(0, maxZones);
  const droppedZones = sortedZones.slice(maxZones);
  if (droppedZones.length > 0) {
    devWarn(
      `[locationTracking] ${droppedZones.length} restricted zone(s) exceed the ${MAX_GEOFENCE_REGIONS}-region geofence limit and are NOT being watched: ${droppedZones.map((z) => z.zoneId).join(', ')}`
    );
  }

  for (const zone of zonesToRegister) {
    regions.push(
      {
        identifier: `${ZONE_IDENTIFIER_PREFIX}${zone.zoneId}:inner`,
        latitude: zone.latitude,
        longitude: zone.longitude,
        radius: zone.radiusMeters * HYSTERESIS_INNER_FACTOR,
        notifyOnEnter: true,
        notifyOnExit: true,
      },
      {
        identifier: `${ZONE_IDENTIFIER_PREFIX}${zone.zoneId}:outer`,
        latitude: zone.latitude,
        longitude: zone.longitude,
        radius: zone.radiusMeters * HYSTERESIS_OUTER_FACTOR,
        notifyOnEnter: true,
        notifyOnExit: true,
      }
    );
  }

  if (regions.length === 0) return;
  try {
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    logAction('geofence', 'Geofences registered', {
      hasBoundary: boundary != null,
      zoneCount: zonesToRegister.length,
      innerOuterPairCount: regions.length / 2,
      droppedZoneCount: droppedZones.length,
    });
  } catch (err) {
    logError(err, 'geofence_register', { zoneCount: zonesToRegister.length, regionCount: regions.length });
    throw err;
  }
}

// Also clears any in-flight pending exit/zone-entry state — leaving the
// tracking window (end of work hours, project switched, nothing left to
// watch) means we've stopped watching those boundaries at all, so an
// unconfirmed/unresolved exit or entry tied to them is no longer
// meaningful to keep chasing. Does NOT touch the zone event queue — those
// are already-confirmed events still waiting to sync, independent of
// whatever's currently being watched.
export async function unregisterGeofence(): Promise<void> {
  if (await isGeofenceRegistered()) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
  await writePendingExit(null);
  await AsyncStorage.removeItem(PENDING_ZONE_ENTRIES_KEY);
}
