import { useCallback, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

// Android back / back-swipe steps back ONE level inside a screen that opens its
// levels in place (Files → Drawings → department → file), instead of leaving the
// whole screen for Home (2026-11-16). `onBack` returns true when it handled the
// step, false to let the next handler (or normal navigation) take it.
export function useBackStep(onBack: () => boolean) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => ref.current());
      return () => sub.remove();
    }, [])
  );
}
