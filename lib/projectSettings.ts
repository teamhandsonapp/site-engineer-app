import { supabase } from './supabase';

export interface ProjectSettings {
  id: string;
  name: string;
  address: string | null;
  floorCount: number | null;
  roomCount: number | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
  siteRadiusMeters: number | null;
  // Build prompt point 1 — fixed shift-tracking window, minutes since
  // midnight. Never null (schema default 540/1140 = 9:00-19:00) — every
  // project has a real value even before any admin edit UI for this exists.
  shiftStartMinutes: number;
  shiftEndMinutes: number;
}

interface RawProjectSettingsRow {
  id: string;
  name: string;
  address: string | null;
  floor_count: number | null;
  room_count: number | null;
  site_latitude: number | string | null;
  site_longitude: number | string | null;
  site_radius_meters: number | null;
  shift_start_minutes: number;
  shift_end_minutes: number;
}

function toProjectSettings(row: RawProjectSettingsRow): ProjectSettings {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    floorCount: row.floor_count,
    roomCount: row.room_count,
    siteLatitude: row.site_latitude != null ? Number(row.site_latitude) : null,
    siteLongitude: row.site_longitude != null ? Number(row.site_longitude) : null,
    siteRadiusMeters: row.site_radius_meters,
    shiftStartMinutes: row.shift_start_minutes,
    shiftEndMinutes: row.shift_end_minutes,
  };
}

// Admin/manager only in practice (see components/DrawerContent.tsx's
// ADMIN_MANAGER_ONLY_ROUTES gate on the Settings screen that calls this) —
// RLS itself only restricts the WRITE side (see
// admin-web/prisma/add-projects-mobile-settings-rls.sql); this read uses
// the same staff-wide SELECT every other project read already has.
export async function fetchProjectSettings(projectId: string): Promise<ProjectSettings> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, address, floor_count, room_count, site_latitude, site_longitude, site_radius_meters, shift_start_minutes, shift_end_minutes')
    .eq('id', projectId)
    .single();

  if (error) throw new Error(error.message);
  return toProjectSettings(data as RawProjectSettingsRow);
}

// Same fields admin-web's ProjectInfoEditor + SiteLocationCard write today
// (see admin-web/app/actions/projects.ts's updateProjectLocation and the
// project info action next to it) — this is the same underlying columns,
// not a mobile-only copy. Column-scoped GRANT on the DB side means only
// these five fields are actually writable via this path regardless of what
// this function is called with.
export async function updateProjectSettings(
  projectId: string,
  updates: {
    name: string;
    address: string | null;
    floorCount: number | null;
    roomCount: number | null;
    siteLatitude: number | null;
    siteLongitude: number | null;
    siteRadiusMeters: number | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({
      name: updates.name,
      address: updates.address,
      floor_count: updates.floorCount,
      room_count: updates.roomCount,
      site_latitude: updates.siteLatitude,
      site_longitude: updates.siteLongitude,
      site_radius_meters: updates.siteRadiusMeters,
    })
    .eq('id', projectId);

  if (error) throw new Error(error.message);
}
