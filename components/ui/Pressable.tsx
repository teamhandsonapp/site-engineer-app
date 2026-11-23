// Drop-in replacement for react-native's Pressable that supports a style (and
// children) FUNCTION — `style={({ pressed }) => ...}` — on Android/iOS builds.
//
// Why (2026-11-14): NativeWind 4.2's css-interop wraps react-native's
// Pressable on native and drops a function `style`, so every pressable that
// set its layout that way (Button, the Home quick links, the project chip,
// the bottom tab bar…) rendered unstyled on the phone while looking fine on
// web. This keeps its own `pressed` state and passes a plain style object,
// which css-interop handles correctly. Use it wherever `style` is a function.

import { useState } from 'react';
import {
  Pressable as RNPressable,
  type GestureResponderEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type View,
} from 'react-native';
import type { Ref } from 'react';

export function Pressable({ style, children, onPressIn, onPressOut, ...rest }: PressableProps & { ref?: Ref<View> }) {
  const [pressed, setPressed] = useState(false);
  const state = { pressed, hovered: false } as PressableStateCallbackType;
  const resolvedStyle = typeof style === 'function' ? style(state) : style;
  const resolvedChildren = typeof children === 'function' ? children(state) : children;
  return (
    <RNPressable
      {...rest}
      style={resolvedStyle}
      onPressIn={(e: GestureResponderEvent) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressed(false);
        onPressOut?.(e);
      }}
    >
      {resolvedChildren}
    </RNPressable>
  );
}
