import { supabase } from './supabase';
import { computeTrackingGaps, type SilenceEpisode, type TrackingGap } from './trackingGaps';
import { fetchTodaysAttendance, istStartOfToday } from './attendance';
import { fetchLeaveEventsForDay, LEAVE_EXIT_CORRELATION_WINDOW_MS, leaveReasonLabelFor } from './leaveEvents';
import { fetchProjectSettings } from './projectSettings';
import { fetchRestrictedZones, type RestrictedZone } from './locationTracking/restrictedZones';

// Sections 1-2's single data source, consumed by both the map trail view and
// the checklist/list view (the spec is explicit these must NOT be two
// separate data pulls) — this module fetches and merges attendance,
// leave_events, geofence_alerts, and restricted_zone_alerts into one
// chronological event list plus a separate ping trail, for the CURRENT
// signed-in user's TODAY only (same no-date-param convention as
// lib/attendance.ts's fetchTodaysAttendance — there's no historical day
// picker in the spec, just "today").

export type TimelineEventKind = 'check_in' | 'check_out' | 'leave' | 'boundary_exit' | 'red_zone_entry';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  atISO: string;
  latitude: number | null;
  longitude: number | null;
  title: string;
  detail: string | null;
  // Item 6 — 1-based chronological position for the day, assigned after
  // the final sort below. The SAME number is shown on this event's map
  // marker and its timeline list row, so admin can visually trace
  // "1 -> 2 -> 3" across both without cross-referencing an unlabeled pin
  // against the list by eye.
  sequence: number;
}

export interface TrailPoint {
  latitude: number;
  longitude: number;
  occurredAtISO: string;
}

// A window during which the engineer was away from site on a logged Leave —
// used to draw a visually distinct ("small icon/segment") stretch of the
// route rather than the plain neutral line, and to attribute a Leave's
// reason to anything else (e.g. a red-zone entry) that happens during it.
export interface LeavePeriod {
  leaveId: string;
  startMs: number;
  endMs: number;
  // true when endMs came from an actual detected return (a correlated
  // geofence_alerts.returned_at); false when it's just the assumed-max-
  // duration fallback below because no return was ever detected — e.g. the
  // engineer is still out right now.
  resolved: boolean;
  reasonLabel: string;
}

