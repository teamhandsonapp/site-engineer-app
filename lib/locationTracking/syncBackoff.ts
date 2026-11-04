import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

// Shared by every offline queue's sync function (zoneEventQueue.ts,
// locationPings.ts, trackingStatusQueue.ts) — audit finding 1a: syncing was
// attempted on every single tick (60s foreground / ~15min background)
// regardless of connectivity, guaranteed to fail (and burn a little battery
// on the attempt itself) whenever offline, then retried at the exact same
// fixed cadence forever even against a genuinely struggling backend.
//
// Two distinct failure modes, handled differently: (1) no connectivity —
// not a "failure" at all, just an expected state with unlimited free
// retries once it clears, so this is checked FIRST and short-circuits
// before any network call is attempted; (2) online but the server keeps
// rejecting the request — a real problem, backed off exponentially so
// repeated failures don't compound with hammering a struggling backend on
// top of whatever's already wrong.
const BASE_BACKOFF_MS = 30_000; // 30s
const MAX_BACKOFF_MS = 30 * 60_000; // 30min
const BACKOFF_KEY_PREFIX = 'field-location:sync-backoff:';

interface BackoffState {
  consecutiveFailures: number;
  nextAttemptAt: string; // ISO
}

async function readBackoff(queueKey: string): Promise<BackoffState | null> {
  const raw = await AsyncStorage.getItem(BACKOFF_KEY_PREFIX + queueKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BackoffState;
  } catch {
    return null;
  }
}

// Called before EVERY sync attempt, by every queue — returns false to skip
// the attempt entirely (no network call made at all) if there's no
// connectivity right now, or if a prior failure's backoff window hasn't
// elapsed yet. AsyncStorage-backed (not an in-memory flag) so a headless
// background task and the foreground tick share the exact same backoff
// state rather than each independently hammering the backend right after
// the other just failed.
export async function shouldAttemptSync(queueKey: string): Promise<boolean> {
  const net = await NetInfo.fetch();
  if (!net.isConnected || net.isInternetReachable === false) return false;

  const backoff = await readBackoff(queueKey);
  if (!backoff) return true;
  return Date.now() >= new Date(backoff.nextAttemptAt).getTime();
}

export async function recordSyncFailure(queueKey: string): Promise<void> {
  const existing = await readBackoff(queueKey);
  const failures = (existing?.consecutiveFailures ?? 0) + 1;
  const delayMs = Math.min(BASE_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
  await AsyncStorage.setItem(
    BACKOFF_KEY_PREFIX + queueKey,
    JSON.stringify({ consecutiveFailures: failures, nextAttemptAt: new Date(Date.now() + delayMs).toISOString() })
  );
}

export async function recordSyncSuccess(queueKey: string): Promise<void> {
  await AsyncStorage.removeItem(BACKOFF_KEY_PREFIX + queueKey);
}
