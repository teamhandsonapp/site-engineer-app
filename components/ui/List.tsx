// Grouped lists: a titled section (white card) of rows separated by hairline
// dividers — consistent padding and 52px+ rows instead of a separate card
// per item.

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, shadow, space } from '../../lib/theme';
import { haptic } from '../../lib/haptics';
import { AppText } from './AppText';

export function SectionHeader({ title, action, style }: { title: string; action?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm, marginTop: space.xs, paddingHorizontal: 2 }, style]}>
      <AppText variant="overline" accessibilityRole="header">
        {title}
      </AppText>
      {action}
    </View>
  );
}

export function ListSection({ title, action, children, style }: { title?: string; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[{ marginBottom: space.xl }, style]}>
      {title ? <SectionHeader title={title} action={action} /> : null}
      <View style={[{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }, shadow.card]}>
        {items.map((child, i) => (
          <Fragment key={child.key ?? i}>
            {i > 0 && <View style={{ height: 1, backgroundColor: colors.divider, marginLeft: space.lg }} />}
            {child}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  icon,
  iconColor = colors.navy,
  iconBg = colors.navySoft,
  leading,
  trailing,
  value,
  onPress,
  chevron = !!onPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBg?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  value?: string | number;
  onPress?: () => void;
  chevron?: boolean;
  accessibilityLabel?: string;
}) {
  const content = (pressed: boolean) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        minHeight: 56,
        backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
      }}
    >
      {leading ??
        (icon ? (
          <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={18} color={iconColor} />
          </View>
        ) : null)}
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" numberOfLines={2} style={{ marginTop: 1 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value != null && (
        <AppText variant="section" numberOfLines={1} style={{ fontVariant: ['tabular-nums'], flexShrink: 1, maxWidth: '50%' }}>
          {value}
        </AppText>
      )}
      {trailing}
      {chevron && <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
    </View>
  );
  if (!onPress) return content(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
    >
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}