// Section 5 (radius circles) — the STATIC boundaries the map draws
// alongside the day's actual events, not events themselves: where the site
// and any red zones ARE, regardless of whether anything happened at them
// today. Reuses lib/projectSettings.ts and lib/locationTracking/
// restrictedZones.ts's existing fetchers/types directly rather than a
// parallel read of the same tables.
export interface DaySiteLocation {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface DayTimeline {
  trail: TrailPoint[];
  // Holes in the trail (lib/trackingGaps.ts) — drawn as dashed red
  // segments on the map and listed under it.
  gaps: TrackingGap[];
  events: TimelineEvent[];
  leavePeriods: LeavePeriod[];
  siteLocation: DaySiteLocation | null;
  restrictedZones: RestrictedZone[];
}

export const TIMELINE_EVENT_COLORS: Record<TimelineEventKind, string> = {
  check_in: '#0F1F33',
  check_out: '#0F1F33',
  leave: '#7C3AED',
  boundary_exit: '#F59E0B',
  red_zone_entry: '#DC2626',
};

// Plain strings, not typed against Ionicons.glyphMap — this module has no
// business depending on @expo/vector-icons; the UI casts these at the call
// site instead.
export const TIMELINE_EVENT_ICONS: Record<TimelineEventKind, string> = {
  check_in: 'log-in-outline',
  check_out: 'log-out-outline',
  leave: 'walk-outline',
  boundary_exit: 'alert-circle-outline',
  red_zone_entry: 'skull-outline',
};

// LEAVE_EXIT_CORRELATION_WINDOW_MS now lives in leaveEvents.ts (imported
// above) — shared with that file's own markCorrelatedLeaveReturned, one
// constant instead of two copies that could drift.

// Audit fix — leave_events.returnedAt is now a real column, written
// directly the moment a boundary re-entry is confirmed (see
// leaveEvents.ts's own comment); this constant only still matters as the
// FALLBACK correlation below, for historical Leave rows created before
// that column existed (returnedAtISO permanently null on those). When
// neither the direct field nor the fallback correlation resolves a Leave,
// this caps how long it's treated as "active" for the dashed-segment/
// reason-attribution logic below, so a forgotten or never-resolved Leave
// doesn't stay "active" for the rest of the day.
const LEAVE_ASSUMED_MAX_DURATION_MS = 3 * 60 * 60 * 1000;

interface RawGeofenceExit {
  id: string;
  exitAtISO: string;
  returnedAtISO: string | null;
  latitude: number | null;
  longitude: number | null;
}

async function fetchGeofenceExitsForDay(userId: string, dayStartISO: string, dayEndISO: string): Promise<RawGeofenceExit[]> {
  const { data, error } = await supabase
    .from('geofence_alerts')
    .select('id, exit_at, returned_at, latitude, longitude')
    .eq('user_id', userId)
    .gte('exit_at', dayStartISO)
    .lt('exit_at', dayEndISO)
    .order('exit_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    exitAtISO: r.exit_at,
    returnedAtISO: r.returned_at,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

// Same to-one-embed-may-arrive-as-an-array caveat as restrictedZoneAlerts.ts's
// RawRestrictedZoneAlertRow — no generated Supabase types in this repo.
interface RawRedZoneEntryRow {
  id: string;
  entered_at: string;
  latitude: number | null;
  longitude: number | null;
  restricted_zone: { name: string } | { name: string }[] | null;
}

function oneOrNull<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

interface RawRedZoneEntry {
  id: string;
  enteredAtISO: string;
  latitude: number | null;
  longitude: number | null;
  zoneName: string;
}

async function fetchRedZoneEntriesForDay(userId: string, dayStartISO: string, dayEndISO: string): Promise<RawRedZoneEntry[]> {
  const { data, error } = await supabase
    .from('restricted_zone_alerts')
    .select('id, entered_at, latitude, longitude, restricted_zone:restricted_zones(name)')
    .eq('user_id', userId)
    .gte('entered_at', dayStartISO)
    .lt('entered_at', dayEndISO)
    .order('entered_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawRedZoneEntryRow[]).map((r) => ({
    id: r.id,
    enteredAtISO: r.entered_at,
    latitude: r.latitude,
    longitude: r.longitude,
    zoneName: oneOrNull(r.restricted_zone)?.name ?? 'Restricted zone',
  }));
}

async function fetchTrailForDay(userId: string, dayStartISO: string, dayEndISO: string): Promise<TrailPoint[]> {
  const { data, error } = await supabase
    .from('location_pings')
    .select('latitude, longitude, occurred_at')
    .eq('user_id', userId)
    .gte('occurred_at', dayStartISO)
    .lt('occurred_at', dayEndISO)
    .order('occurred_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    occurredAtISO: r.occurred_at,
  }));
}

