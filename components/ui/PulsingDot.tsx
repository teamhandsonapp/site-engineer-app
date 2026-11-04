import { useEffect, useState } from 'react';
import { Animated } from 'react-native';

// A visibly "alive" indicator for the green tracking-health state — a
// static dot reads identically whether the data is five seconds old or
// five hours old, which is exactly the ambiguity the exact-reason indicator
// work was meant to remove. Plain Animated (not Reanimated) since this is
// a single looping opacity tween with no gesture/worklet involvement —
// useNativeDriver keeps it off the JS thread regardless. A lazy useState
// (not useRef().current) holds the Animated.Value — this app's lint config
// flags reading ref.current during render, and a stable state value avoids
// that without needing an effect just to assign a ref.
export function PulsingDot({ color, size = 6 }: { color: string; size?: number }) {
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity }}
    />
  );
}
