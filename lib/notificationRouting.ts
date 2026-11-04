import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants, { AppOwnership } from 'expo-constants';
import { router } from 'expo-router';
import { devWarn } from './devLog';

// expo-notifications has no real implementation on web — several of its
// APIs (getLastNotificationResponseAsync in particular) throw outright
// rather than no-op there. Web is a genuine preview target for this app
// (there's no iOS/Android simulator available in this environment, so
// `expo start --web` is how this app actually gets visually checked), so
// this can't just be left to crash — everything below is native-only by
// design, not an oversight.
const isWeb = Platform.OS === 'web';

// expo-notifications' own module throws at IMPORT time inside Expo Go
// (hard SDK 53+ limitation — see pushNotifications.ts's identical guard for
// the full explanation). This file is mounted at the app's root layout, so
// a static `import * as Notifications from 'expo-notifications'` here would
// crash Expo Go on launch regardless of whether any of its exports are
// actually called. Skipping the require entirely in Expo Go — not just the
// usage — is what actually prevents that; a real development build or the
// shipped APK never takes this branch and behaves exactly as before.
const isExpoGo = Constants.appOwnership === AppOwnership.Expo;
// Must be a runtime require, not a static import: a static import of
// expo-notifications crashes Expo Go on launch (see comment above).
const Notifications = !isWeb && !isExpoGo
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-notifications') as typeof import('expo-notifications'))
  : null;

// Foreground and background/killed behave differently in Expo by default:
// a backgrounded or killed app already shows the OS notification banner
// with sound automatically (no code needed), but a FOREGROUNDED app shows
// nothing at all unless a handler explicitly opts back in — this is what
// makes the sound+banner actually play while the app is open too.
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Extracted so both the direct import time value and the hook path work
// identically — expects EITHER the shape the send-push-notification Edge
// Function (via the Postgres trigger, see supabase/push-notifications.sql)
// attaches as `data: { itemId, taskName }`, OR Addition A's own local
// degraded-tracking notification's `data: { kind: 'tracking-degraded',
// reason }` (see trackingStatus.ts's own fireDegradedNotification) — the
// latter doesn't navigate anywhere in-app at all, it opens the relevant
// OS Settings screen directly, same action as the in-app banner's own
// button.
function navigateToNotificationTarget(data: Record<string, unknown> | undefined) {
  const itemId = typeof data?.itemId === 'string' ? data.itemId : undefined;
  // Client alerts live inline on Home (there's no separate per-item screen
  // in this app) — passing highlightItemId lets ClientHome scroll to and
  // highlight the specific card instead of just landing on a generic list.
  router.push(
    itemId
      ? { pathname: '/(authenticated)/home', params: { highlightItemId: itemId } }
      : '/(authenticated)/home'
  );
}

// Mounted once at the app root (see app/_layout.tsx) — handles a
// notification tapped while the app was backgrounded/foregrounded
// (addNotificationResponseReceivedListener) AND the case where the app was
// launched fresh by tapping a notification from a killed state
// (getLastNotificationResponseAsync, checked once on mount).
// Taps are only acted on once the app can really navigate: the root
// navigator is mounted AND the user is signed in. Before that (a tap that
// cold-starts the app, or a tap while logged out), the tap is held and
// applied as soon as both are true — previously it was pushed before the
// navigator existed and silently dropped.
export function useNotificationTapRouting(ready: boolean) {
  const pending = useRef<Record<string, unknown> | null>(null);
  const handledIds = useRef(new Set<string>());
  const readyRef = useRef(ready);

  useEffect(() => {
    if (!Notifications) return;

    function handle(response: import('expo-notifications').NotificationResponse) {
      const id = response.notification.request.identifier;
      if (handledIds.current.has(id)) return;
      handledIds.current.add(id);
      const data = response.notification.request.content.data;
      if (readyRef.current) navigateToNotificationTarget(data);
      else pending.current = data ?? {};
    }

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handle(response);
      })
      .catch((err) => devWarn('[notifications] getLastNotificationResponseAsync failed:', err));

    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    readyRef.current = ready;
    if (!ready || !pending.current) return;
    const data = pending.current;
    pending.current = null;
    try {
      navigateToNotificationTarget(data);
    } catch (err) {
      devWarn('[notifications] navigation after tap failed:', err);
    }
  }, [ready]);
}
