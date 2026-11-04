// Typography with a clear hierarchy (title / section / body / label /
// caption / overline) in IBM Plex, using lib/theme.ts. Prefer this over raw
// <Text> + ad-hoc sizes in redesigned screens.

import { Text, type TextProps, type TextStyle } from 'react-native';
import { colors, type } from '../../lib/theme';

export type TextVariant = keyof typeof type;
type Tone = 'default' | 'secondary' | 'muted' | 'inverse' | 'brand' | 'success' | 'warning' | 'danger';

const toneColor: Record<Tone, string> = {
  default: colors.text,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  inverse: colors.textInverse,
  brand: colors.navy,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

export function AppText({
  variant = 'body',
  tone,
  style,
  ...rest
}: TextProps & { variant?: TextVariant; tone?: Tone }) {
  const defaultTone: Tone = variant === 'caption' || variant === 'overline' ? 'muted' : variant === 'label' ? 'secondary' : 'default';
  return <Text {...rest} style={[type[variant] as TextStyle, { color: toneColor[tone ?? defaultTone] }, style]} />;
}
