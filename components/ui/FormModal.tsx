import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KEYBOARD_BEHAVIOR } from './KeyboardAvoider';

/**
 * Backdrop close that ignores taps in the first `ms` after the pop-up opens
 * (2026-11-18). A pop-up opened by a gesture-handler tap (e.g. a flowchart
 * card's DPR icon) appears on pointer-up, and on web the browser's click for
 * that SAME press then lands on the new backdrop and closed it again at once.
 * Use as FormModal's onBackdropPress; onRequestClose (Android back) is unaffected.
 */
export function useBackdropGuard(visible: boolean, onClose: () => void, ms = 400): () => void {
  const openedAt = useRef(0);
  // Layout effect: runs in the same step the backdrop is put on screen, so
  // the stray click can never arrive before the timer starts.
  useLayoutEffect(() => {
    if (visible) openedAt.current = Date.now();
  }, [visible]);
  return useCallback(() => {
    if (Date.now() - openedAt.current < ms) return;
    onClose();
  }, [onClose, ms]);
}

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
