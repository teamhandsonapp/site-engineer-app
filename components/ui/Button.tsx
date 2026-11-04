// One button for the whole app: clear pressed state, disabled/busy states,
// 44px minimum height (48 for `lg`), optional icon and haptic feedback.

import { ActivityIndicator, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, HIT, radius } from '../../lib/theme';
import { haptic } from '../../lib/haptics';
import { AppText } from './AppText';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'success';

const palette: Record<Variant, { bg: string; bgPressed: string; fg: string; border: string }> = {
  primary: { bg: colors.navy, bgPressed: colors.navyLight, fg: '#FFFFFF', border: colors.navy },
  accent: { bg: colors.amber, bgPressed: '#D98F18', fg: colors.navy, border: colors.amber },
  secondary: { bg: colors.surface, bgPressed: colors.surfaceMuted, fg: colors.navy, border: colors.borderStrong },
  ghost: { bg: 'transparent', bgPressed: colors.surfaceMuted, fg: colors.navy, border: 'transparent' },
  danger: { bg: colors.danger, bgPressed: '#B91C1C', fg: '#FFFFFF', border: colors.danger },
  success: { bg: colors.success, bgPressed: '#166534', fg: '#FFFFFF', border: colors.success },
};

export function Button({
  label,
  icon,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  busy,
  fullWidth,
  haptics = 'tap',
  style,
  accessibilityLabel,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  fullWidth?: boolean;
  haptics?: 'tap' | 'press' | 'none';
  style?: StyleProp<ViewStyle>;
}) {
  const p = palette[variant];
  const off = !!disabled || !!busy;
  const height = size === 'lg' ? 52 : size === 'sm' ? 36 : HIT;
  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!busy }}
      disabled={off}
      hitSlop={size === 'sm' ? 6 : undefined}
      onPress={(e) => {
        if (haptics !== 'none') haptic[haptics]();
        onPress?.(e);
      }}
      style={({ pressed }) => [
        {
          minHeight: height,
          paddingHorizontal: size === 'sm' ? 12 : 16,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: p.border,
          backgroundColor: pressed ? p.bgPressed : p.bg,
          opacity: off ? 0.5 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: fullWidth ? 'stretch' : undefined,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {busy ? (
          <ActivityIndicator size="small" color={p.fg} />
        ) : icon ? (
          <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={p.fg} />
        ) : null}
        <AppText variant={size === 'sm' ? 'label' : 'bodyStrong'} style={{ color: p.fg }} numberOfLines={1}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

// Square icon-only button with a 44px touch target.
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  color = colors.navy,
  size = 20,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  color?: string;
  size?: number;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        width: HIT,
        height: HIT,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}
