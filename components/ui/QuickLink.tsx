import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';

// Shared between App Home (now the primary place these live) and
// project-dashboard.tsx (which still uses the same row for its own
// project-scoped shortcuts) — was previously defined twice, once per
// screen, before Home grew its own Quick Links section.
export function QuickLink({
  icon,
  label,
  color,
  badge,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Card className="flex-row items-center justify-between mb-2.5">
        <View className="flex-row items-center gap-3">
          <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${color}1A` }}>
            <Ionicons name={icon} size={16} color={color} />
          </View>
          <Text className="text-sm font-semibold text-neutral-800">{label}</Text>
        </View>
        <View className="flex-row items-center gap-2">
          {!!badge && badge > 0 && (
            <View className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 items-center justify-center">
              <Text className="text-2xs font-bold text-white">{badge > 99 ? '99+' : badge}</Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={16} color="#D4D4D4" />
        </View>
      </Card>
    </Pressable>
  );
}
