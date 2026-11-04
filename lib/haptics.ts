import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Small, consistent haptic feedback for key actions. Never throws and does
// nothing on web (no haptics engine).
export const haptic = {
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  press: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  select: () => run(() => Haptics.selectionAsync()),
};

function run(fn: () => Promise<void>) {
  if (Platform.OS === 'web') return;
  fn().catch(() => {});
}
