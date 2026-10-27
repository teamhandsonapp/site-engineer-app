import { supabase } from './supabase';

// A manual "I'm about to leave the site, here's why" announcement —
// deliberately NOT a checkout action (see attendance.ts's own single-
// check-in-per-day model, unchanged by this). Tracking (pings, geofencing)
// continues completely normally regardless; this only adds a reason
// admin/the timeline views can show alongside whatever the OS's own
// geofencing independently detects.
export const LEAVE_REASON_PRESETS = [
  { value: 'material_pickup', label: 'Material pickup' },
  { value: 'client_visit', label: 'Client visit' },
  { value: 'site_inspection', label: 'Site inspection' },
  { value: 'supply_run', label: 'Supply run' },
  { value: 'other', label: 'Other' },
] as const;

export type LeaveReasonPresetValue = (typeof LEAVE_REASON_PRESETS)[number]['value'];

export interface LeaveEvent {
  id: string;
  leftAtISO: string;
  reasonPreset: LeaveReasonPresetValue;
  reasonNote: string | null;
  // Audit fix — a real, direct column now (fix-leave-events-returned-at.sql),
  // written by markCorrelatedLeaveReturned below the moment a boundary
  // re-entry is confirmed. Null for a still-active Leave, OR for a
  // historical row created before this column existed — dayTimeline.ts's
  // own read-time geofence-alert correlation is the fallback for that
  // second case specifically, not for every null.
  returnedAtISO: string | null;
}

// An OS-detected boundary exit within this many minutes of a logged Leave's
// left_at counts as "the same trip" — 15 minutes covers the geofence
// debounce (3 min) plus background ping/exit-detection latency, without
// being so wide it'd falsely match an unrelated later exit. Shared with
// dayTimeline.ts's own fallback correlation (kept for historical Leave rows
// with returnedAtISO still null) — one constant, not two copies that could
// drift out of sync with each other.
export const LEAVE_EXIT_CORRELATION_WINDOW_MS = 15 * 60 * 1000;

// Shared by dayTimeline.ts and restrictedZoneAlerts.ts (both need to render
// a Leave's reason as a human label) — one function, not two copies, since
// both live in this same app (unlike the cross-app admin-web/mobile split,
// where duplication is the deliberate, established convention).
export function leaveReasonLabelFor(preset: LeaveReasonPresetValue, note: string | null): string {
  const label = LEAVE_REASON_PRESETS.find((r) => r.value === preset)?.label ?? preset;
  return note ? `${label} (${note})` : label;
}

