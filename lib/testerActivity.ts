import { supabase } from './supabase';
import { TESTER_EMAIL_DOMAIN } from './testerReminders';

// Devices & Logins → "Testers" (2026-11-21, client): which closed-testing
// testers used the phone app on each of the last 14 days. Filled server-side
// from the phone heartbeat (user_daily_activity, migration
// 20261121160000_tester_daily_activity.sql) — web use doesn't count.
// Google Play closed testing needs 12+ testers using the app for 14 days.

export const TESTER_DAYS = 14;
export const TESTERS_NEEDED = 12;

export interface TesterDays {
  userId: string;
  name: string;
  email: string;
  /** Oldest → today, one per day: used the phone app that day. */
  days: boolean[];
  usedToday: boolean;
  daysUsed: number;
}

const IST_MS = 5.5 * 3600 * 1000;
/** 'YYYY-MM-DD' in IST, `back` days before `now`. */
export const istDay = (now: number, back = 0) => new Date(now + IST_MS - back * 86_400_000).toISOString().slice(0, 10);

/** Pure: testers + their activity days → one line each (sorted: not used today first, then by name). */
export function testerDays(testers: { id: string; full_name: string; email: string }[], activity: { user_id: string; day: string }[], now: number): TesterDays[] {
  const keys = Array.from({ length: TESTER_DAYS }, (_, i) => istDay(now, TESTER_DAYS - 1 - i));
  const usedBy = new Map<string, Set<string>>();
  for (const a of activity) (usedBy.get(a.user_id) ?? usedBy.set(a.user_id, new Set()).get(a.user_id)!).add(a.day.slice(0, 10));
  return testers
    .map((t) => {
      const used = usedBy.get(t.id) ?? new Set<string>();
      const days = keys.map((k) => used.has(k));
      return { userId: t.id, name: t.full_name, email: t.email, days, usedToday: days[days.length - 1], daysUsed: days.filter(Boolean).length };
    })
    .sort((a, b) => Number(a.usedToday) - Number(b.usedToday) || a.name.localeCompare(b.name));
}

export async function fetchTesterDays(now: number): Promise<TesterDays[]> {
  const { data: testers, error } = await supabase
    .from('user_profiles')
    .select('id, full_name, email')
    .is('deleted_at', null)
    .eq('status', 'active')
    .ilike('email', `%${TESTER_EMAIL_DOMAIN}`);
  if (error) throw new Error(error.message);
  const ids = (testers ?? []).map((t) => t.id);
  if (!ids.length) return [];
  const { data: activity, error: e2 } = await supabase
    .from('user_daily_activity')
    .select('user_id, day')
    .in('user_id', ids)
    .gte('day', istDay(now, TESTER_DAYS - 1));
  if (e2) throw new Error(e2.message);
  return testerDays(testers ?? [], activity ?? [], now);
}

// ─── 7 PM daily summary switch (app_flags.tester_daily_summary) ─────────
export async function fetchDailySummaryOn(): Promise<boolean> {
  const { data, error } = await supabase.from('app_flags').select('enabled').eq('key', 'tester_daily_summary').maybeSingle();
  if (error) throw new Error(error.message);
  return data?.enabled ?? false;
}

export async function setDailySummaryOn(enabled: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('app_flags')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('key', 'tester_daily_summary')
    .select('key');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('Only admins can change this.');
}
