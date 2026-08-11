import { supabase } from '../supabase';
import { devWarn } from '../devLog';
import { logAction } from '../sentryLog';

// Admin-defined "do not go here" circles for a project — any number per
// project, unlike the single site boundary in lib/projectSettings.ts.
// Historically read-only from the mobile side (creation only existed in
// admin-web's components/projects/RestrictedZonesCard.tsx); the admin/
// manager CRUD functions further down (fetchRestrictedZonesForAdmin
// onward) add a mobile-native equivalent — same restricted_zones table,
// same admin-web-authored RLS write policies
// (add-restricted-zones-mobile-write-rls.sql), not a parallel system.
export interface RestrictedZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  severity: 'warning' | 'critical';
}

interface RawRestrictedZoneRow {
  id: string;
  name: string;
  latitude: number | string;
  longitude: number | string;
  radius_meters: number;
  severity: 'warning' | 'critical';
}

// Radii this small are more prone to GPS noise on a construction site
// (steel structures, concrete, site trailers all degrade accuracy) than
// the debounce window alone reliably absorbs — this doesn't reject or
// adjust anything (radius is admin-set, not this app's call), just
// surfaces a diagnostic warning so a noisy zone shows up in logs instead
// of only as a confusing string of flickering alerts.
const SMALL_RADIUS_WARNING_METERS = 20;

export async function fetchRestrictedZones(projectId: string): Promise<RestrictedZone[]> {
  const { data, error } = await supabase
    .from('restricted_zones')
    .select('id, name, latitude, longitude, radius_meters, severity')
    .eq('project_id', projectId)
    // A deactivated (soft-deleted) zone must stop being registered for
    // geofencing immediately — admin-web's own RestrictedZonesCard shows
    // it as "Inactive" but keeps the row (and its alert history) around,
    // so this filter, not row deletion, is what actually turns it off.
    .eq('active', true);

  if (error) throw new Error(error.message);
  return (data as RawRestrictedZoneRow[]).map((row) => {
    if (row.radius_meters < SMALL_RADIUS_WARNING_METERS) {
      devWarn(`[locationTracking] zone "${row.name}" has a ${row.radius_meters}m radius — under ${SMALL_RADIUS_WARNING_METERS}m is prone to GPS noise on site.`);
    }
    return {
      id: row.id,
      name: row.name,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      radiusMeters: row.radius_meters,
      severity: row.severity,
    };
  });
}

// Written the instant a zone entry is CONFIRMED (see geofence.ts's own
// confirmPendingZoneEntriesIfDue) — the mirror image of
// insertConfirmedGeofenceAlert in geofenceAlerts.ts, which confirms an
// EXIT instead of an ENTER. latitude/longitude/accuracyMeters are
// best-effort (a fresh reading can fail — see geofence.ts's own capture
// site) and never block writing the confirmed event itself if missing.
export async function insertConfirmedRestrictedZoneAlert(params: {
  restrictedZoneId: string;
  projectId: string;
  userId: string;
  enteredAt: Date;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  deviceManufacturer?: string;
  deviceModel?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from('restricted_zone_alerts')
    .insert({
      restricted_zone_id: params.restrictedZoneId,
      project_id: params.projectId,
      user_id: params.userId,
      entered_at: params.enteredAt.toISOString(),
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      accuracy_meters: params.accuracyMeters ?? null,
      device_manufacturer: params.deviceManufacturer ?? null,
      device_model: params.deviceModel ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  const alertId = (data as { id: string }).id;
  // "Created," not "sent" — dedup (Point 8) happens entirely inside a
  // Postgres trigger AFTER this insert commits, deciding whether to
  // actually notify recipients or suppress this as a duplicate of an
  // already-open stay. That decision is invisible to the client at insert
  // time (the trigger doesn't return it in the same round-trip), so this
  // breadcrumb can only honestly claim the row was created — it can't
  // claim whether an alert was sent or suppressed. See supabase/zone-
  // alert-dedup-and-reminder.sql for where that actually gets decided.
  logAction('alert', 'Restricted zone alert created (dedup decided server-side)', {
    alertId,
    restrictedZoneId: params.restrictedZoneId,
    projectId: params.projectId,
  });
  return alertId;
}

export async function markRestrictedZoneAlertExited(alertId: string): Promise<void> {
  const { error } = await supabase
    .from('restricted_zone_alerts')
    .update({ exited_at: new Date().toISOString() })
    .eq('id', alertId);
  if (error) throw new Error(error.message);
}

// ─── Admin/manager CRUD — the mobile Settings screen's "Red Zone" section ───
// Same restricted_zones table fetchRestrictedZones (above) reads for
// geofencing, gated instead by add-restricted-zones-mobile-write-rls.sql's
// admin/manager-only INSERT/UPDATE RLS policies rather than the plain
// staff-readable SELECT policy those functions rely on.

export interface AdminRestrictedZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  severity: 'warning' | 'critical';
  active: boolean;
}

interface RawAdminRestrictedZoneRow {
  id: string;
  name: string;
  latitude: number | string;
  longitude: number | string;
  radius_meters: number;
  severity: 'warning' | 'critical';
  active: boolean;
}

// Unlike fetchRestrictedZones (geofencing) above, this deliberately does
// NOT filter to active-only — the management list needs to show a
// deactivated zone too (so admin can see it and reactivate it), not just
// hide it as if it never existed.
export async function fetchRestrictedZonesForAdmin(projectId: string): Promise<AdminRestrictedZone[]> {
  const { data, error } = await supabase
    .from('restricted_zones')
    .select('id, name, latitude, longitude, radius_meters, severity, active')
    .eq('project_id', projectId)
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return (data as RawAdminRestrictedZoneRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusMeters: row.radius_meters,
    severity: row.severity,
    active: row.active,
  }));
}

export interface RestrictedZoneInput {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  severity: 'warning' | 'critical';
}

export async function createRestrictedZone(projectId: string, userId: string, input: RestrictedZoneInput): Promise<void> {
  const { error } = await supabase.from('restricted_zones').insert({
    project_id: projectId,
    name: input.name,
    latitude: input.latitude,
    longitude: input.longitude,
    radius_meters: input.radiusMeters,
    severity: input.severity,
    created_by_id: userId,
  });
  if (error) throw new Error(error.message);
}

export async function updateRestrictedZone(zoneId: string, input: RestrictedZoneInput): Promise<void> {
  const { error } = await supabase
    .from('restricted_zones')
    .update({
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      radius_meters: input.radiusMeters,
      severity: input.severity,
    })
    .eq('id', zoneId);
  if (error) throw new Error(error.message);
}

// Soft-delete/reactivate — never a real row delete, matching admin-web's
// own RestrictedZonesCard convention (see RestrictedZone.active's own
// schema comment: keeps RestrictedZoneAlert history intact and resolvable
// rather than cascade-orphaning it).
export async function setRestrictedZoneActive(zoneId: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('restricted_zones').update({ active }).eq('id', zoneId);
  if (error) throw new Error(error.message);
}
