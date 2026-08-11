import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { openTrackingFixSettings, type TrackingDegradedReason } from '../lib/locationTracking/trackingStatus';

const COPY: Record<TrackingDegradedReason, { message: string; actionLabel: string }> = {
  background_permission: {
    message: "Background location permission was turned off — tracking has stopped.",
    actionLabel: 'Fix in Settings',
  },
  gps_disabled: {
    message: 'Location (GPS) is turned off on this device — tracking has stopped.',
    actionLabel: 'Turn on Location',
  },
};

// Point 9 — "silence should never be interpreted as everything is fine."
// Distinct from BackgroundLocationBanner (which is an ambient, low-urgency
// nudge shown any time background permission is only "while using," shift
// or no shift): this one only ever appears WHILE the engineer is actually
// on shift and tracking has genuinely broken, so FieldLocationGuard shows
// at most one of the two at a time rather than stacking redundant banners.
export function TrackingDegradedBanner({ reason }: { reason: TrackingDegradedReason }) {
  const copy = COPY[reason];
  return (
    <View className="bg-red-50 border-b border-red-200 px-4 py-2.5 flex-row items-center gap-2.5">
      <Ionicons name="alert-circle" size={16} color="#B91C1C" />
      <Text className="flex-1 text-2xs font-semibold text-red-800">{copy.message}</Text>
      <Pressable onPress={() => openTrackingFixSettings(reason)}>
        <Text className="text-2xs font-bold text-red-800">{copy.actionLabel}</Text>
      </Pressable>
    </View>
  );
}
