import { supabase } from './supabase';
import { leaveReasonLabelFor, type LeaveReasonPresetValue } from './leaveEvents';

export interface RestrictedZoneAlert {
  id: string;
  projectId: string;
  userId: string;
  zoneName: string | null;
  userName: string | null;
  enteredAtISO: string;
  exitedAtISO: string | null;
  resolved: boolean;
  resolvedAtISO: string | null;
  resolvedByName: string | null;
  // Bug 3.6 — never suppresses the alert itself (there is no code path
  // anywhere that skips inserting/showing a restricted_zone_alerts row
  // because a Leave exists), this only ADDS context: if the engineer had
  // logged a Leave shortly before entering, admin sees why they were
  // there instead of just that they were. Null when no Leave correlates.
  statedLeaveReason: string | null;
}

// Same to-one-embed-may-arrive-as-an-array caveat as geofenceAlerts.ts's
// RawGeofenceAlertRow — no generated Supabase types in this repo.
interface RawRestrictedZoneAlertRow {
  id: string;
  project_id: string;
  user_id: string;
  entered_at: string;
  exited_at: string | null;
  resolved: boolean;
  resolved_at: string | null;
  restricted_zone: { name: string } | { name: string }[] | null;
  user: { full_name: string } | { full_name: string }[] | null;
  resolved_by: { full_name: string } | { full_name: string }[] | null;
}

function oneOrNull<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function toRestrictedZoneAlert(row: RawRestrictedZoneAlertRow): RestrictedZoneAlert {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    zoneName: oneOrNull(row.restricted_zone)?.name ?? null,
    userName: oneOrNull(row.user)?.full_name ?? null,
    enteredAtISO: row.entered_at,
    exitedAtISO: row.exited_at,
    resolved: row.resolved,
    resolvedAtISO: row.resolved_at,
    resolvedByName: oneOrNull(row.resolved_by)?.full_name ?? null,
    statedLeaveReason: null, // filled in by attachStatedLeaveReasons below
  };
}

const SELECT = `
  id, project_id, user_id, entered_at, exited_at, resolved, resolved_at,
  restricted_zone:restricted_zones(name),
  user:user_profiles!restricted_zone_alerts_user_id_fkey(full_name),
  resolved_by:user_profiles!restricted_zone_alerts_resolved_by_id_fkey(full_name)
`;

// Bug 3.6 — same 3-hour "how long is a Leave still plausibly the reason
// someone's out" assumption as lib/dayTimeline.ts's own
// LEAVE_ASSUMED_MAX_DURATION_MS (kept as a separate constant, not imported,
// since dayTimeline.ts's version is scoped to its own active-Leave-window
// logic with a different signature — this only needs "was there a Leave
// shortly before this entry," not a full window).
const LEAVE_STATED_REASON_WINDOW_MS = 3 * 60 * 60 * 1000;

// Attaches the most recent Leave (if any, within the window above) each
// alert's user logged before entering the zone — one batched query for
// every user in the list, not one query per alert. Never removes or skips
// an alert regardless of what it finds; a red-zone entry is always shown,
// this only adds "why they say they were there" on top of it.
async function attachStatedLeaveReasons(alerts: RestrictedZoneAlert[]): Promise<RestrictedZoneAlert[]> {
  const userIds = [...new Set(alerts.map((a) => a.userId))];
  if (userIds.length === 0) return alerts;

  const { data, error } = await supabase
    .from('leave_events')
    .select('user_id, left_at, reason_preset, reason_note')
    .in('user_id', userIds)
    .order('left_at', { ascending: true });
  if (error) return alerts; // best-effort context — a failed lookup shouldn't hide the alerts themselves

  const leavesByUser = new Map<string, { leftAtMs: number; reasonPreset: LeaveReasonPresetValue; reasonNote: string | null }[]>();
  for (const row of data ?? []) {
    const list = leavesByUser.get(row.user_id) ?? [];
    list.push({ leftAtMs: new Date(row.left_at).getTime(), reasonPreset: row.reason_preset, reasonNote: row.reason_note });
    leavesByUser.set(row.user_id, list);
  }

  return alerts.map((alert) => {
    const enteredAtMs = new Date(alert.enteredAtISO).getTime();
    const candidates = (leavesByUser.get(alert.userId) ?? []).filter(
      (l) => l.leftAtMs <= enteredAtMs && enteredAtMs - l.leftAtMs <= LEAVE_STATED_REASON_WINDOW_MS
    );
    const mostRecent = candidates[candidates.length - 1]; // list is left_at-ascending, so last = latest
    return mostRecent
      ? { ...alert, statedLeaveReason: leaveReasonLabelFor(mostRecent.reasonPreset, mostRecent.reasonNote) }
      : alert;
  });
}

// Mirrors fetchUnresolvedGeofenceAlerts exactly — staff-only (RLS already
// restricts this regardless), filtered client-side by the caller's
// selected project like the rest of Critical Alerts' feeds. Exiting the
// zone doesn't dismiss the alert by itself — a staff member still has to
// explicitly resolve it, same reasoning as a returned geofence exit.
export async function fetchUnresolvedRestrictedZoneAlerts(): Promise<RestrictedZoneAlert[]> {
  const { data, error } = await supabase
    .from('restricted_zone_alerts')
    .select(SELECT)
    .eq('resolved', false)
    .order('entered_at', { ascending: false });

  if (error) throw new Error(error.message);
  const alerts = ((data ?? []) as unknown as RawRestrictedZoneAlertRow[]).map(toRestrictedZoneAlert);
  return attachStatedLeaveReasons(alerts);
}

export async function resolveRestrictedZoneAlert(alertId: string, resolvedByUserId: string): Promise<void> {
  const { error } = await supabase
    .from('restricted_zone_alerts')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by_id: resolvedByUserId,
    })
    .eq('id', alertId);

  if (error) throw new Error(error.message);
}
