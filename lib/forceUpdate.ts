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
