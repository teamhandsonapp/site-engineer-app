import Constants, { AppOwnership } from 'expo-constants';
import { Platform } from 'react-native';
import { devWarn } from '../devLog';
import { fetchProjectSettings } from '../projectSettings';
import { logError } from '../sentryLog';

// A visible, OS-scheduled daily nudge — the backstop for when NEITHER the
// background snapshot task's own self-heal (see backgroundSnapshotTask.ts)
// NOR an overnight-surviving foreground service actually resumed tracking
// on their own (a hard OEM kill, or the app got fully force-stopped, which
// revokes even WorkManager's ability to wake this app at all — nothing
// software-side can override that specific case). This is a plain OS
// notification-scheduling call, not app code that has to survive the
// night — Android/iOS own the alarm that fires it, so it doesn't depend on
// this app's own background execution surviving anything.
//
// expo-notifications has no real implementation on web (same as every
// other notification call in this app) and Expo Go can't hold a real
// scheduled notification across app restarts either — skipped on both,
// same guard as localAlertNotification.ts/pushNotifications.ts.
const isWeb = Platform.OS === 'web';
const isExpoGo = Constants.appOwnership === AppOwnership.Expo;
const Notifications = !isWeb && !isExpoGo
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-notifications') as typeof import('expo-notifications'))
  : null;

// Fixed, not random — scheduleNotificationAsync with the SAME identifier
// REPLACES whichever notification already has it rather than creating a
// duplicate, which is what makes this safe to call idempotently every time
// tracking activates (sign-in, app resume) instead of needing its own
// AsyncStorage "already scheduled" guard.
const DAILY_REMINDER_ID = 'daily-tracking-start-reminder';

// How long before the scheduled shift start to nudge — enough margin that
// opening the app right away still gets tracking running before the
// window's own official start, not a reminder that fires exactly AT (or
// after) the moment it was meant to prevent being late for.
const REMINDER_LEAD_MINUTES = 10;

export async function scheduleDailyTrackingReminder(projectId: string | null): Promise<void> {
  if (!Notifications) return;
  try {
    // Falls back to the app-wide default (9:00 AM) when no project is
    // selected yet rather than skipping scheduling entirely — same
    // reasoning as trackingHealth.ts's own shiftStartMinutes fallback.
    const shiftStartMinutes = projectId ? (await fetchProjectSettings(projectId)).shiftStartMinutes : 9 * 60;
    const reminderMinutes = Math.max(0, shiftStartMinutes - REMINDER_LEAD_MINUTES);
    const hour = Math.floor(reminderMinutes / 60);
    const minute = reminderMinutes % 60;

    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_REMINDER_ID,
      content: {
        title: 'Start today’s site tracking',
        body: 'Open PMC Portal now so location tracking starts on time.',
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
    });
  } catch (err) {
    // Never worth blocking anything else over — this is a convenience
    // nudge, not a load-bearing part of tracking itself.
    devWarn('[locationTracking] failed to schedule daily tracking reminder:', err);
    logError(err, 'daily_tracking_reminder_schedule');
  }
}

export async function cancelDailyTrackingReminder(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID);
  } catch {
    // Fine if it was never scheduled in the first place.
  }
}

// The symmetric gap this file didn't cover before: a reminder existed for
// starting the day, none for ending it. Confirmed live (real
// attendance_records data, 2026-08-14): BOTH real field accounts have a
// history of checking in and then never checking out on the same day,
// repeatedly, across many separate days — not a one-off. That pattern is
// exactly what turned into a hard, permanent block once
// enforce_attendance_sequence() (fix-attendance-db-backstop.sql) started
// rejecting a next-day check-in against a still-open prior session (see
// fix-attendance-sequence-day-boundary.sql for that specific fix) — this
// reminder addresses the root behavior causing it (forgetting to check
// out at all), not just the downstream error message.
//
// Deliberately unconditional — fires whether or not the person already
// checked out that day, same as the existing start-of-shift reminder
// above (which also never checks "did tracking already start" before
// firing). Checking that here would need a background task at fire-time
// to query attendance_records, which the morning reminder doesn't do
// either; matching that existing precedent rather than making only this
// one smarter.
const CHECKOUT_REMINDER_ID = 'daily-checkout-reminder';

// Checkout itself is disabled in the UI until the scheduled end time (see
// attendance.tsx's own canCheckOutNow) — firing a few minutes AFTER that,
// not before, so the reminder lands right as the button actually becomes
// tappable instead of nudging someone toward a still-disabled button.
const CHECKOUT_REMINDER_LAG_MINUTES = 5;

export async function scheduleCheckoutReminder(projectId: string | null): Promise<void> {
  if (!Notifications) return;
  try {
    // Falls back to the app-wide default (6:00 PM, WORK_HOURS_END_MINUTES)
    // when no project is selected — same fallback convention as the
    // start-of-shift reminder above.
    const shiftEndMinutes = projectId ? (await fetchProjectSettings(projectId)).shiftEndMinutes : 18 * 60;
    const reminderMinutes = (shiftEndMinutes ?? 18 * 60) + CHECKOUT_REMINDER_LAG_MINUTES;
    const hour = Math.floor(reminderMinutes / 60) % 24;
    const minute = reminderMinutes % 60;

    await Notifications.scheduleNotificationAsync({
      identifier: CHECKOUT_REMINDER_ID,
      content: {
        title: "Don't forget to check out",
        body: 'Your shift has ended — open PMC Portal to check out for today.',
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
    });
  } catch (err) {
    devWarn('[locationTracking] failed to schedule checkout reminder:', err);
    logError(err, 'daily_checkout_reminder_schedule');
  }
}

export async function cancelCheckoutReminder(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(CHECKOUT_REMINDER_ID);
  } catch {
    // Fine if it was never scheduled in the first place.
  }
}
