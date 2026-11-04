import AsyncStorage from '@react-native-async-storage/async-storage';

// A single flag, not tied to any specific account — the opening screen is
// about "has this DEVICE seen the app before," same as any standard
// first-launch pattern, not a per-user preference synced anywhere.
const HAS_SEEN_OPENING_SCREEN_KEY = 'onboarding:has-seen-opening-screen';

export async function hasSeenOpeningScreen(): Promise<boolean> {
  return (await AsyncStorage.getItem(HAS_SEEN_OPENING_SCREEN_KEY)) === 'true';
}

export async function markOpeningScreenSeen(): Promise<void> {
  await AsyncStorage.setItem(HAS_SEEN_OPENING_SCREEN_KEY, 'true');
}
