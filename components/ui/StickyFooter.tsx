// Bottom action bar (Save / Submit) that sits above the home indicator and
// moves up with the keyboard, without covering content: render it AFTER the
// ScrollView inside a KeyboardAvoidingView (see components/ui/Screen.tsx).

import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space } from '../../lib/theme';

export function StickyFooter({ children, above }: { children: ReactNode; above?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingHorizontal: space.lg,
        paddingTop: space.md,
        paddingBottom: Math.max(insets.bottom, space.md),
        gap: space.sm,
      }}
    >
      {above}
      <View style={{ flexDirection: 'row', gap: space.sm }}>{children}</View>
    </View>
  );
}
