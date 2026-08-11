import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { devWarn } from '../devLog';
import { BATTERY_OPT_PROMPTED_KEY } from './storageKeys';

// Point 6 — stock Android's Doze mode can still throttle a correctly
// registered geofence on some devices unless the app is exempted from
// battery optimization. There's no expo-location equivalent of Android's
// `Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)`, so this
// uses expo-intent-launcher directly — Android-only, iOS has no matching
// concept at all (no Doze, no per-app battery allowlist).
export async function hasPromptedBatteryOptimization(): Promise<boolean> {
  return (await AsyncStorage.getItem(BATTERY_OPT_PROMPTED_KEY)) === 'true';
}

// Marked prompted regardless of whether the user actually grants the
// exemption or dismisses the system dialog — the spec's own requirement is
// "ask once, contextually," not "keep asking until granted" (this is a
// real OS-level choice, same non-nagging principle as background location
// permission in Part 1).
export async function markBatteryOptimizationPrompted(): Promise<void> {
  await AsyncStorage.setItem(BATTERY_OPT_PROMPTED_KEY, 'true');
}

// The `data: package:<applicationId>` URI is what makes this open the
// direct "exempt THIS app" dialog instead of the general battery-
// optimization app list — read from expo-constants' build-time config
// rather than adding expo-application as a second dependency just for one
// string this app already has at build time.
export async function requestIgnoreBatteryOptimizations(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const packageName = Constants.expoConfig?.android?.package;
  if (!packageName) return;

  try {
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, {
      data: `package:${packageName}`,
    });
  } catch (err) {
    // Some OEM/custom ROMs don't ship this settings screen at all — never
    // let a missing dialog block the rest of the app.
    devWarn('[locationTracking] battery optimization intent failed:', err);
  }
}
