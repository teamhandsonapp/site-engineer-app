import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type LogoProps = {
  size?: number;
  // 'amber' (default) is the app's normal brand mark everywhere else.
  // 'mono' is white-on-transparent with no filled badge behind it, for the
  // opening/login screens' own strictly black/white/grey treatment — an
  // opt-in variant, not a change to this component's default appearance.
  variant?: 'amber' | 'mono';
};

// Placeholder brand mark — an amber rounded-square badge with a deep-amber
// building glyph. Swap this for a real <Image> once a logo asset exists;
// every screen renders through this component so that's a one-file change.
export function Logo({ size = 84, variant = 'amber' }: LogoProps) {
  if (variant === 'mono') {
    return <Ionicons name="business" size={size} color="#ffffff" />;
  }
  return (
    <View
      className="items-center justify-center bg-brand-amber"
      style={{ width: size, height: size, borderRadius: size * 0.24 }}
    >
      <Ionicons name="business" size={size * 0.5} color="#412402" />
    </View>
  );
}
