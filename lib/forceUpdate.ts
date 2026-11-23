import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { supabase } from './supabase';

// Force update (2026-11-16): an admin sets the lowest allowed build number per
// platform in the `app_versions` table; a phone running an older build is
// blocked with an "Update now" screen that opens the store. No native module
// needed — it compares this build's number (Android versionCode / iOS build)
// with the table. If the table or row is missing, nobody is ever blocked.

export const STORE_URL: Record<string, string> = {
  android: 'https://play.google.com/store/apps/details?id=com.pmcportal.mobile',
  ios: 'https://apps.apple.com/app/id6812192263',
};

export interface UpdateRequirement {
  required: boolean;
  currentBuild: number | null;
  minBuild: number;
  storeUrl: string;
  message: string | null;
}

export function currentBuildNumber(): number | null {
  const n = Number(Application.nativeBuildVersion);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─── Admin control (2026-11-21, client) ─────────────────────────────────
// Settings → "App update": raise the required Android build after a new
// build is live on Google Play; phones on an older build then see the
// "Update required" screen and can't enter the app until they update.

export interface AppVersionSetting {
  minBuild: number;
  message: string | null;
  updatedAt: string | null;
}

/** The required Android build, and the newest build any phone has opened the app with. */
export async function fetchAndroidUpdateSetting(): Promise<{ setting: AppVersionSetting; newestSeen: number | null }> {
  const [{ data, error }, seen] = await Promise.all([
    supabase.from('app_versions').select('min_build, message, updated_at').eq('platform', 'android').maybeSingle(),
    supabase.from('user_devices').select('build_number').eq('platform', 'android').order('last_seen_at', { ascending: false }).limit(200),
  ]);
  if (error) throw new Error(error.message);
  const builds = (seen.data ?? []).map((r: { build_number: string | null }) => Number(r.build_number)).filter((n) => Number.isFinite(n) && n > 0);
  return {
    setting: { minBuild: Number(data?.min_build) || 0, message: data?.message ?? null, updatedAt: data?.updated_at ?? null },
    newestSeen: builds.length ? Math.max(...builds) : null,
  };
}

/** Admin only (RLS). 0 = nobody is blocked. */
export async function setAndroidMinBuild(minBuild: number, message: string | null): Promise<void> {
  const { data, error } = await supabase
    .from('app_versions')
    .update({ min_build: Math.max(0, Math.floor(minBuild)), message: message?.trim() || null, updated_at: new Date().toISOString() })
    .eq('platform', 'android')
    .select('platform');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('Only admins can change this.');
}

export async function checkForceUpdate(): Promise<UpdateRequirement | null> {
  if (Platform.OS === 'web') return null;
  const current = currentBuildNumber();
  if (current === null) return null;
  const { data, error } = await supabase
    .from('app_versions')
    .select('min_build, store_url, message')
    .eq('platform', Platform.OS)
    .maybeSingle();
  if (error || !data) return null; // table not there yet / no row → never block
  const minBuild = Number(data.min_build) || 0;
  return {
    required: current < minBuild,
    currentBuild: current,
    minBuild,
    storeUrl: data.store_url || STORE_URL[Platform.OS] || STORE_URL.android,
    message: data.message ?? null,
  };
}
