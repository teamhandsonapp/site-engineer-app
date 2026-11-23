// Standard scrolling screen body: theme background, consistent 16px gutter,
// pull-to-refresh, keyboard avoidance (inputs never hidden behind the
// keyboard) and an optional sticky footer that stays above the keyboard and
// home indicator.

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { KEYBOARD_BEHAVIOR } from './KeyboardAvoider';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { colors, space } from '../../lib/theme';

export function Screen({
  children,
  footer,
  refreshing,
  onRefresh,
  contentStyle,
  scroll = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
}) {
  // Header height so the keyboard offset is right on iOS (0 on screens without a header).
  const headerHeight = useHeaderHeight();
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ padding: space.lg, paddingBottom: space.xxxl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.navy} colors={[colors.navy]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, padding: space.lg }, contentStyle]}>{children}</View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={KEYBOARD_BEHAVIOR}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      {body}
      {footer}
    </KeyboardAvoidingView>
  );
}
