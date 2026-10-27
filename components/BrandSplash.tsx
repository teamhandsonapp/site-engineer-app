import { Image, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

// The in-app continuation of the native splash (app.json expo-splash-screen:
// #F0A227 background + assets/splash-lockup.png at imageWidth 300). The
// lockup inside that 300-wide square canvas is 64% of its width, so drawing
// brand-lockup.png at 192 wide lands on exactly the same pixels — the
// native → JS handoff (while the session restores) is invisible instead of
// jumping to a bare spinner.
export function BrandSplash() {
  return (
    <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#F0A227' }}>
      <StatusBar style="dark" />
      <Image
        source={require('../assets/brand-lockup.png')}
        style={{ width: 192, height: 192 * (124 / 768) }}
        resizeMode="contain"
      />
    </View>
  );
}
