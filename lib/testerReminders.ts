import { supabase } from './supabase';

// "Remind testers" (2026-11-21, client) — admin only. Testers are the active
// accounts with an @testerpmc.com email. The push is sent server-side by the
// send_tester_reminder database function (migration
// 20261121150000_tester_reminders_and_update_control.sql), through the same
// send-zone-alert Edge Function the daily-update reminders use, so testers'
// phones need no new build. Max 3 sends a day; "send to me" tests are free.

export const TESTER_EMAIL_DOMAIN = '@testerpmc.com';
export const DEFAULT_TESTER_MESSAGE = 'Hi! Please open PMC Portal and use it for 2 minutes today 🙂';
export const DAILY_LIMIT = 3;

export interface TesterAudience {
  testers: number;
  withToken: number;
  /** Testers who haven't opened the phone app today (and how many of them can get a push). */
  notUsedToday: number;
  notUsedTodayWithToken: number;
  sentToday: number;
}

const message = (e: { message?: string } | null) => (e?.message ?? 'Request failed').replace(/^.*?: /, '');

export async function fetchTesterAudience(): Promise<TesterAudience> {
  const { data, error } = await supabase.rpc('tester_reminder_audience');
  if (error) throw new Error(message(error));
  return data as TesterAudience;
}

export async function sendTesterReminder(body: string, testToMe: boolean, onlyNotUsedToday = false): Promise<{ sent: number; remainingToday: number }> {
  const { data, error } = await supabase.rpc('send_tester_reminder', { p_body: body, p_test: testToMe, p_only_missing: onlyNotUsedToday });
  if (error) throw new Error(error.message);
  return data as { sent: number; remainingToday: number };
}
