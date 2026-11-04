import * as Device from 'expo-device';
import { devWarn } from './devLog';
import { supabase } from './supabase';

// A plain informational log, not an alert — one row per successful sign-in
// by a site_engineer/senior_site_engineer account (see AuthContext.tsx's
// signIn()), for admin visibility. Fire-and-forget by design: this must
// never delay or fail a real sign-in, so every read here is best-effort —
// a denied location permission or a device-info read failure just means
// some fields come back null, not a thrown error.
export async function insertFieldLoginEvent(userId: string): Promise<void> {
  // Location removed from the app — login events no longer record coordinates.
  const latitude = null;
  const longitude = null;

  const { error } = await supabase.from('field_login_events').insert({
    user_id: userId,
    latitude,
    longitude,
    device_model: Device.modelName,
    device_os: Device.osName ? `${Device.osName} ${Device.osVersion ?? ''}`.trim() : null,
  });
  if (error) devWarn('[fieldLoginEvents] failed to record login event:', error.message);
}

export interface FieldLoginEvent {
  id: string;
  userName: string | null;
  loggedInAtISO: string;
  latitude: number | null;
  longitude: number | null;
  deviceModel: string | null;
  deviceOs: string | null;
}

interface RawFieldLoginEventRow {
  id: string;
  logged_in_at: string;
  latitude: number | string | null;
  longitude: number | string | null;
  device_model: string | null;
  device_os: string | null;
  user: { full_name: string } | { full_name: string }[] | null;
}

function oneOrNull<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

const SELECT = 'id, logged_in_at, latitude, longitude, device_model, device_os, user:user_profiles!field_login_events_user_id_fkey(full_name)';

// Staff-only (RLS-enforced), most recent first, capped since this is a
// glance-at-recent-activity log, not a full audit trail viewer.
export async function fetchRecentFieldLoginEvents(limit = 30): Promise<FieldLoginEvent[]> {
  const { data, error } = await supabase
    .from('field_login_events')
    .select(SELECT)
    .order('logged_in_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawFieldLoginEventRow[]).map((r) => ({
    id: r.id,
    userName: oneOrNull(r.user)?.full_name ?? null,
    loggedInAtISO: r.logged_in_at,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    deviceModel: r.device_model,
    deviceOs: r.device_os,
  }));
}
