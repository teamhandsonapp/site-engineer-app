import AsyncStorage from '@react-native-async-storage/async-storage';
import { devWarn } from '../devLog';
import { insertConfirmedGeofenceAlert, markGeofenceAlertReturned } from './geofenceAlerts';
import { insertConfirmedRestrictedZoneAlert, markRestrictedZoneAlertExited } from './restrictedZones';
import { ZONE_EVENT_QUEUE_KEY } from './storageKeys';
import { recordSyncFailure, recordSyncSuccess, shouldAttemptSync } from './syncBackoff';
import { logAction, logError } from '../sentryLog';

// The durable local queue point 5 of the geofencing rebuild spec asks
// for (Room + WorkManager in the native-Android framing) — this is its
// real Expo equivalent: an AsyncStorage-backed JSON array (matches this
// codebase's own existing PendingExit/PendingZoneEntry convention rather
// than introducing expo-sqlite for what's expected to stay a small row
// count) instead of a Room table, synced by the SAME shared background
// tick + foreground interval this app already uses for every other
// periodic check (there's no WorkManager equivalent in Expo/RN — no
// native module here promises a persisted, guaranteed-eventually-run job
// surviving process death and reboot the way WorkManager does; the
// closest honest substitute is "keep retrying on every tick, forever,
// until it succeeds," which is what this implements).
//
// A confirmed event is a two-phase episode, not a flat log line: a
// 'create' op writes the initial alert row and gets a remote id back;
// a LATER 'mark-return'/'mark-exit' op updates that SAME row once the
// user returns/leaves. Both phases go through this one queue so an
// offline gap between them can never silently drop the second half —
// each op carries the SAME refLocalId as its paired create, and the sync
// loop below only attempts a mark-* op once it can resolve which synced
// create it belongs to (which might not be until a later pass, if the
// create itself hadn't synced yet).
export type QueuedOperation =
  | {
      type: 'create';
      kind: 'boundary';
      refLocalId: string;
      projectId: string;
      userId: string;
      exitAt: string;
      latitude: number | null;
      longitude: number | null;
      accuracyMeters: number | null;
      deviceManufacturer: string | null;
      deviceModel: string | null;
    }
  | {
      type: 'create';
      kind: 'zone';
      refLocalId: string;
      restrictedZoneId: string;
      projectId: string;
      userId: string;
      enteredAt: string;
      latitude: number | null;
      longitude: number | null;
      accuracyMeters: number | null;
      deviceManufacturer: string | null;
      deviceModel: string | null;
    }
  | { type: 'mark-return'; kind: 'boundary'; refLocalId: string }
  | { type: 'mark-exit'; kind: 'zone'; refLocalId: string };

interface QueueItem {
  localId: string;
  op: QueuedOperation;
  createdAt: string;
  synced: boolean;
  syncedAt: string | null;
  remoteAlertId: string | null; // only ever set on a synced 'create' item
  lastError: string | null;
}

// Retained after syncing for on-device debugging/support, per the spec's
// own instruction — pruned on a schedule, not deleted the instant they sync.
const RETENTION_DAYS = 7;

function newLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readQueue(): Promise<QueueItem[]> {
  const raw = await AsyncStorage.getItem(ZONE_EVENT_QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueueItem[];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueueItem[]): Promise<void> {
  await AsyncStorage.setItem(ZONE_EVENT_QUEUE_KEY, JSON.stringify(items));
}

// Called the instant an event is confirmed (see geofence.ts) — synchronous
// from the caller's point of view (just an AsyncStorage write), no network
// call, before any attempt to sync. This is what actually satisfies "never
// wait on a live network call to consider the event handled" — the write
// here IS considering it handled; syncPendingZoneEvents below is a
// separate, retried-forever concern.
export async function enqueueZoneEvent(op: QueuedOperation): Promise<void> {
  const items = await readQueue();
  items.push({
    localId: newLocalId(),
    op,
    createdAt: new Date().toISOString(),
    synced: false,
    syncedAt: null,
    remoteAlertId: null,
    lastError: null,
  });
  await writeQueue(items);
  logAction('sync', 'Event written to local queue', { queue: 'zone_events', opType: op.type, opKind: op.kind });
}

// Resolves which remote alert id a 'mark-*' op's paired 'create' landed
// on — undefined if that create hasn't synced yet (the mark-* op is left
// for a later pass in that case, never dropped).
function findRemoteAlertId(items: QueueItem[], refLocalId: string): string | undefined {
  const created = items.find((i) => i.op.type === 'create' && i.op.refLocalId === refLocalId && i.synced);
  return created?.remoteAlertId ?? undefined;
}

const BACKOFF_KEY = 'zone-events';

// Processed in FIFO order (oldest first) every tick — see
// useFieldLocationTracking.ts's own tick() and backgroundSnapshotTask.ts,
// both of which call this. Each item is attempted independently; one
// failure never blocks the rest of the queue from syncing.
export async function syncPendingZoneEvents(): Promise<void> {
  const items = await readQueue();
  const unsynced = items.filter((i) => !i.synced);
  if (unsynced.length === 0) {
    await pruneOldSyncedItems(items);
    return;
  }

  // Audit finding 1a — skip the attempt entirely (no network call at all)
  // if offline or still within a backoff window from a recent non-
  // connectivity failure. See syncBackoff.ts's own header for why the two
  // are treated differently.
  if (!(await shouldAttemptSync(BACKOFF_KEY))) {
    logAction('sync', 'Sync skipped — offline or backing off', { queue: 'zone_events', pendingCount: unsynced.length });
    return;
  }

  logAction('sync', 'Sync attempt started', { queue: 'zone_events', pendingCount: unsynced.length });

  let changed = false;
  let anyFailure = false;
  for (const item of unsynced) {
    try {
      if (item.op.type === 'create' && item.op.kind === 'boundary') {
        const alertId = await insertConfirmedGeofenceAlert({
          projectId: item.op.projectId,
          userId: item.op.userId,
          exitAt: new Date(item.op.exitAt),
          latitude: item.op.latitude ?? undefined,
          longitude: item.op.longitude ?? undefined,
          accuracyMeters: item.op.accuracyMeters ?? undefined,
          deviceManufacturer: item.op.deviceManufacturer ?? undefined,
          deviceModel: item.op.deviceModel ?? undefined,
        });
        item.remoteAlertId = alertId;
        item.synced = true;
        item.syncedAt = new Date().toISOString();
        changed = true;
      } else if (item.op.type === 'create' && item.op.kind === 'zone') {
        const alertId = await insertConfirmedRestrictedZoneAlert({
          restrictedZoneId: item.op.restrictedZoneId,
          projectId: item.op.projectId,
          userId: item.op.userId,
          enteredAt: new Date(item.op.enteredAt),
          latitude: item.op.latitude ?? undefined,
          longitude: item.op.longitude ?? undefined,
          accuracyMeters: item.op.accuracyMeters ?? undefined,
          deviceManufacturer: item.op.deviceManufacturer ?? undefined,
          deviceModel: item.op.deviceModel ?? undefined,
        });
        item.remoteAlertId = alertId;
        item.synced = true;
        item.syncedAt = new Date().toISOString();
        changed = true;
      } else if (item.op.type === 'mark-return' || item.op.type === 'mark-exit') {
        const remoteAlertId = findRemoteAlertId(items, item.op.refLocalId);
        if (!remoteAlertId) continue; // paired create hasn't synced yet — retry next pass
        if (item.op.type === 'mark-return') {
          await markGeofenceAlertReturned(remoteAlertId);
        } else {
          await markRestrictedZoneAlertExited(remoteAlertId);
        }
        item.synced = true;
        item.syncedAt = new Date().toISOString();
        changed = true;
      }
    } catch (err) {
      anyFailure = true;
      item.lastError = err instanceof Error ? err.message : String(err);
      devWarn(`[locationTracking] zone event queue item ${item.localId} failed to sync:`, item.lastError);
      // Left unsynced — retried on a later pass, once shouldAttemptSync's
      // own backoff window (set below) allows it. Still a real Sentry
      // issue now, not just a console line — a caught-and-only-logged-
      // locally failure here would otherwise never surface anywhere.
      logError(err, 'zone_event_sync', { localId: item.localId, opType: item.op.type, opKind: item.op.kind });
    }
  }

  if (changed) await writeQueue(items);
  if (anyFailure) {
    await recordSyncFailure(BACKOFF_KEY);
  } else {
    logAction('sync', 'Sync succeeded', { queue: 'zone_events', syncedCount: unsynced.length });
    await recordSyncSuccess(BACKOFF_KEY);
  }
  await pruneOldSyncedItems(items);
}

async function pruneOldSyncedItems(items: QueueItem[]): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const kept = items.filter((i) => !i.synced || !i.syncedAt || new Date(i.syncedAt).getTime() > cutoff);
  if (kept.length !== items.length) await writeQueue(kept);
}
