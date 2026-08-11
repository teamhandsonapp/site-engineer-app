import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { requestBackgroundLocationPermission } from '../lib/locationTracking/backgroundPermissionFlow';

// Shown once, BEFORE the system "Allow all the time" dialog — explaining
// why first, per the geofencing rebuild spec's own requirement (don't just
// pop the OS prompt with no context). Same full-screen visual weight as
// LocationBlockScreen, but not a hard block: FieldLocationGuard only shows
// this while background permission is still 'not-yet-asked', and moves on
// regardless of what the user picks in the OS dialog — a "while using
// only" outcome degrades to a banner (BackgroundLocationBanner), not
// another block screen, since foreground-only tracking still works.
export function BackgroundLocationExplainer({ onDone }: { onDone: () => void }) {
  const [requesting, setRequesting] = useState(false);

  async function handleContinue() {
    setRequesting(true);
    try {
      await requestBackgroundLocationPermission();
    } finally {
      setRequesting(false);
      onDone();
    }
  }

  return (
    <View className="flex-1 bg-brand-navy items-center justify-center px-8">
      <View className="w-16 h-16 rounded-full bg-brand-amber/15 items-center justify-center mb-5">
        <Ionicons name="shield-checkmark-outline" size={32} color="#F0A227" />
      </View>
      <Text className="text-lg font-bold text-white text-center">Background Location Needed</Text>
      <Text className="text-sm text-white/65 text-center mt-2.5 leading-5">
        PMC Portal checks your location a few times a day and watches for restricted zones on
        site, even when the app isn&apos;t open. On the next screen, choose &quot;Allow all the
        time&quot; so this keeps working while you&apos;re out at work.
      </Text>
      <Pressable
        onPress={handleContinue}
        disabled={requesting}
        className="mt-6 px-5 py-3 rounded-xl bg-brand-amber flex-row items-center gap-2"
        style={{ opacity: requesting ? 0.6 : 1 }}
      >
        <Text className="text-sm font-bold text-brand-navy">{requesting ? 'Requesting…' : 'Continue'}</Text>
      </Pressable>
    </View>
  );
}
