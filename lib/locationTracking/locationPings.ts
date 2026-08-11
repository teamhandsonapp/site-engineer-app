import AsyncStorage from '@react-native-async-storage/async-storage';
import { devWarn } from '../devLog';
import { supabase } from '../supabase';
import { LOCATION_PING_RETENTION_DAYS } from './constants';
import { LOCATION_PING_QUEUE_KEY } from './storageKeys';
import { recordSyncFailure, recordSyncSuccess, shouldAttemptSync } from './syncBackoff';
import { logAction, logError } from '../sentryLog';

// Addition B (part 3) — the continuous "where was this person throughout
// the day" trail, kept as its own local queue distinct from
// zoneEventQueue.ts's (per the spec's own instruction: a different kind of
// record, a periodic trail rather than a discrete boundary-crossing
// episode, and no alert logic reads from this one at all). Same
// write-locally-first principle as part 1: a ping is written here the
// INSTANT it's received, before any network attempt.
export interface PingRecord {
  localId: string;
  userId: string;
  projectId: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  occurredAt: string;
  synced: boolean;
  syncedAt: string | null;
}

const RETENTION_DAYS = LOCATION_PING_RETENTION_DAYS;
// Batched, not one-by-one, per the spec's own instruction — capped per
// call so a backlog built up over several offline days doesn't try to
// send one enormous insert; the remaining backlog just gets picked up on
// the very next sync pass instead.
const MAX_BATCH_SIZE = 200;

function newLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readQueue(): Promise<PingRecord[]> {
  const raw = await AsyncStorage.getItem(LOCATION_PING_QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PingRecord[];
  } catch {
    return [];
  }
}

async function writeQueue(items: PingRecord[]): Promise<void> {
  await AsyncStorage.setItem(LOCATION_PING_QUEUE_KEY, JSON.stringify(items));
}

export async function enqueuePing(params: {
  userId: string;
  projectId: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  occurredAt: string;
}): Promise<void> {
  const items = await readQueue();
  items.push({
    localId: newLocalId(),
    ...params,
    synced: false,
    syncedAt: null,
  });
  await writeQueue(items);
  logAction('sync', 'Event written to local queue', { queue: 'location_pings' });
}

const BACKOFF_KEY = 'location-pings';

export async function syncPendingPings(): Promise<void> {
  const items = await readQueue();
  const unsynced = items.filter((i) => !i.synced);
  if (unsynced.length === 0) {
    await pruneOldSyncedItems(items);
    return;
  }

  // Audit finding 1a — skip entirely (no network call) if offline or still
  // backing off from a recent non-connectivity failure.
  if (!(await shouldAttemptSync(BACKOFF_KEY))) {
    logAction('sync', 'Sync skipped — offline or backing off', { queue: 'location_pings', pendingCount: unsynced.length });
    return;
  }

  logAction('sync', 'Sync attempt started', { queue: 'location_pings', pendingCount: unsynced.length });

  const batch = unsynced.slice(0, MAX_BATCH_SIZE);
  try {
    const { error } = await supabase.from('location_pings').insert(
      batch.map((p) => ({
        user_id: p.userId,
        project_id: p.projectId,
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy_meters: p.accuracyMeters,
        occurred_at: p.occurredAt,
      }))
    );
    if (error) throw new Error(error.message);

    const batchIds = new Set(batch.map((p) => p.localId));
    const syncedAt = new Date().toISOString();
    for (const item of items) {
      if (batchIds.has(item.localId)) {
        item.synced = true;
        item.syncedAt = syncedAt;
      }
    }
    await writeQueue(items);
    logAction('sync', 'Sync succeeded', { queue: 'location_pings', syncedCount: batch.length });
    await recordSyncSuccess(BACKOFF_KEY);
  } catch (err) {
    // A single INSERT is all-or-nothing — one bad row fails the whole
    // batch, left unsynced for a later pass once backoff allows it.
    devWarn('[locationTracking] location ping batch sync failed, backing off:', err);
    logError(err, 'location_ping_sync', { batchSize: batch.length });
    await recordSyncFailure(BACKOFF_KEY);
  }

  await pruneOldSyncedItems(items);
}

async function pruneOldSyncedItems(items: PingRecord[]): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const kept = items.filter((i) => !i.synced || !i.syncedAt || new Date(i.syncedAt).getTime() > cutoff);
  if (kept.length !== items.length) await writeQueue(kept);
}
