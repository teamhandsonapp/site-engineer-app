import { supabase } from '../supabase';
import { getDeviceManufacturer, getDeviceModel } from './deviceInfo';

// Tracking-side writes only (mirrors geofence.ts/geofenceAlerts.ts's own
// split) — lib/locationDisabledAlerts.ts (top level) has the UI-facing
// fetch/resolve used by Critical Alerts.

export async function findOpenLocationDisabledAlertId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('location_disabled_alerts')
    .select('id')
    .eq('user_id', userId)
    .is('enabled_at', null)
    .order('disabled_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null; // best-effort reconciliation — a failed read just means we might create one extra row
  return (data as { id: string } | null)?.id ?? null;
}

// 'no_fix_timeout' — Section 5's Case A (dead zone/weak signal): permission
// and services are both fine, but no GPS fix has arrived in
// DEAD_ZONE_TIMEOUT_MINUTES. Logged exactly like the other tracking-degraded
// reasons below (never locks the account — see gpsLockout.ts).
export type LocationDisabledReason = 'permission' | 'services' | 'background_permission' | 'gps_disabled' | 'no_fix_timeout';

// Scoped to Part 3's own two reasons only — the whole-app gate (Part 2's
// useLocationDisabledAlertTracking, reasons 'permission'/'services') and
// Addition A's shift-scoped tracking-status queue each only ever look for
// (and close) their OWN open episodes, so the two features can't
// accidentally interfere with each other's rows in this shared table.
export async function findOpenTrackingDegradedAlertId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('location_disabled_alerts')
    .select('id')
    .eq('user_id', userId)
    .in('reason', ['background_permission', 'gps_disabled'])
    .is('enabled_at', null)
    .order('disabled_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as { id: string } | null)?.id ?? null;
}

// Scoped to one EXACT reason (not either of the two, like the function
// above) — used by insertLocationDisabledAlert's own dedup guard, and
// exported for gpsLockout.ts's own dead-zone-recovery check ('no_fix_timeout'
// isn't one of the two reasons findOpenTrackingDegradedAlertId above looks
// for, so that shared function can't be reused for it without changing its
// behavior for the two callers that already depend on it). A real reason
// CHANGE mid-episode (e.g. background permission gets re-granted while GPS
// is still off, so the next check reports 'gps_disabled') is a genuine new
// episode and should still open its own row; only a repeat report of the
// SAME reason while one's already open is the duplicate this guards against.
export async function findOpenTrackingDegradedAlertIdForReason(userId: string, reason: LocationDisabledReason): Promise<string | null> {
  const { data, error } = await supabase
    .from('location_disabled_alerts')
    .select('id')
    .eq('user_id', userId)
    .eq('reason', reason)
    .is('enabled_at', null)
    .order('disabled_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as { id: string } | null)?.id ?? null;
}

// De-dupes against an already-open episode for the SAME reason before
// inserting — this check-then-insert alone is NOT what actually prevents a
// duplicate row (see the unique index below for that); it's just a cheap
// short-circuit that skips a network round trip in the common case. The
// real race: the foreground poll (trackingStatus.ts's useTrackingStatus,
// every 5s + AppState resume) and the headless background ping task
// (locationPingTask.ts) both funnel through reportTrackingStatusIfChanged,
// whose own "is this actually new" short-circuit reads/writes AsyncStorage
// non-atomically — two calls close enough together can both read "no open
// row" here before either INSERT below commits. Confirmed live: two
// location_disabled_alerts rows with the identical disabled_at, each later
// matched to a DIFFERENT 'restored' op (hence two different enabled_at
// values).
//
// Bug 1.2 fix — this check-then-insert is inherently racy on its own (two
// round trips, nothing atomic), so the actual guarantee now comes from a
// partial UNIQUE INDEX on (user_id, reason) WHERE enabled_at IS NULL
// (fix-location-disabled-alerts-dedup-race.sql) — the database itself
// refuses a second open row for the same (user, reason), full stop,
// regardless of how many callers race past the check above. A unique-
// violation here (Postgres code 23505) means someone else's insert won
// that race a moment ago — not a real failure — so this re-fetches and
// returns THEIR row's id instead of throwing.
export async function insertLocationDisabledAlert(params: {
  userId: string;
  projectId: string | null;
  reason: LocationDisabledReason;
}): Promise<string> {
  const existingOpenId = await findOpenTrackingDegradedAlertIdForReason(params.userId, params.reason);
  if (existingOpenId) return existingOpenId;

  const { data, error } = await supabase
    .from('location_disabled_alerts')
    .insert({
      user_id: params.userId,
      project_id: params.projectId,
      reason: params.reason,
      disabled_at: new Date().toISOString(),
      device_manufacturer: getDeviceManufacturer(),
      device_model: getDeviceModel(),
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const winnerId = await findOpenTrackingDegradedAlertIdForReason(params.userId, params.reason);
      if (winnerId) return winnerId;
    }
    throw new Error(error.message);
  }
  return (data as { id: string }).id;
}

export async function markLocationDisabledAlertEnabled(alertId: string): Promise<void> {
  const { error } = await supabase
    .from('location_disabled_alerts')
    .update({ enabled_at: new Date().toISOString() })
    .eq('id', alertId);
  if (error) throw new Error(error.message);
}
