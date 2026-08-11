import { supabase } from './supabase';

export interface GeofenceAlert {
  id: string;
  projectId: string;
  userName: string | null;
  exitAtISO: string;
  confirmedAtISO: string;
  returnedAtISO: string | null;
  resolved: boolean;
  resolvedAtISO: string | null;
  resolvedByName: string | null;
}

// Same to-one-embed-may-arrive-as-an-array caveat as siteIssues.ts's
// RawSiteIssueRow — no generated Supabase types in this repo.
interface RawGeofenceAlertRow {
  id: string;
  project_id: string;
  exit_at: string;
  confirmed_at: string;
  returned_at: string | null;
  resolved: boolean;
  resolved_at: string | null;
  user: { full_name: string } | { full_name: string }[] | null;
  resolved_by: { full_name: string } | { full_name: string }[] | null;
}

function oneOrNull<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function toGeofenceAlert(row: RawGeofenceAlertRow): GeofenceAlert {
  return {
    id: row.id,
    projectId: row.project_id,
    userName: oneOrNull(row.user)?.full_name ?? null,
    exitAtISO: row.exit_at,
    confirmedAtISO: row.confirmed_at,
    returnedAtISO: row.returned_at,
    resolved: row.resolved,
    resolvedAtISO: row.resolved_at,
    resolvedByName: oneOrNull(row.resolved_by)?.full_name ?? null,
  };
}

const SELECT = `
  id, project_id, exit_at, confirmed_at, returned_at, resolved, resolved_at,
  user:user_profiles!geofence_alerts_user_id_fkey(full_name),
  resolved_by:user_profiles!geofence_alerts_resolved_by_id_fkey(full_name)
`;

// Staff-only, same convention as fetchUnresolvedSiteIssues — RLS already
// restricts this to staff regardless, filtered client-side by the caller's
// selected project like the rest of Critical Alerts' feeds. A returned
// (returned_at set) alert stays in this list until a staff member
// explicitly resolves it — re-entry clears the "currently outside" state,
// it doesn't dismiss the alert itself, so admin still gets to see/ack that
// the exit happened.
export async function fetchUnresolvedGeofenceAlerts(): Promise<GeofenceAlert[]> {
  const { data, error } = await supabase
    .from('geofence_alerts')
    .select(SELECT)
    .eq('resolved', false)
    .order('confirmed_at', { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawGeofenceAlertRow[]).map(toGeofenceAlert);
}

export async function resolveGeofenceAlert(alertId: string, resolvedByUserId: string): Promise<void> {
  const { error } = await supabase
    .from('geofence_alerts')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by_id: resolvedByUserId,
    })
    .eq('id', alertId);

  if (error) throw new Error(error.message);
}
