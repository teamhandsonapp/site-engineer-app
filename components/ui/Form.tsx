// Form building blocks: titled sections (cards), labels ABOVE inputs, helper
// / error text, 48px inputs with readable placeholders.

import type { ReactNode } from 'react';
import { TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, shadow, space, type as t } from '../../lib/theme';
import { AppText } from './AppText';

export function FormSection({
  title,
  description,
  icon,
  right,
  children,
  style,
}: {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.lg, marginBottom: space.md, gap: space.md },
        shadow.card,
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {icon ? <Ionicons name={icon} size={18} color={colors.navy} /> : null}
        <View style={{ flex: 1 }}>
          <AppText variant="section" accessibilityRole="header">
            {title}
          </AppText>
          {description ? <AppText variant="caption">{description}</AppText> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function FormField({ label, hint, error, required, children }: { label: string; hint?: string; error?: string | null; required?: boolean; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">
        {label}
        {required ? <AppText variant="label" tone="danger"> *</AppText> : null}
      </AppText>
      {children}
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption">{hint}</AppText>
      ) : null}
    </View>
  );
}

export function TextField({ invalid, multiline, style, ...props }: TextInputProps & { invalid?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={colors.placeholder}
      multiline={multiline}
      {...props}
      style={[
        t.body,
        {
          color: colors.text,
          backgroundColor: props.editable === false ? colors.surfaceMuted : colors.surface,
          borderWidth: 1,
          borderColor: invalid ? colors.danger : colors.borderStrong,
          borderRadius: radius.sm,
          paddingHorizontal: space.md,
          paddingVertical: multiline ? space.md : 0,
          minHeight: multiline ? 96 : 48,
          textAlignVertical: multiline ? 'top' : 'center',
        },
        style,
      ]}
    />
  );
}