// Server-side silence episodes (admin-web's tracking-silence-watcher job,
// every 5 min) overlapping this day — the authoritative gap start/end
// times. Readable by any staff role (location_disabled_alerts RLS).
async function fetchSilenceEpisodesForDay(userId: string, dayStartISO: string, dayEndISO: string): Promise<SilenceEpisode[]> {
  const { data, error } = await supabase
    .from('location_disabled_alerts')
    .select('id, disabled_at, enabled_at')
    .eq('user_id', userId)
    .eq('reason', 'no_heartbeat')
    .lt('disabled_at', dayEndISO)
    .or(`enabled_at.is.null,enabled_at.gt.${dayStartISO}`)
    .order('disabled_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id as string, startISO: r.disabled_at as string, endISO: (r.enabled_at as string | null) ?? null }));
}

async function fetchSiteLocation(projectId: string): Promise<DaySiteLocation | null> {
  try {
    const settings = await fetchProjectSettings(projectId);
    if (settings.siteLatitude == null || settings.siteLongitude == null || settings.siteRadiusMeters == null) return null;
    return { latitude: settings.siteLatitude, longitude: settings.siteLongitude, radiusMeters: settings.siteRadiusMeters };
  } catch {
    return null;
  }
}

// projectId is optional and purely for the STATIC site/zone circles —
// whichever project the caller currently has selected (both day-timeline.tsx
// and team-attendance-detail/[userId].tsx already have this via
// useProject()). Omitted or not found simply means no circles draw; every
// EVENT-based part of the timeline is entirely independent of this and
// unaffected either way.
export async function fetchDayTimeline(userId: string, projectId?: string | null): Promise<DayTimeline> {
  const dayStart = istStartOfToday();
  const dayStartISO = dayStart.toISOString();
  const dayEndISO = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const [attendance, leaves, exits, redZoneEntries, trail, siteLocation, restrictedZones, silenceEpisodes] = await Promise.all([
    fetchTodaysAttendance(userId),
    fetchLeaveEventsForDay(userId, dayStartISO, dayEndISO),
    fetchGeofenceExitsForDay(userId, dayStartISO, dayEndISO),
    fetchRedZoneEntriesForDay(userId, dayStartISO, dayEndISO),
    fetchTrailForDay(userId, dayStartISO, dayEndISO),
    projectId ? fetchSiteLocation(projectId) : Promise.resolve(null),
    projectId ? fetchRestrictedZones(projectId).catch(() => []) : Promise.resolve([]),
    // Gaps are additive — a failed read just means no gap overlay, never a broken timeline.
    fetchSilenceEpisodesForDay(userId, dayStartISO, dayEndISO).catch(() => [] as SilenceEpisode[]),
  ]);
  const gaps = computeTrackingGaps(trail, silenceEpisodes, Date.now(), { startMs: dayStart.getTime(), endMs: new Date(dayEndISO).getTime() });

  // Each Leave's "active" window: end = the Leave's OWN returnedAt (audit
  // fix — written directly the moment a boundary re-entry is confirmed,
  // see leaveEvents.ts's own comment) when present; otherwise the FALLBACK
  // read-time correlation against whichever geofence exit lines up with
  // it, for historical Leave rows created before that direct write
  // existed; otherwise the assumed-max-duration fallback (still out, or
  // the OS never independently detected it either).
  const leavePeriods: LeavePeriod[] = leaves.map((leave) => {
    const startMs = new Date(leave.leftAtISO).getTime();
    let resolved = leave.returnedAtISO != null;
    let endMs = resolved ? new Date(leave.returnedAtISO!).getTime() : startMs + LEAVE_ASSUMED_MAX_DURATION_MS;
    if (!resolved) {
      const correlated = exits.find(
        (exit) => Math.abs(new Date(exit.exitAtISO).getTime() - startMs) <= LEAVE_EXIT_CORRELATION_WINDOW_MS
      );
      if (correlated?.returnedAtISO != null) {
        resolved = true;
        endMs = new Date(correlated.returnedAtISO).getTime();
      }
    }
    return {
      leaveId: leave.id,
      startMs,
      endMs,
      resolved,
      reasonLabel: leaveReasonLabelFor(leave.reasonPreset, leave.reasonNote),
    };
  });

  function activeLeaveAt(atISO: string): LeavePeriod | null {
    const atMs = new Date(atISO).getTime();
    return leavePeriods.find((p) => atMs >= p.startMs && atMs <= p.endMs) ?? null;
  }

  // leave_events has no latitude/longitude of its own (it's a reason
  // announcement, not a location capture — see add-leave-events.sql), and
  // geofence_alerts/restricted_zone_alerts' own lat/lng are nullable
  // diagnostic fields, not guaranteed. This is the fallback for all three:
  // the closest-in-time background ping stands in as "roughly where they
  // were," good enough to place a marker and jump the map to.
  function nearestTrailPoint(atISO: string): TrailPoint | null {
    if (trail.length === 0) return null;
    const atMs = new Date(atISO).getTime();
    return trail.reduce((closest, point) =>
      Math.abs(new Date(point.occurredAtISO).getTime() - atMs) < Math.abs(new Date(closest.occurredAtISO).getTime() - atMs)
        ? point
        : closest
    );
  }

  // Built without `sequence` (assigned in one pass below, after sorting —
  // simpler than threading a running counter through 5 separate push call
  // sites that don't know their own final chronological position yet).
  const events: Omit<TimelineEvent, 'sequence'>[] = [];

  for (const record of attendance) {
    if (record.type === 'CHECK_IN') {
      events.push({
        id: record.id,
        kind: 'check_in',
        atISO: record.clientCapturedAtISO,
        latitude: record.latitude ?? nearestTrailPoint(record.clientCapturedAtISO)?.latitude ?? null,
        longitude: record.longitude ?? nearestTrailPoint(record.clientCapturedAtISO)?.longitude ?? null,
        title: 'Checked in',
        detail: null,
      });
    } else {
      // Pair with the most recent CHECK_IN strictly before this checkout to
      // find the shift window that was active — same "last CHECK_IN before
      // this CHECK_OUT" pairing the toggle button on attendance.tsx uses.
      const priorCheckIn = [...attendance]
        .filter((r) => r.type === 'CHECK_IN' && new Date(r.clientCapturedAtISO).getTime() < new Date(record.clientCapturedAtISO).getTime())
        .pop();
      let detail: string | null = null;
      if (priorCheckIn?.scheduledEndMinutes != null) {
        const scheduledEnd = istStartOfToday().getTime() + priorCheckIn.scheduledEndMinutes * 60_000;
        const lateMs = new Date(record.clientCapturedAtISO).getTime() - scheduledEnd;
        if (lateMs > 0) {
          const lateMinutes = Math.round(lateMs / 60_000);
          detail = `${lateMinutes} min delay`;
        }
      }
      events.push({
        id: record.id,
        kind: 'check_out',
        atISO: record.clientCapturedAtISO,
        latitude: record.latitude ?? nearestTrailPoint(record.clientCapturedAtISO)?.latitude ?? null,
        longitude: record.longitude ?? nearestTrailPoint(record.clientCapturedAtISO)?.longitude ?? null,
        title: 'Checked out',
        detail,
      });
    }
  }

  for (const leave of leaves) {
    const nearest = nearestTrailPoint(leave.leftAtISO);
    events.push({
      id: leave.id,
      kind: 'leave',
      atISO: leave.leftAtISO,
      latitude: nearest?.latitude ?? null,
      longitude: nearest?.longitude ?? null,
      title: 'Left site',
      detail: `Reason: ${leaveReasonLabelFor(leave.reasonPreset, leave.reasonNote)}`,
    });
  }

  for (const exit of exits) {
    const correlated = leavePeriods.some(
      (p) => Math.abs(new Date(exit.exitAtISO).getTime() - p.startMs) <= LEAVE_EXIT_CORRELATION_WINDOW_MS
    );
    // Explained exits aren't rendered as their own event — the Leave event
    // above already represents that trip; this would otherwise duplicate it.
    if (correlated) continue;
    const nearest = exit.latitude == null ? nearestTrailPoint(exit.exitAtISO) : null;
    events.push({
      id: exit.id,
      kind: 'boundary_exit',
      atISO: exit.exitAtISO,
      latitude: exit.latitude ?? nearest?.latitude ?? null,
      longitude: exit.longitude ?? nearest?.longitude ?? null,
      title: 'Left site boundary',
      detail: 'No Leave reason logged',
    });
  }

  for (const entry of redZoneEntries) {
    const activeLeave = activeLeaveAt(entry.enteredAtISO);
    const nearest = entry.latitude == null ? nearestTrailPoint(entry.enteredAtISO) : null;
    events.push({
      id: entry.id,
      kind: 'red_zone_entry',
      atISO: entry.enteredAtISO,
      latitude: entry.latitude ?? nearest?.latitude ?? null,
      longitude: entry.longitude ?? nearest?.longitude ?? null,
      title: `Entered red zone: ${entry.zoneName}`,
      detail: activeLeave ? `Reason: ${activeLeave.reasonLabel}` : null,
    });
  }

  events.sort((a, b) => new Date(a.atISO).getTime() - new Date(b.atISO).getTime());
  const numberedEvents: TimelineEvent[] = events.map((e, i) => ({ ...e, sequence: i + 1 }));

  return { trail, gaps, events: numberedEvents, leavePeriods, siteLocation, restrictedZones };
}
