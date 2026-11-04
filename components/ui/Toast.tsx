// App-wide toast: `const toast = useToast(); toast.success('Saved')`.
// One provider at the root (app/_layout.tsx); toasts sit above the home
// indicator / bottom tab bar and fade out after a few seconds.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, space } from '../../lib/theme';
import { haptic } from '../../lib/haptics';
import { AppText } from './AppText';

type ToastKind = 'success' | 'error' | 'info';
interface ToastApi {
  show: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

// Height of the bottom tab bar, so toasts float above it on tab screens.
const BOTTOM_CLEARANCE = 72;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ kind: ToastKind; message: string; id: number } | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback(
    (kind: ToastKind, message: string) => {
      if (kind === 'success') haptic.success();
      else if (kind === 'error') haptic.error();
      setToast({ kind, message, id: Date.now() });
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
      }, kind === 'error' ? 4500 : 2600);
    },
    [opacity]
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ show, success: (m) => show('success', m), error: (m) => show('error', m), info: (m) => show('info', m) }),
    [show]
  );

  const bg = toast?.kind === 'error' ? colors.danger : toast?.kind === 'info' ? colors.navyLight : colors.navy;
  const icon = toast?.kind === 'error' ? 'alert-circle' : toast?.kind === 'info' ? 'information-circle' : 'checkmark-circle';

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            {
              position: 'absolute',
              left: space.lg,
              right: space.lg,
              bottom: insets.bottom + BOTTOM_CLEARANCE,
              opacity,
              backgroundColor: bg,
              borderRadius: radius.md,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
            },
            shadow.raised,
          ]}
        >
          <Ionicons name={icon} size={18} color="#FFFFFF" />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" tone="inverse">
              {toast.message}
            </AppText>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  // Outside the provider (tests, isolated renders): a no-op so callers never crash.
  return ctx ?? { show: () => {}, success: () => {}, error: () => {}, info: () => {} };
}
