import { Text, View } from 'react-native';

// react-native-maps has ZERO web support — unlike the previous react-native-
// webview approach (which at least shipped a real, if unimplemented, web
// stub), importing react-native-maps at all on web crashes immediately at
// MODULE-LOAD time ("codegenNativeComponent is not a function"), before any
// runtime Platform.OS check in the native file ever gets a chance to run.
// Metro/Expo's bundler resolves THIS file instead of SiteLocationMapPicker.tsx
// whenever bundling for web (the .web.tsx extension convention) — so the
// native file can import react-native-maps freely, and this file must never
// import it, directly or transitively.
interface Props {
  latitude: number;
  longitude: number;
  radiusMeters: number | null;
  onChange: (lat: number, lng: number) => void;
  height?: number;
}

export function SiteLocationMapPicker(_props: Props) {
  return (
    <View
      style={{ height: 96, borderRadius: 12 }}
      className="items-center justify-center bg-neutral-50 border border-neutral-200 px-4"
    >
      <Text className="text-xs text-neutral-500 text-center">
        Interactive map preview is only available in the mobile app build — use the fields below, or open
        this screen on your phone.
      </Text>
    </View>
  );
}
