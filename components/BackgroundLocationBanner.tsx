import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Persistent but NON-blocking — unlike LocationBlockScreen, this never
// replaces the app content. "While using the app" is a legitimate,
// user-chosen OS setting (never force-overridden — see
// backgroundPermissionFlow.ts's own comment), so the app keeps working in
// foreground-only mode; this banner is just a standing reminder that
// zone/geofence detection stops the moment the app is backgrounded.
export function BackgroundLocationBanner() {
  return (
    <View className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex-row items-center gap-2.5">
      <Ionicons name="warning-outline" size={16} color="#B45309" />
      <Text className="flex-1 text-2xs text-amber-800">
        Location only tracks while the app is open. Turn on &quot;Allow all the time&quot; in Settings for full coverage.
      </Text>
      <Pressable onPress={() => Linking.openSettings()}>
        <Text className="text-2xs font-bold text-amber-800">Settings</Text>
      </Pressable>
    </View>
  );
}
