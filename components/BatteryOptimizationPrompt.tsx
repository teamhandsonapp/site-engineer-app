import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  markBatteryOptimizationPrompted,
  requestIgnoreBatteryOptimizations,
} from '../lib/locationTracking/batteryOptimization';

// Point 6 — shown exactly once, right after the background-permission step
// resolves (Part 1's BackgroundLocationExplainer), Android-only. Same
// full-screen weight as that screen for visual consistency, but with a
// real "Not now" escape hatch: unlike background location, this isn't
// something the rest of tracking depends on to function at all (Doze
// throttling is a "sometimes, on some devices" reliability risk, not a
// hard requirement) — so declining just moves on, never re-prompted again
// per FieldLocationGuard's own "ask once" gating.
export function BatteryOptimizationPrompt({ onDone }: { onDone: () => void }) {
  const [requesting, setRequesting] = useState(false);

  async function finish() {
    await markBatteryOptimizationPrompted();
    onDone();
  }

  async function handleAllow() {
    setRequesting(true);
    try {
      await requestIgnoreBatteryOptimizations();
    } finally {
      setRequesting(false);
      await finish();
    }
  }

  return (
    <View className="flex-1 bg-brand-navy items-center justify-center px-8">
      <View className="w-16 h-16 rounded-full bg-brand-amber/15 items-center justify-center mb-5">
        <Ionicons name="battery-charging-outline" size={32} color="#F0A227" />
      </View>
      <Text className="text-lg font-bold text-white text-center">Keep Tracking Reliable</Text>
      <Text className="text-sm text-white/65 text-center mt-2.5 leading-5">
        Some phones aggressively stop background apps to save battery, which can interrupt site
        tracking. Allowing PMC Portal to skip battery optimization keeps zone alerts working
        reliably while you&apos;re on shift.
      </Text>
      <Pressable
        onPress={handleAllow}
        disabled={requesting}
        className="mt-6 px-5 py-3 rounded-xl bg-brand-amber flex-row items-center gap-2"
        style={{ opacity: requesting ? 0.6 : 1 }}
      >
        <Text className="text-sm font-bold text-brand-navy">{requesting ? 'Requesting…' : 'Allow'}</Text>
      </Pressable>
      <Pressable onPress={finish} disabled={requesting} className="mt-3 px-5 py-2">
        <Text className="text-sm font-semibold text-white/60">Not now</Text>
      </Pressable>
    </View>
  );
}
