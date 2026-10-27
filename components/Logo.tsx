import { Image } from 'react-native';

type LogoProps = {
  size?: number;
  // 'amber' (default): the real app icon (orange helmet badge), same image
  // as the home-screen icon. 'mono': a white helmet silhouette with no
  // badge, for dark/strictly monochrome surfaces.
  variant?: 'amber' | 'mono';
};

export function Logo({ size = 84, variant = 'amber' }: LogoProps) {
  if (variant === 'mono') {
    return (
      <Image
        source={require('../assets/notification-icon.png')}
        style={{ width: size, height: size, tintColor: '#ffffff' }}
        resizeMode="contain"
      />
    );
  }
  return (
    <Image
      source={require('../assets/icon.png')}
      style={{ width: size, height: size, borderRadius: size * 0.24 }}
    />
  );
}
