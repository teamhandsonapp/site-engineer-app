import * as Device from 'expo-device';
import Constants, { AppOwnership } from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { devWarn } from './devLog';

// expo-notifications' own module has a top-level side effect
// (DevicePushTokenAutoRegistration.fx.js) that THROWS immediately on import
// when running inside Expo Go — a hard, documented limitation since SDK 53
// (push notifications need a real development build, not Expo Go:
// https://docs.expo.dev/develop/development-builds/introduction/). A static
// `import * as Notifications from 'expo-notifications'` at the top of this
// file would crash the entire app at launch inside Expo Go, since this
// module is imported (transitively, via AuthContext.tsx) from the app's
// root layout. Requiring it lazily, only after confirming we're not inside
// Expo Go, keeps this file safe to import from anywhere while push
// notifications keep working exactly as before in a real development build
// or the shipped production APK — neither of those report
// appOwnership === 'expo'.
function isExpoGo(): boolean {
  return Constants.appOwnership === AppOwnership.Expo;
}

// Called after every successful sign-in and session restore (see
// AuthContext.tsx) — always fire-and-forget from the caller's side. Every
// failure mode here (permission denied, no physical device, no EAS project
// configured yet, a transient network error) is handled by just returning
// early with a warning: this feature is additive, so the rest of the app
// must work identically whether or not it succeeds.
export async function registerForPushNotificationsAsync(email: string): Promise<void> {
  if (isExpoGo()) {
    devWarn('[push] Skipping — Expo Go does not support push notifications since SDK 53; use a development build.');
    return;
  }

  if (!Device.isDevice) {
    devWarn('[push] Skipping — push tokens require a physical device, not a simulator/emulator.');
    return;
  }

  // Must be a runtime require, not a static import: see the module-level
  // comment above on why a static import of expo-notifications crashes Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      devWarn('[push] Permission not granted — continuing without push notifications.');
      return;
    }

    if (Platform.OS === 'android') {
      // No `sound` key at all — expo-notifications' Android channel
      // manager treats an OMITTED sound key as "use the system default
      // sound" (Settings.System.DEFAULT_NOTIFICATION_URI), but treats ANY
      // string value, including the literal 'default', as a custom sound
      // FILENAME to resolve from the app's bundled assets — confirmed in
      // its own native source (NotificationChannelManagerModule.kt /
      // AndroidXNotificationsChannelManager.java: "the default is... the
      // default sound" only when the key is absent; a string always goes
      // through customSoundExists()/mSoundResolver.resolve()). Passing the
      // string 'default' was exactly what produced the persistent "Custom
      // sound 'default' not found in native app" warning — this fires on
      // every login (channel setup runs at push-registration time), which
      // is why it looked unrelated to any specific feature being tested.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    // getExpoPushTokenAsync requires this app to be linked to an EAS
    // project (`eas init`) — app.json has no extra.eas.projectId configured
    // yet, so this currently no-ops with a clear warning rather than
    // throwing until that one-time setup happens.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      devWarn('[push] No EAS projectId configured (app.json extra.eas.projectId) — run `eas init` first.');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    // Tokens can change (reinstall, restore on a new device) — this always
    // overwrites with whatever the current device reports, matching a
    // one-account-one-phone model rather than tracking multiple devices.
    const { error } = await supabase
      .from('user_profiles')
      .update({ expo_push_token: token })
      .eq('email', email);

    if (error) {
      devWarn('[push] Failed to store push token:', error.message);
    }
  } catch (err) {
    devWarn('[push] Registration failed, continuing without push notifications:', err instanceof Error ? err.message : String(err));
  }
}
