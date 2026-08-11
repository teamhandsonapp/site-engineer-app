import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { logAction } from '../lib/sentryLog';

// Full-screen, non-dismissible (Android hardware back suppressed below —
// there's no drawer/header rendered around this at all, see
// FieldLocationGuard.tsx, so there's no gesture path out either) block for
// a signed-in site_engineer/senior_site_engineer whose location permission
// or device location services are currently off. Reactive parent state
// (useLocationGateStatus) means this disappears the instant either is
// fixed — no remount/restart needed, and it reappears immediately if
// disabled again mid-session (useLocationGateStatus polls every 5s and on
// every AppState resume, so granting permission below is picked up without
// this component needing to force a re-check itself).
export function LocationBlockScreen({ reason }: { reason: 'permission' | 'services' }) {
  const [requesting, setRequesting] = useState(false);
  // Once a real ask comes back denied with canAskAgain: false, Android will
  // never show its own dialog again — Settings really is the only path from
  // then on. Starts false so the FIRST tap always tries the real in-app
  // dialog first, never jumping straight to Settings (the bug this fixes:
  // this screen previously did nothing BUT jump to Settings, even on a
  // brand-new install that had never been asked at all).
  const [settingsOnly, setSettingsOnly] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  async function handlePermissionPress() {
    if (settingsOnly) {
      Linking.openSettings();
      return;
    }
    setRequesting(true);
    try {
      const result = await Location.requestForegroundPermissionsAsync();
      logAction('permission', 'Foreground permission requested from block screen', {
        status: result.status,
        canAskAgain: result.canAskAgain,
      });
      // A granted result needs no further action here — useLocationGateStatus's
      // own poll/AppState listener picks it up and unmounts this screen on its
      // own. Only a real denial with no more native asks left switches this
      // button over to the Settings fallback.
      if (result.status !== 'granted' && !result.canAskAgain) {
        setSettingsOnly(true);
      }
    } finally {
      setRequesting(false);
    }
  }

  const title = reason === 'permission' ? 'Location Permission Required' : 'Turn On Location Services';
  const message =
    reason === 'permission'
      ? "This account needs location access granted to PMC Portal to continue — it's used to confirm you're at your assigned site during work hours."
      : 'Location services are off on this device. Turn them on to continue using PMC Portal.';
  // Device location services (GPS toggle) has no in-app dialog at all —
  // Settings is the only real path there, unlike the permission case above.
  const buttonLabel = reason === 'services' ? 'Open Location Settings' : settingsOnly ? 'Open Location Settings' : 'Allow Location Access';

  return (
    <View className="flex-1 bg-brand-navy items-center justify-center px-8">
      <View className="w-16 h-16 rounded-full bg-brand-amber/15 items-center justify-center mb-5">
        <Ionicons name="location-outline" size={32} color="#F0A227" />
      </View>
      <Text className="text-lg font-bold text-white text-center">{title}</Text>
      <Text className="text-sm text-white/65 text-center mt-2.5 leading-5">{message}</Text>
      <Pressable
        onPress={reason === 'services' ? () => Linking.openSettings() : handlePermissionPress}
        disabled={requesting}
        className="mt-6 px-5 py-3 rounded-xl bg-brand-amber flex-row items-center gap-2"
        style={{ opacity: requesting ? 0.6 : 1 }}
      >
        {requesting ? (
          <ActivityIndicator size="small" color="#0F1F33" />
        ) : (
          <Ionicons name={settingsOnly || reason === 'services' ? 'settings-outline' : 'location-outline'} size={16} color="#0F1F33" />
        )}
        <Text className="text-sm font-bold text-brand-navy">{buttonLabel}</Text>
      </Pressable>
      <Text className="text-2xs text-white/40 text-center mt-5">
        This screen will go away automatically once location is enabled.
      </Text>
    </View>
  );
}
