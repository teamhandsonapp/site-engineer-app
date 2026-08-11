import AsyncStorage from '@react-native-async-storage/async-storage';

function storageKey(userId: string): string {
  return `lastViewedAlerts:${userId}`;
}

// Call once per screen mount (not on every render, and not just on app
// launch) — reads whatever timestamp was stored from the PREVIOUS viewing
// session, then immediately overwrites storage with "now" so the next
// visit's baseline is this one. The caller keeps the returned value fixed
// for the rest of that mount's lifetime: that's what makes an alert that
// arrives live while the screen is already open still count as "new" (it
// arrived after the fixed baseline) rather than the baseline chasing "now"
// on every render and never showing anything as new.
export async function consumeLastViewedAlerts(userId: string): Promise<string | null> {
  const key = storageKey(userId);
  const previous = await AsyncStorage.getItem(key);
  await AsyncStorage.setItem(key, new Date().toISOString());
  return previous;
}

// First-ever view for this user has no baseline to compare against —
// treated as "nothing is new" rather than flagging every single existing
// alert, which would make the indicator meaningless on a first run.
export function isAfterViewedThreshold(isoTimestamp: string, viewedThreshold: string | null): boolean {
  if (viewedThreshold === null) return false;
  return new Date(isoTimestamp).getTime() > new Date(viewedThreshold).getTime();
}