export async function insertLeaveEvent(params: {
  userId: string;
  projectId: string | null;
  reasonPreset: LeaveReasonPresetValue;
  reasonNote?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('leave_events').insert({
    user_id: params.userId,
    project_id: params.projectId,
    left_at: new Date().toISOString(),
    reason_preset: params.reasonPreset,
    reason_note: params.reasonNote?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function fetchLeaveEventsForDay(userId: string, dayStartISO: string, dayEndISO: string): Promise<LeaveEvent[]> {
  const { data, error } = await supabase
    .from('leave_events')
    .select('id, left_at, reason_preset, reason_note, returned_at')
    .eq('user_id', userId)
    .gte('left_at', dayStartISO)
    .lt('left_at', dayEndISO)
    .order('left_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    leftAtISO: r.left_at,
    reasonPreset: r.reason_preset as LeaveReasonPresetValue,
    reasonNote: r.reason_note,
    returnedAtISO: r.returned_at,
  }));
}

// Called the moment a boundary re-entry is confirmed (see
// lib/locationTracking/geofenceAlerts.ts's markGeofenceAlertReturned) —
// finds whichever open Leave (returned_at IS NULL) this same user left on
// within LEAVE_EXIT_CORRELATION_WINDOW_MS of the exit this re-entry pairs
// with, and writes returnedAt directly onto it. Best-effort by design: no
// matching open Leave is a completely normal, common outcome (most
// boundary exits have no Leave announcement at all), not an error.
export async function markCorrelatedLeaveReturned(userId: string, exitAtISO: string, returnedAtISO: string): Promise<void> {
  const exitAtMs = new Date(exitAtISO).getTime();
  const windowStartISO = new Date(exitAtMs - LEAVE_EXIT_CORRELATION_WINDOW_MS).toISOString();
  const windowEndISO = new Date(exitAtMs + LEAVE_EXIT_CORRELATION_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from('leave_events')
    .select('id, left_at')
    .eq('user_id', userId)
    .is('returned_at', null)
    .gte('left_at', windowStartISO)
    .lte('left_at', windowEndISO)
    .order('left_at', { ascending: false }); // most recent open Leave first
  if (error) throw new Error(error.message);
  const candidate = data?.[0];
  if (!candidate) return; // no open Leave near this exit — nothing to correlate, not an error

  const { error: updateError } = await supabase.from('leave_events').update({ returned_at: returnedAtISO }).eq('id', candidate.id);
  if (updateError) throw new Error(updateError.message);
}

// New admin "Leave Log" tab's own data source — a rollup across EVERY
// engineer/project/day, unlike fetchLeaveEventsForDay above (one user, one
// day, used by the timeline views). Same underlying leave_events table,
// no new write path or duplicated data.
export interface LeaveLogEntry {
  id: string;
  userId: string;
  userName: string | null;
  projectId: string | null;
  projectName: string | null;
  leftAtISO: string;
  reasonPreset: LeaveReasonPresetValue;
  reasonNote: string | null;
}

export interface LeaveLogFilters {
  userId?: string | null;
  projectId?: string | null;
  reasonPreset?: LeaveReasonPresetValue | null;
  fromISO?: string | null; // inclusive
  toISO?: string | null; // exclusive
}

// Same to-one-embed-may-arrive-as-an-array caveat as restrictedZoneAlerts.ts's
// RawRestrictedZoneAlertRow — no generated Supabase types in this repo.
interface RawLeaveLogRow {
  id: string;
  user_id: string;
  project_id: string | null;
  left_at: string;
  reason_preset: string;
  reason_note: string | null;
  user: { full_name: string } | { full_name: string }[] | null;
  project: { name: string } | { name: string }[] | null;
}

function oneOrNull<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

const LEAVE_LOG_SELECT = `
  id, user_id, project_id, left_at, reason_preset, reason_note,
  user:user_profiles!leave_events_user_id_fkey(full_name),
  project:projects(name)
`;

export interface EngineerOption {
  id: string;
  fullName: string;
}

// Every field-role engineer, for the Leave Log's own engineer filter
// picker — deliberately not scoped to "only engineers who've logged a
// Leave," so admin can pick a name to filter by before any results exist
// for them.
export async function fetchEngineersForFilter(): Promise<EngineerOption[]> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, full_name')
    .in('role', ['site_engineer', 'senior_site_engineer'])
    .is('deleted_at', null)
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, fullName: r.full_name }));
}

// No .limit() — an admin rollup like this is exactly the kind of list that
// silently truncating would misreport as "nothing else happened," which
// this codebase has already been burned by once for real. FlatList
// (leave-log.tsx) handles virtualizing however many rows this grows to.
export async function fetchLeaveLog(filters: LeaveLogFilters = {}): Promise<LeaveLogEntry[]> {
  let query = supabase.from('leave_events').select(LEAVE_LOG_SELECT).order('left_at', { ascending: false });

  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.projectId) query = query.eq('project_id', filters.projectId);
  if (filters.reasonPreset) query = query.eq('reason_preset', filters.reasonPreset);
  if (filters.fromISO) query = query.gte('left_at', filters.fromISO);
  if (filters.toISO) query = query.lt('left_at', filters.toISO);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawLeaveLogRow[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    userName: oneOrNull(r.user)?.full_name ?? null,
    projectId: r.project_id,
    projectName: oneOrNull(r.project)?.name ?? null,
    leftAtISO: r.left_at,
    reasonPreset: r.reason_preset as LeaveReasonPresetValue,
    reasonNote: r.reason_note,
  }));
}
