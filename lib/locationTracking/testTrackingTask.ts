import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { devWarn } from '../devLog';
import { supabase } from '../supabase';
import { TEST_TRACKING_SESSION_KEY } from './storageKeys';

// TEMPORARY (added 2026-08-15) — a fully standalone, manually-triggered
// tracking task for the one-off Oppo/Redmi/CMF 2-hour reliability
// comparison. Deliberately independent of LOCATION_PING_TASK/
// useFieldLocationTracking's whole shift-window/signed-in-role gating
// machinery — the point here is "just track for a fixed 2-hour window on
// whatever phone this is running on," not the real production behavior.
// Runs alongside the real task without conflict (a different registered
// task name), though for a clean A/B/C comparison the real production
// task should be left OFF on these 3 test phones during the run (e.g. use
// non-field-role test logins) so nothing else is also writing pings that
// could confuse which mechanism produced which gap.
//
// DELETE this whole file, its one screen (app/debug-test-tracking.tsx),
// its HIDDEN_ROUTES entry, and prisma/add-location-test-logs.sql's table
// once the comparison is done — see this file's own header pattern
// already established for debugWatchdog.ts.
export const TEST_TRACKING_TASK = 'field-location-test-tracking';

interface TestTrackingSession {
  deviceLabel: string;
  sessionId: string;
}

async function readSession(): Promise<TestTrackingSession | null> {
  const raw = await AsyncStorage.getItem(TEST_TRACKING_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TestTrackingSession;
  } catch {
    return null;
  }
}

// Same 4-field ceiling as locationPingTask.ts's identical foregroundService
// — expo-location's LocationTaskServiceOptions has no importance/
// non-dismissible field to set (checked against its own type definitions);
// killServiceOnDestroy: false is the real kill-resistance lever here, same
// as the production task.
TaskManager.defineTask(TEST_TRACKING_TASK, async ({ data, error }) => {
  if (error) {
    devWarn('[testTrackingTask] task error:', error);
    return;
  }
  const session = await readSession();
  if (!session) return; // stopped/cleared since this fire was queued

  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations ?? [];
  if (locations.length === 0) return;

  let batteryLevel: number | null = null;
  try {
    batteryLevel = await Battery.getBatteryLevelAsync();
  } catch (err) {
    devWarn('[testTrackingTask] battery read failed:', err);
  }

  const rows = locations.map((loc) => ({
    device_label: session.deviceLabel,
    session_id: session.sessionId,
    occurred_at: new Date(loc.timestamp).toISOString(),
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    battery_level: batteryLevel,
    app_state: AppState.currentState,
  }));

  const { error: insertErr } = await supabase.from('location_test_logs').insert(rows);
  if (insertErr) {
    devWarn('[testTrackingTask] insert failed:', insertErr.message);
  }
});

export async function isTestTrackingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TEST_TRACKING_TASK);
  } catch {
    return false;
  }
}

// deviceLabel is free text ("Oppo-1", "Redmi-1", "CMF-1") entered on the
// debug screen — this is a manual comparison tool, not a real device
// registry, so no validation beyond "non-empty" is needed.
export async function startTestTracking(deviceLabel: string): Promise<string> {
  if (await isTestTrackingActive()) {
    await Location.stopLocationUpdatesAsync(TEST_TRACKING_TASK);
  }
  const sessionId = Crypto.randomUUID();
  const session: TestTrackingSession = { deviceLabel, sessionId };
  await AsyncStorage.setItem(TEST_TRACKING_SESSION_KEY, JSON.stringify(session));

  await Location.startLocationUpdatesAsync(TEST_TRACKING_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5 * 60_000, // 5 minutes — per spec, exact
    distanceInterval: 0, // log on time elapsed, not movement — a stationary phone should still produce a full trail
    foregroundService: {
      notificationTitle: 'PMC Portal — Test Tracking',
      notificationBody: `Logging location every 5 min (${deviceLabel}). Debug session — do not dismiss.`,
      notificationColor: '#DC2626', // deliberately distinct red from the real tracking notification (#0F1F33) so it's obviously the debug one on the test phone
      killServiceOnDestroy: false,
    },
  });
  return sessionId;
}

export async function stopTestTracking(): Promise<void> {
  if (await isTestTrackingActive()) {
    await Location.stopLocationUpdatesAsync(TEST_TRACKING_TASK);
  }
  await AsyncStorage.removeItem(TEST_TRACKING_SESSION_KEY);
}

export async function getActiveTestSession(): Promise<TestTrackingSession | null> {
  return readSession();
}
