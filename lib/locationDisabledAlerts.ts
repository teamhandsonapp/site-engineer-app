import { supabase } from './supabase';

export interface LocationDisabledAlert {
  id: string;
  projectId: string | null;
  userId: string;
  userName: string | null;
  reason: string;
  disabledAtISO: string;
  enabledAtISO: string | null;
  resolved: boolean;
  resolvedAtISO: string | null;
  resolvedByName: string | null;
}

interface RawLocationDisabledAlertRow {
  id: string;
  project_id: string | null;
  user_id: string;
  reason: string;
  disabled_at: string;
  enabled_at: string | null;
  resolved: boolean;
  resolved_at: string | null;
  user: { full_name: string } | { full_name: string }[] | null;
  resolved_by: { full_name: string } | { full_name: string }[] | null;
}

function oneOrNull<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function toLocationDisabledAlert(row: RawLocationDisabledAlertRow): LocationDisabledAlert {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    userName: oneOrNull(row.user)?.full_name ?? null,
    reason: row.reason,
    disabledAtISO: row.disabled_at,
    enabledAtISO: row.enabled_at,
    resolved: row.resolved,
    resolvedAtISO: row.resolved_at,
    resolvedByName: oneOrNull(row.resolved_by)?.full_name ?? null,
  };
}

const SELECT = `
  id, project_id, user_id, reason, disabled_at, enabled_at, resolved, resolved_at,
  user:user_profiles!location_disabled_alerts_user_id_fkey(full_name),
  resolved_by:user_profiles!location_disabled_alerts_resolved_by_id_fkey(full_name)
`;

// Staff-only, same convention as fetchUnresolvedGeofenceAlerts — RLS
// already restricts this to staff regardless, filtered client-side by the
// caller's selected project like the rest of Critical Alerts' feeds.
export async function fetchUnresolvedLocationDisabledAlerts(): Promise<LocationDisabledAlert[]> {
  const { data, error } = await supabase
    .from('location_disabled_alerts')
    .select(SELECT)
    .eq('resolved', false)
    .order('disabled_at', { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawLocationDisabledAlertRow[]).map(toLocationDisabledAlert);
}

export async function resolveLocationDisabledAlert(alertId: string, resolvedByUserId: string): Promise<void> {
  const { error } = await supabase
    .from('location_disabled_alerts')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by_id: resolvedByUserId,
    })
    .eq('id', alertId);

  if (error) throw new Error(error.message);
}
