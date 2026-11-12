import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KEYBOARD_BEHAVIOR } from './KeyboardAvoider';

// Shared keyboard-safe pop-up (2026-11-12, responsiveness batch 1).
// Replaces the app's repeated pattern
//   <Modal transparent> -> <Pressable backdrop> -> <Pressable card>
// with  <FormModal> -> <Pressable card>  (the card itself is unchanged).
//
// - KeyboardAvoidingView: 'padding' on iOS, 'height' on Android, nothing on
//   web — the area above the keyboard shrinks, so a card with a %-maxHeight
//   (most cards use 75–88%) re-fits above the keyboard and its own inner
//   ScrollView keeps the bottom fields and Save/Create button reachable.
// - Outer ScrollView (keyboardShouldPersistTaps="handled"): when even the
//   shrunk card can't fit (short phones, large system font), the whole card
//   scrolls instead of being cut off; taps on buttons work while typing.
// - Tapping the dark backdrop calls onBackdropPress (default: onRequestClose),
//   same as before.
export function FormModal({
  visible,
  onRequestClose,
  onBackdropPress,
  animationType = 'fade',
  position = 'center',
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  onBackdropPress?: () => void;
  animationType?: 'none' | 'slide' | 'fade';
  // 'center' = dialog card (default); 'bottom' = bottom sheet.
  position?: 'center' | 'bottom';
  children: ReactNode;
}) {
  const isBottom = position === 'bottom';
  return (
    <Modal visible={visible} transparent animationType={animationType} onRequestClose={onRequestClose}>
      <View className="flex-1 bg-black/40">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_BEHAVIOR}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={
              isBottom
                ? { flexGrow: 1, justifyContent: 'flex-end' }
                : { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24 }
            }
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator={false}
            bounces={false}
            nestedScrollEnabled
          >
            {/* Backdrop: fills the scroll area behind the card. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onBackdropPress ?? onRequestClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            />
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
