import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { Stack } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { Card } from '../components/ui/Card';
import {
  getActiveTestSession,
  isTestTrackingActive,
  startTestTracking,
  stopTestTracking,
} from '../lib/locationTracking/testTrackingTask';

// TEMPORARY (added 2026-08-15) — a standalone debug screen for the one-off
// Oppo/Redmi/CMF 2-hour tracking-reliability comparison. Not linked from
// the drawer (see components/DrawerContent.tsx's HIDDEN_ROUTES) and not
// meant for real users — reachable only by navigating here directly
// (typed URL / deep link) on the 3 physical test phones. DELETE this file
// (and its HIDDEN_ROUTES entry, testTrackingTask.ts, and
// prisma/add-location-test-logs.sql's table) once the comparison is done.
//
// No shift-window/role gating at all, by design — this needs to run on
// whatever test login happens to be signed into a given test phone, for a
// fixed 2-hour window regardless of time of day.
export default function DebugTestTrackingScreen() {
  const { state } = useAuth();
  const [deviceLabel, setDeviceLabel] = useState('');
  const [active, setActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([isTestTrackingActive(), getActiveTestSession()]).then(([isActive, session]) => {
      setActive(isActive);
      if (session) {
        setDeviceLabel(session.deviceLabel);
        setSessionId(session.sessionId);
      }
      setLoading(false);
    });
  }, []);

  async function handleStart() {
    const label = deviceLabel.trim();
    if (!label) {
      setError('Enter a device label first (e.g. "Oppo-1").');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') throw new Error('Foreground location permission was not granted.');
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') throw new Error('Background location permission was not granted — required for this test.');

      const newSessionId = await startTestTracking(label);
      setSessionId(newSessionId);
      setActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    setError(null);
    try {
      await stopTestTracking();
      setActive(false);
      setSessionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (state.status !== 'signed-in') {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Sign in first.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen options={{ headerShown: true, title: 'Test Tracking (Debug)', headerStyle: { backgroundColor: '#DC2626' }, headerTintColor: '#fff' }} />
      <View className="flex-1 px-4 pt-5">
        <Card>
          <Text className="text-sm font-bold text-neutral-900 mb-1">Background Tracking Reliability Test</Text>
          <Text className="text-xs text-neutral-400 mb-4">
            Logs location every 5 minutes to `location_test_logs`. Run for a fixed 2-hour window, screen locked, app backgrounded, phone untouched.
          </Text>

          {loading ? (
            <ActivityIndicator color="#0F1F33" />
          ) : (
            <>
              <Text className="text-xs text-neutral-400 mb-1">Device Label</Text>
              <TextInput
                value={deviceLabel}
                onChangeText={setDeviceLabel}
                placeholder='e.g. "Oppo-1", "Redmi-1", "CMF-1"'
                editable={!active}
                className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
                style={{ opacity: active ? 0.6 : 1 }}
              />

              {error && (
                <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
                  <Text className="text-xs text-red-600">{error}</Text>
                </View>
              )}

              {active && (
                <View className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 mb-3">
                  <Text className="text-xs font-semibold text-green-800">Tracking active — session {sessionId?.slice(0, 8)}…</Text>
                </View>
              )}

              {!active ? (
                <Pressable
                  onPress={handleStart}
                  disabled={busy}
                  className="items-center py-3 rounded-xl"
                  style={{ backgroundColor: '#16A34A', opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-sm font-bold text-white">Start Test Tracking</Text>}
                </Pressable>
              ) : (
                <Pressable
                  onPress={handleStop}
                  disabled={busy}
                  className="items-center py-3 rounded-xl"
                  style={{ backgroundColor: '#DC2626', opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-sm font-bold text-white">Stop Test Tracking</Text>}
                </Pressable>
              )}
            </>
          )}
        </Card>
      </View>
    </View>
  );
}
