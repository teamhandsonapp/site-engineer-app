// Per-screen error fallback. Every screen file re-exports this as
// `ErrorBoundary`, which expo-router wraps around THAT screen only — so a
// crash while rendering one screen shows this message inside the screen,
// while the drawer / header / back button keep working and the user can go
// somewhere else. (The root ErrorBoundary in app/_layout.tsx is still the
// last resort for errors above the navigator.)

import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type ErrorBoundaryProps } from 'expo-router';
import { logError } from '../lib/sentryLog';

export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    logError(error, 'route_error_boundary');
  }, [error]);

  return (
    <View className="flex-1 items-center justify-center bg-neutral-50 px-8">
      <Ionicons name="alert-circle-outline" size={36} color="#9CA3AF" />
      <Text className="text-md font-semibold text-neutral-900 text-center mt-3 mb-1.5">This screen couldn&apos;t load</Text>
      <Text className="text-sm text-neutral-500 text-center leading-5 mb-5">
        Something went wrong on this screen. The rest of the app still works — try again, or go back to Home.
      </Text>
      <View className="flex-row gap-3">
        <Pressable onPress={() => retry()} className="px-5 rounded-xl bg-brand-navy justify-center" style={{ minHeight: 44 }}>
          <Text className="text-sm font-semibold text-white">Try Again</Text>
        </Pressable>
        <Pressable
          onPress={() => router.replace('/(authenticated)/home')}
          className="px-5 rounded-xl border border-neutral-300 justify-center"
          style={{ minHeight: 44 }}
        >
          <Text className="text-sm font-semibold text-neutral-700">Go to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}
