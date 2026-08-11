import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { devWarn } from '../devLog';
import { CHECKPOINTS, isWithinWorkHours, minutesSinceMidnight } from './constants';
import { getCurrentFieldSession } from './currentFieldSession';
import { insertLocationSnapshot } from './locationSnapshots';
import { CHECKPOINT_STATE_KEY } from './storageKeys';

interface CheckpointState {
  date: string; // local YYYY-MM-DD — a new day resets which checkpoints have fired
  firedIds: string[];
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function readState(today: string): Promise<CheckpointState> {
  const raw = await AsyncStorage.getItem(CHECKPOINT_STATE_KEY);
  if (!raw) return { date: today, firedIds: [] };
  try {
    const parsed = JSON.parse(raw) as CheckpointState;
    return parsed.date === today ? parsed : { date: today, firedIds: [] };
  } catch {
    return { date: today, firedIds: [] };
  }
}

async function markFired(today: string, checkpointId: string): Promise<void> {
  const state = await readState(today);
  if (state.firedIds.includes(checkpointId)) return;
  const next: CheckpointState = { date: today, firedIds: [...state.firedIds, checkpointId] };
  await AsyncStorage.setItem(CHECKPOINT_STATE_KEY, JSON.stringify(next));
}

function findDueCheckpoint(now: Date, firedIds: string[]) {
  const minutes = minutesSinceMidnight(now);
  return (
    CHECKPOINTS.find(
      (cp) => !firedIds.includes(cp.id) && Math.abs(minutes - cp.targetMinutes) <= cp.windowMinutes
    ) ?? null
  );
}

export type CheckpointRunResult =
  | { ran: false; reason: 'outside-work-hours' | 'no-session' | 'no-checkpoint-due' | 'location-read-failed' }
  | { ran: true; checkpointId: string };

// The one function called from BOTH the background task (Part 3's own
// wake-check-sleep) and the foreground app-open/resume hook (its
// reliability backstop, see FieldLocationGuard.tsx) — identical logic
// either way, so a checkpoint can never double-fire regardless of which
// path catches it first, and a checkpoint whose window has passed without
// either path running it is simply missed for the day, not fired late.
export async function runCheckpointCatchUp(): Promise<CheckpointRunResult> {
  const now = new Date();
  if (!isWithinWorkHours(now)) return { ran: false, reason: 'outside-work-hours' };

  const session = await getCurrentFieldSession();
  if (!session) return { ran: false, reason: 'no-session' };

  const today = localDateKey(now);
  const state = await readState(today);
  const due = findDueCheckpoint(now, state.firedIds);
  if (!due) return { ran: false, reason: 'no-checkpoint-due' };

  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    await insertLocationSnapshot({
      userId: session.userId,
      projectId: session.projectId,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      capturedAt: new Date(),
    });
  } catch (err) {
    // Deliberately NOT marked fired — a failed read (GPS cold-start, no
    // fix yet) should retry on the next wake still inside this same
    // checkpoint's window, not silently skip the day.
    devWarn('[locationTracking] checkpoint snapshot failed, will retry within window:', err);
    return { ran: false, reason: 'location-read-failed' };
  }

  await markFired(today, due.id);
  return { ran: true, checkpointId: due.id };
}
