import { forwardRef, useImperativeHandle } from 'react';
import { Text, View } from 'react-native';
import type { DayTimeline } from '../lib/dayTimeline';

// react-native-maps has zero web support (crashes at import time under
// react-native-web) — same reasoning as SiteLocationMapPicker.web.tsx, which
// this mirrors. Props/Handle shapes are duplicated from DayTrailMap.tsx
// rather than cross-imported, same convention as that pair of files.
export interface DayTrailMapHandle {
  focusOnCoordinate: (latitude: number, longitude: number) => void;
}

interface Props {
  timeline: DayTimeline;
  height?: number;
  // Item 6 — accepted for interface parity with the native file, unused
  // here (no real map to select a marker on).
  selectedEventId?: string | null;
  onMarkerPress?: (eventId: string) => void;
}

export const DayTrailMap = forwardRef<DayTrailMapHandle, Props>(function DayTrailMap(_props, ref) {
  useImperativeHandle(ref, () => ({
    focusOnCoordinate() {},
  }));

  return (
    <View
      style={{ height: _props.height ?? 300, borderRadius: 12 }}
      className="items-center justify-center bg-neutral-50 border border-neutral-200 px-4"
    >
      <Text className="text-xs text-neutral-500 text-center">
        The map trail is only available in the mobile app build — use the list below, or open this screen
        on your phone.
      </Text>
    </View>
  );
});
