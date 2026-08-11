import AsyncStorage from '@react-native-async-storage/async-storage';
import { devWarn } from '../devLog';
import {
  findOpenTrackingDegradedAlertId,
  insertLocationDisabledAlert,
  markLocationDisabledAlertEnabled,
  type LocationDisabledReason,
} from './locationDisabledAlerts';
import { TRACKING_STATUS_QUEUE_KEY } from './storageKeys';
import { recordSyncFailure, recordSyncSuccess, shouldAttemptSync } from './syncBackoff';
import { logAction, logError } from '../sentryLog';

// Addition A (part 3) — "queue this status update the same way as zone
// events in part 1... don't rely on a live network call succeeding at the
// exact moment of detection." Mirrors zoneEventQueue.ts's own shape almost
// exactly: a durable AsyncStorage-backed FIFO, written synchronously the
// instant a transition is detected, retried forever on every tick
// regardless of which context (foreground hook or the headless ping task)
// noticed it. Each op becomes one row in location_disabled_alerts — the
// SAME table Part 2's whole-app gate already uses, just with the two new
// reasons scoped to this feature (see locationDisabledAlerts.ts's own
// comment on why the two features can't collide there).
export type TrackingStatusOp =
  | { type: 'degraded'; userId: string; projectId: string | null; reason: LocationDisabledReason }
  | { type: 'restored'; userId: string };

interface QueueItem {
  localId: string;
  op: TrackingStatusOp;
  createdAt: string;
  synced: boolean;
  syncedAt: string | null;
  lastError: string | null;
}

const RETENTION_DAYS = 7;

function newLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readQueue(): Promise<QueueItem[]> {
  const raw = await AsyncStorage.getItem(TRACKING_STATUS_QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueueItem[];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueueItem[]): Promise<void> {
  await AsyncStorage.setItem(TRACKING_STATUS_QUEUE_KEY, JSON.stringify(items));
}

export async function enqueueTrackingStatusEvent(op: TrackingStatusOp): Promise<void> {
  const items = await readQueue();
  items.push({
    localId: newLocalId(),
    op,
    createdAt: new Date().toISOString(),
    synced: false,
    syncedAt: null,
    lastError: null,
  });
  await writeQueue(items);
  logAction('sync', 'Event written to local queue', { queue: 'tracking_status', opType: op.type });
}

const BACKOFF_KEY = 'tracking-status';

export async function syncPendingTrackingStatusEvents(): Promise<void> {
  const items = await readQueue();
  const unsynced = items.filter((i) => !i.synced);
  if (unsynced.length === 0) {
    await pruneOldSyncedItems(items);
    return;
  }

  // Audit finding 1a — skip entirely (no network call) if offline or still
  // backing off from a recent non-connectivity failure.
  if (!(await shouldAttemptSync(BACKOFF_KEY))) {
    logAction('sync', 'Sync skipped — offline or backing off', { queue: 'tracking_status', pendingCount: unsynced.length });
    return;
  }

  logAction('sync', 'Sync attempt started', { queue: 'tracking_status', pendingCount: unsynced.length });

  let changed = false;
  let anyFailure = false;
  for (const item of unsynced) {
    try {
      if (item.op.type === 'degraded') {
        await insertLocationDisabledAlert({
          userId: item.op.userId,
          projectId: item.op.projectId,
          reason: item.op.reason,
        });
      } else {
        const openId = await findOpenTrackingDegradedAlertId(item.op.userId);
        if (openId) await markLocationDisabledAlertEnabled(openId);
        // No open row to close is a legitimate outcome (e.g. this
        // 'restored' op's paired 'degraded' op hasn't synced yet, in
        // FIFO order it's processed first anyway) — not an error, so this
        // still marks synced rather than retrying forever for nothing.
      }
      item.synced = true;
      item.syncedAt = new Date().toISOString();
      changed = true;
    } catch (err) {
      anyFailure = true;
      item.lastError = err instanceof Error ? err.message : String(err);
      devWarn(`[locationTracking] tracking-status queue item ${item.localId} failed to sync:`, item.lastError);
      logError(err, 'tracking_status_sync', { localId: item.localId, opType: item.op.type });
    }
  }

  if (changed) await writeQueue(items);
  if (anyFailure) {
    await recordSyncFailure(BACKOFF_KEY);
  } else {
    logAction('sync', 'Sync succeeded', { queue: 'tracking_status', syncedCount: unsynced.length });
    await recordSyncSuccess(BACKOFF_KEY);
  }
  await pruneOldSyncedItems(items);
}

async function pruneOldSyncedItems(items: QueueItem[]): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const kept = items.filter((i) => !i.synced || !i.syncedAt || new Date(i.syncedAt).getTime() > cutoff);
  if (kept.length !== items.length) await writeQueue(kept);
}
