import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface CanvasLeftRailItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

// A persistent vertical strip along the left edge of the canvas — the
// eventual plan is a column of icons a user taps through, so this is
// array-driven from the start (adding a second/third action later is just
// another array entry, not a rewrite) even though it renders only one "+"
// today. Filled navy, matching this app's other primary-action buttons
// (New Task/Create Template elsewhere) — deliberately a different fill
// from the neutral white zoom controls on the right, so the two floating
// control clusters read as visually distinct at a glance, not just
// spatially separate.
export function CanvasLeftRail({ items }: { items: CanvasLeftRailItem[] }) {
  if (items.length === 0) return null;
  return (
    <View className="absolute left-3 items-center gap-1.5" style={{ top: 70 }}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          onPress={item.onPress}
          className="w-10 h-10 rounded-full bg-brand-navy items-center justify-center"
          style={{ elevation: 3 }}
        >
          <Ionicons name={item.icon} size={20} color="#ffffff" />
        </Pressable>
      ))}
    </View>
  );
}
