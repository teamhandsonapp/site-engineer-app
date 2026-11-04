import * as Device from 'expo-device';
import Constants, { AppOwnership } from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { devWarn } from './devLog';
import { logAction, logError } from './sentryLog';
import { ALARM_SOUNDS } from './alarmSounds';

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
// early: this feature is additive, so the rest of the app must work
// identically whether or not it succeeds.
//
// Audit fix — every branch below used to report ONLY via devWarn (a local
// console line, invisible in a production build and never reaching
// Sentry). That made this a genuinely silent failure end-to-end: a live
// query found ZERO of the app's real user_profiles had ever had
// expo_push_token set, and there was no breadcrumb/issue anywhere to
// explain why. Every branch now also calls logAction (expected, benign
// outcomes — Expo Go, no physical device, permission denied) or logError
// (a real failure worth investigating — DB write failure, an unexpected
// thrown error, or the EAS-projectId branch, which is currently believed
// fixed in app.json but would silently regress again without this).
export async function registerForPushNotificationsAsync(email: string): Promise<void> {
  if (isExpoGo()) {
    devWarn('[push] Skipping — Expo Go does not support push notifications since SDK 53; use a development build.');
    logAction('push', 'Registration skipped — running inside Expo Go', { email });
    return;
  }

  if (!Device.isDevice) {
    devWarn('[push] Skipping — push tokens require a physical device, not a simulator/emulator.');
    logAction('push', 'Registration skipped — not a physical device', { email });
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
      logAction('push', 'Registration skipped — permission not granted', { email, finalStatus });
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
      // Android freezes a channel's sound the first time it's created, and
      // app updates never change it — builds before that fix created
      // 'default' with the broken 'default' sound string, so on those phones
      // 'default' stays silent forever. Fresh channel ids are the only way
      // to get sound back; every sender now targets one of these (see
      // send-zone-alert / send-push-notification / send-broadcast-push).
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Notifications',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
      await Notifications.setNotificationChannelAsync('critical-alerts', {
        name: 'Critical alerts',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'redzone_entry.wav',
        vibrationPattern: [0, 500, 250, 500, 250, 500],
        bypassDnd: true,
      });
      // Person-sent critical alerts (Settings → Send Critical Alert). A
      // separate channel from 'critical-alerts' because a channel's sound
      // can never change after creation, and redzone_entry.wav (0.6s) was
      // too short to register as an alarm.
      await Notifications.setNotificationChannelAsync('critical-alarm', {
        name: 'Critical alarm',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'critical_alarm.wav',
        vibrationPattern: [0, 800, 300, 800, 300, 800, 300, 800],
        bypassDnd: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
      // One channel per selectable critical-alert tone (lib/alarmSounds.ts).
      for (const alarm of ALARM_SOUNDS) {
        await Notifications.setNotificationChannelAsync(alarm.channelId, {
          name: `Critical alarm – ${alarm.label}`,
          importance: Notifications.AndroidImportance.MAX,
          sound: alarm.file,
          vibrationPattern: [0, 800, 300, 800, 300, 800, 300, 800],
          bypassDnd: true,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }
      await Notifications.setNotificationChannelAsync('boundary-alerts', {
        name: 'Site boundary alerts',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'boundary_exit.wav',
        vibrationPattern: [0, 400, 200, 400],
      });
    }

    // getExpoPushTokenAsync requires this app to be linked to an EAS
    // project (`eas init`). Audit fix — app.json's extra.eas.projectId IS
    // now configured (f2027d89-90fa-40e0-8c6d-2acb138861b6, confirmed live
    // via `eas project:info`); the comment here previously said otherwise
    // and was stale. This branch is believed unreachable today, but stays
    // as a real, loud guard (not silently trusting the config) in case that
    // ever regresses — hence logError, not logAction, if it does fire.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      devWarn('[push] No EAS projectId configured (app.json extra.eas.projectId) — run `eas init` first.');
      logError(new Error('Missing EAS projectId'), 'push_token_register_no_project_id', { email });
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
      logError(new Error(error.message), 'push_token_store_failed', { email });
    } else {
      logAction('push', 'Push token registered and stored', { email });
    }
  } catch (err) {
    devWarn('[push] Registration failed, continuing without push notifications:', err instanceof Error ? err.message : String(err));
    logError(err, 'push_token_register_failed', { email });
  }
}
