// Typography with a clear hierarchy (title / section / body / label /
// caption / overline) in IBM Plex, using lib/theme.ts. Prefer this over raw
// <Text> + ad-hoc sizes in redesigned screens.
//
// Font-size cap (2026-11-12, responsiveness batch 2): every text and input in
// the app follows the phone's font-size setting only up to 1.3x, so a large
// system font can't push text out of pills, rings, tabs and fixed rows.
// `Text` / `TextInput` below are drop-in replacements for the react-native
// ones (same props, className included); pass maxFontSizeMultiplier to
// override (e.g. 1.4 in BottomTabBar). React 19 passes `ref` as a normal prop,
// so refs on TextInput (focus()) keep working.

import type { Ref } from 'react';
import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { colors, type } from '../../lib/theme';

export const MAX_FONT_SCALE = 1.3;

export function Text({ maxFontSizeMultiplier = MAX_FONT_SCALE, ...props }: TextProps & { ref?: Ref<RNText> }) {
  return <RNText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />;
}

export function TextInput({ maxFontSizeMultiplier = MAX_FONT_SCALE, ...props }: TextInputProps & { ref?: Ref<RNTextInput> }) {
  return <RNTextInput maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />;
}

// Explicit names for new code.
export const AppTextInput = TextInput;

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
