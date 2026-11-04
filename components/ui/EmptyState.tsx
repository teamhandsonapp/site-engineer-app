import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, space } from '../../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';

// Friendly empty state: icon in a soft circle, title, optional message and
// optional action. Same props as before (icon / iconColor / title /
// subtitle), so existing screens keep working.
export function EmptyState({
  icon = 'checkmark-circle-outline',
  iconColor = '#16A34A',
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxxl + space.lg, paddingHorizontal: space.xxl }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={30} color={iconColor} />
      </View>
      <AppText variant="section" style={{ textAlign: 'center', marginTop: space.md }}>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="body" tone="muted" style={{ textAlign: 'center', marginTop: space.xs }}>
          {subtitle}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} variant="secondary" onPress={onAction} style={{ marginTop: space.lg }} /> : null}
    </View>
  );
}
