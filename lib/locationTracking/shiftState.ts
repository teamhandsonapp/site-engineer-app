import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { devWarn } from '../devLog';
import { fetchTodaysAttendance } from '../attendance';
import { logError } from '../sentryLog';
import { SHIFT_STATE_KEY } from './storageKeys';

// This no longer gates background tracking at all — by explicit product
// decision, tracking runs on the scheduled shift window alone
// (shiftWindow.ts), fully independent of manual clock-in/out. What's left
// here is purely the manual attendance signal itself: a locally-persisted
// mirror of "is the last attendance_records row today a CHECK_IN," kept
// around for useShiftState's own Sentry `shiftActive` tag (handy for
// filtering error reports by whether an engineer was clocked in at the
// time) and reconciled from the backend on resume.
export interface ShiftState {
  isOn: boolean;
  sinceISO: string | null;
}

const OFF_STATE: ShiftState = { isOn: false, sinceISO: null };

export async function readShiftState(): Promise<ShiftState> {
  const raw = await AsyncStorage.getItem(SHIFT_STATE_KEY);
  if (!raw) return OFF_STATE;
  try {
    return JSON.parse(raw) as ShiftState;
  } catch {
    return OFF_STATE;
  }
}

// Called from lib/attendance.ts the instant a check-in/out is recorded —
// this write happens synchronously with the check-in itself so useShiftState
// has an immediately-correct local value to read on the very next render,
// rather than waiting on the next backend reconciliation pass.
export async function writeShiftState(state: ShiftState): Promise<void> {
  await AsyncStorage.setItem(SHIFT_STATE_KEY, JSON.stringify(state));
}

// Local persisted state is refreshed on a short poll (cheap AsyncStorage
// read) so a check-in/out on the Attendance screen is picked up by this
// hook promptly even though the two live in different, already-mounted
// parts of the tree (FieldLocationGuard wraps the whole authenticated app,
// it doesn't unmount/remount when navigating to Attendance) — same
// "poll as a backstop" shape as locationGate.ts's own POLL_MS.
const LOCAL_POLL_MS = 5_000;

export function useShiftState(enabled: boolean, userId: string | null): ShiftState {
  const [state, setState] = useState<ShiftState>(OFF_STATE);

  useEffect(() => {
    if (!enabled || !userId) return; // the return value below already reports OFF_STATE while disabled
    const uid = userId; // narrowed to non-null for the closures below

    let cancelled = false;

    async function readLocal() {
      const persisted = await readShiftState();
      if (!cancelled) setState(persisted);
    }

    // Backend is the authoritative source for whether today's LAST
    // attendance record is actually still a CHECK_IN — this is what
    // self-corrects the one gap local-only persistence can't cover: the
    // app being force-killed or crashing mid-shift, with the calendar day
    // rolling over before it's next reopened, which would otherwise leave
    // a stale "still clocked in from yesterday" flag tracking someone on
    // their own time (exactly the privacy/legal exposure this point
    // exists to avoid). Only run on mount/resume, not the tight local
    // poll below — a network round-trip on every 5s tick would be
    // needless chatter for something that only changes on a deliberate
    // user action or an app reopen.
    async function reconcileWithBackend() {
      await readLocal();
      try {
        const records = await fetchTodaysAttendance(uid);
        const last = records[records.length - 1] ?? null;
        const reconciled: ShiftState =
          last?.type === 'CHECK_IN' ? { isOn: true, sinceISO: last.clientCapturedAtISO } : OFF_STATE;
        await writeShiftState(reconciled);
        if (!cancelled) setState(reconciled);
      } catch (err) {
        devWarn('[locationTracking] shift-state reconciliation failed, trusting local state:', err);
        logError(err, 'shift_state_reconcile');
      }
    }

    reconcileWithBackend();
    const pollId = setInterval(readLocal, LOCAL_POLL_MS);
    const appStateSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') reconcileWithBackend();
    });

    return () => {
      cancelled = true;
      clearInterval(pollId);
      appStateSub.remove();
    };
  }, [enabled, userId]);

  const value = enabled && userId ? state : OFF_STATE;

  // Any error caught anywhere in the app while this tag is 'true' can be
  // filtered for in the Sentry dashboard (`shiftActive:true`) without
  // needing to inspect each issue's breadcrumb trail individually — set as
  // a context change whenever the computed value actually changes, not
  // inside every internal setState call above.
  useEffect(() => {
    Sentry.setTag('shiftActive', String(value.isOn));
  }, [value.isOn]);

  return value;
}
