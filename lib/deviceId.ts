import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'device-lock-id';

// A self-generated UUID, not a platform "hardware id" — neither
// expo-application's Android ID nor its iOS identifierForVendor actually
// satisfy "resets on a fresh install" (verified, not assumed, before
// choosing this): Android ID survives until a factory reset regardless of
// any single app's install state, and identifierForVendor is scoped per
// VENDOR, not per app, so it survives this app's own reinstall as long as
// any other app from the same developer is still on the device.
//
// The storage backend is deliberately PLATFORM-SPECIFIC, and picking the
// same one for both platforms would be wrong in opposite directions —
// confirmed via Expo's own GitHub issue tracker and Apple/Android platform
// docs, not assumed:
//   - iOS: SecureStore is backed by the Keychain, which is well-documented
//     to survive app deletion+reinstall by default (Apple has stated this
//     was never a supported guarantee either way, but it IS the actual
//     shipping behavior) — using it here would make a reinstall silently
//     keep the OLD device id, which is exactly the wrong result for this
//     feature. Plain AsyncStorage's backing store, by contrast, lives in
//     the app's own sandboxed container and IS wiped on iOS uninstall.
//   - Android: it's the other way around. AsyncStorage's SharedPreferences
//     backing is included in Android's Auto Backup by default
//     (android:allowBackup defaults to true in both plain Android and
//     Expo), which restores that data on a fresh install/reinstall unless
//     the whole app opts out of Auto Backup entirely — again the wrong
//     result. expo-secure-store, however, registers its own Auto Backup
//     exclusion rule for its storage, so it reliably resets on Android
//     reinstall.
// Neither storage choice is used for its "secure" property here — the
// device id isn't a secret, it's only ever compared for equality server-
// side — only for which one actually resets on reinstall per platform.
async function getStoredId(): Promise<string | null> {
  return Platform.OS === 'android' ? SecureStore.getItemAsync(KEY) : AsyncStorage.getItem(KEY);
}

async function setStoredId(id: string): Promise<void> {
  if (Platform.OS === 'android') {
    await SecureStore.setItemAsync(KEY, id);
  } else {
    await AsyncStorage.setItem(KEY, id);
  }
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getStoredId();
  if (existing) return existing;

  const fresh = Crypto.randomUUID();
  await setStoredId(fresh);
  return fresh;
}
