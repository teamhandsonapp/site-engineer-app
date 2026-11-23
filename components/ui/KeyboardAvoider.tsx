import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';

// One keyboard rule for the whole app (2026-11-12, responsiveness batch 1):
// 'padding' on iOS, 'height' on Android (edge-to-edge is always on, so the
// window no longer resizes for the keyboard by itself), nothing on web.
export const KEYBOARD_BEHAVIOR =
  Platform.OS === 'ios' ? ('padding' as const) : Platform.OS === 'android' ? ('height' as const) : undefined;

// Full-screen pages: wrap the page's ScrollView in this (and give that
// ScrollView keyboardShouldPersistTaps="handled") so inputs lower on the page
// scroll above the keyboard. iOS offset = the navigation header's height.
export function KeyboardAvoider({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const headerHeight = useHeaderHeight();
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={KEYBOARD_BEHAVIOR}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
