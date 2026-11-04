import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import Constants, { AppOwnership } from 'expo-constants';
import { supabase } from './supabase';
import { getOrCreateDeviceId } from './deviceId';
import { devWarn } from './devLog';

// Feeds Settings → Devices & Logins (app/(authenticated)/devices.tsx) via the
// user_devices table (admin-web/prisma/add-user-devices.sql). Always
// fire-and-forget: a failure here must never affect signing in or using the
// app, so every error is swallowed after a dev warning.

// While the app stays open, refresh "last used" at most this often.
const HEARTBEAT_MS = 5 * 60 * 1000;
let lastBeatAt = 0;

async function notificationsEnabled(): Promise<boolean> {
  if (Platform.OS === 'web' || Constants.appOwnership === AppOwnership.Expo) return false;
  try {
    // Lazy require — see pushNotifications.ts for why a static import breaks Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

// isLogin: a fresh sign-in (stamps last_login_at) vs. a relaunch/heartbeat.
export async function recordDeviceActivity(userId: string, isLogin = false): Promise<void> {
  try {
    const now = new Date().toISOString();
    const row = {
      user_id: userId,
      device_id: await getOrCreateDeviceId(),
      platform: Platform.OS,
      os_version: Device.osVersion ?? null,
      manufacturer: Device.manufacturer ?? null,
      model: Device.modelName ?? null,
      device_name: Device.deviceName ?? null,
      app_version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
      build_number: Application.nativeBuildVersion ?? null,
      push_enabled: await notificationsEnabled(),
      last_seen_at: now,
      ...(isLogin ? { last_login_at: now } : {}),
    };
    const { error } = await supabase.from('user_devices').upsert(row, { onConflict: 'user_id,device_id' });
    if (error) devWarn('[devices] upsert failed:', error.message);
    else lastBeatAt = Date.now();
  } catch (err) {
    devWarn('[devices] record failed:', err instanceof Error ? err.message : String(err));
  }
}

// Mounted in the authenticated layout: refreshes last_seen_at when the app
// comes back to the foreground and every HEARTBEAT_MS while it stays open.
export function useDeviceHeartbeat(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    const beat = () => {
      if (Date.now() - lastBeatAt >= HEARTBEAT_MS) recordDeviceActivity(userId);
    };
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') beat();
    }, HEARTBEAT_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') beat();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [userId]);
}
