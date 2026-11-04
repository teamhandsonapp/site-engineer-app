import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// A resolved-alerts list hitting zero is good news, not an absence of
// results — framed and colored that way (a calm green check, not the
// neutral-400 "no results" gray used for e.g. an empty search), the same
// distinction a search screen vs. a task-management app should make.
export function EmptyState({
  icon = 'checkmark-circle-outline',
  iconColor = '#16A34A',
  title,
  subtitle,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <View className="items-center justify-center py-16 px-8">
      <Ionicons name={icon} size={40} color={iconColor} />
      <Text className="text-md font-semibold text-neutral-800 text-center mt-3">{title}</Text>
      {subtitle && <Text className="text-sm text-neutral-400 text-center mt-1.5">{subtitle}</Text>}
    </View>
  );
}
