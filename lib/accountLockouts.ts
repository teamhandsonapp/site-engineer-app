import { supabase } from './supabase';

// UI-facing fetch/reactivate for Section 5's audit trail — mirrors
// restrictedZoneAlerts.ts's split (tracking-side writes live in
// lib/locationTracking/gpsLockout.ts, this file is the Critical Alerts
// screen's own read/action side). Reactivation goes through the
// reactivate_gps_locked_account Postgres function, not a plain table
// UPDATE — see add-gps-lockout.sql's own comment for why a plain RLS-scoped
// UPDATE can't safely restrict this to admin/manager alone.
export interface AccountLockout {
  id: string;
  userId: string;
  userName: string | null;
  reason: string;
  lockedAtISO: string;
  deviceManufacturer: string | null;
  deviceModel: string | null;
}

// Shared with the per-engineer admin detail screen (app/team-attendance-
// detail/[userId].tsx) — was previously only defined locally inside
// critical-alerts.tsx; moved here once a second screen needed the exact
// same reason -> label mapping, so there's one source of truth instead of
// two copies that could drift.
export const LOCKOUT_REASON_LABEL: Record<string, string> = {
  location_services_disabled: 'Location services were turned off',
};

// Two FKs from account_lockouts to user_profiles (user_id and
// reactivated_by_id) — same to-one-embed-may-arrive-as-an-array caveat as
// restrictedZoneAlerts.ts's RawRestrictedZoneAlertRow, and the explicit
// constraint name is required here (not just optional disambiguation) since
// PostgREST can't infer which of the two FKs a bare `user_profiles(...)`
// embed means.
interface RawAccountLockoutRow {
  id: string;
  user_id: string;
  reason: string;
  locked_at: string;
  device_manufacturer: string | null;
  device_model: string | null;
  user: { full_name: string } | { full_name: string }[] | null;
}

function oneOrNull<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

const SELECT = `
  id, user_id, reason, locked_at, device_manufacturer, device_model,
  user:user_profiles!account_lockouts_user_id_fkey(full_name)
`;

// RLS already restricts this to admin/manager (add-gps-lockout.sql) — a
// field role calling this just gets an empty array back, same "let RLS do
// the real narrowing" convention as every other fetchUnresolved* here.
export async function fetchUnresolvedAccountLockouts(): Promise<AccountLockout[]> {
  const { data, error } = await supabase
    .from('account_lockouts')
    .select(SELECT)
    .is('reactivated_at', null)
    .order('locked_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawAccountLockoutRow[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    userName: oneOrNull(r.user)?.full_name ?? null,
    reason: r.reason,
    lockedAtISO: r.locked_at,
    deviceManufacturer: r.device_manufacturer,
    deviceModel: r.device_model,
  }));
}

export async function reactivateAccountLockout(lockoutId: string): Promise<void> {
  const { error } = await supabase.rpc('reactivate_gps_locked_account', { p_lockout_id: lockoutId });
  if (error) throw new Error(error.message);
}

// ── Per-engineer detail screen ─────────────────────────────────────────
// Distinct from fetchUnresolvedAccountLockouts above (Critical Alerts'
// cross-engineer feed of only CURRENTLY-locked accounts) — this is for one
// specific engineer's detail screen, which also needs to keep showing
// "Reactivated by X at Y" as a small audit note after the lock has already
// cleared, not just while it's active.
export interface LatestAccountLockout {
  id: string;
  reason: string;
  lockedAtISO: string;
  deviceManufacturer: string | null;
  deviceModel: string | null;
  reactivatedAtISO: string | null;
  reactivatedByName: string | null;
}

interface RawLatestLockoutRow {
  id: string;
  reason: string;
  locked_at: string;
  device_manufacturer: string | null;
  device_model: string | null;
  reactivated_at: string | null;
  reactivated_by: { full_name: string } | { full_name: string }[] | null;
}

const LATEST_SELECT = `
  id, reason, locked_at, device_manufacturer, device_model, reactivated_at,
  reactivated_by:user_profiles!account_lockouts_reactivated_by_id_fkey(full_name)
`;

async function fetchLatestAccountLockout(userId: string): Promise<LatestAccountLockout | null> {
  const { data, error } = await supabase
    .from('account_lockouts')
    .select(LATEST_SELECT)
    .eq('user_id', userId)
    .order('locked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as unknown as RawLatestLockoutRow;
  return {
    id: r.id,
    reason: r.reason,
    lockedAtISO: r.locked_at,
    deviceManufacturer: r.device_manufacturer,
    deviceModel: r.device_model,
    reactivatedAtISO: r.reactivated_at,
    reactivatedByName: oneOrNull(r.reactivated_by)?.full_name ?? null,
  };
}

export interface AccountLockStatus {
  // The live source of truth (user_profiles.gps_locked_at IS NOT NULL) —
  // read fresh on every call, never inferred from `latest` alone (a
  // reactivated `latest` row plus a NEW lock that hasn't written its own
  // account_lockouts row yet, however unlikely given lock_own_account_for_gps
  // writes both in the same statement, would otherwise disagree).
  isLocked: boolean;
  // Most recent lockout event for this engineer, locked or already
  // reactivated — null if this engineer has never been locked.
  latest: LatestAccountLockout | null;
}

export async function fetchAccountLockStatus(userId: string): Promise<AccountLockStatus> {
  const [profileRes, latest] = await Promise.all([
    supabase.from('user_profiles').select('gps_locked_at').eq('id', userId).single(),
    fetchLatestAccountLockout(userId),
  ]);
  if (profileRes.error) throw new Error(profileRes.error.message);
  return { isLocked: (profileRes.data as { gps_locked_at: string | null }).gps_locked_at != null, latest };
}
