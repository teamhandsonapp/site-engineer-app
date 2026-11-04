// Loading / empty / error states, so no screen is ever just blank.

import { useEffect, useState } from 'react';
import { Animated, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, shadow, space } from '../../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';

// Gently pulsing placeholder block.
export function SkeletonBlock({ width = '100%', height = 14, style }: { width?: DimensionValue; height?: number; style?: StyleProp<ViewStyle> }) {
  const [opacity] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ width, height, borderRadius: 6, backgroundColor: '#E6E9EE', opacity }, style]} />;
}

export function SkeletonCard({ lines = 2, style }: { lines?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.lg, marginBottom: space.md, gap: space.sm }, shadow.card, style]}>
      <SkeletonBlock width="55%" height={16} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} width={i === lines - 1 ? '70%' : '100%'} height={12} />
      ))}
    </View>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: space.xl }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
          <SkeletonBlock width={36} height={36} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBlock width="60%" height={13} />
            <SkeletonBlock width="35%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ErrorState({ message, onRetry, title = "Couldn't load this" }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.xxl, gap: space.sm }} accessibilityRole="alert">
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="cloud-offline-outline" size={26} color={colors.danger} />
      </View>
      <AppText variant="section" style={{ textAlign: 'center', marginTop: space.xs }}>
        {title}
      </AppText>
      <AppText variant="body" tone="muted" style={{ textAlign: 'center' }}>
        {message}
      </AppText>
      {onRetry ? <Button label="Try again" icon="refresh" variant="secondary" onPress={onRetry} style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}

// Inline (non-blocking) error banner — e.g. a failed save under a form.
export function InlineError({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <View
      accessibilityRole="alert"
      style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: '#F5C2C2', borderRadius: radius.sm, padding: space.md }}
    >
      <Ionicons name="alert-circle" size={18} color={colors.danger} style={{ marginTop: 1 }} />
      <AppText variant="label" tone="danger" style={{ flex: 1 }}>
        {message}
      </AppText>
      {onDismiss ? <Ionicons name="close" size={18} color={colors.danger} onPress={onDismiss} accessibilityLabel="Dismiss" /> : null}
    </View>
  );
}
