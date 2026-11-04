import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import { devWarn } from './devLog';

// Action-logging + error capture ONLY — deliberately no Session Replay.
// The wizard would normally add Sentry.mobileReplayIntegration() to
// `integrations` and set replaysSessionSampleRate/replaysOnErrorSampleRate
// in this same init call; none of that is present here, and none should
// ever be added without a fresh, explicit decision to do so (it's a
// meaningfully different privacy posture — screen recording vs. text
// breadcrumbs — not a toggle to flip back on casually). `integrations` is
// left at the SDK's own default set (native crash handling, automatic
// breadcrumbs for touches/console/etc.) rather than passed explicitly,
// since passing an empty array would actually DISABLE those defaults too.
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    devWarn('[sentry] EXPO_PUBLIC_SENTRY_DSN not set — Sentry will not report anything.');
    return;
  }
  // Web dev: the browser's requests to Sentry's ingest endpoint are often
  // blocked (ad blockers, CORS/COEP on localhost), and with debug on the SDK
  // surfaces each failed send as a console error in the Expo overlay.
  if (__DEV__ && Platform.OS === 'web') return;

  Sentry.init({
    dsn,
    // No tracesSampleRate — performance tracing wasn't asked for, and
    // omitting it keeps this to breadcrumbs + error events only, matching
    // the "lightweight, no extra data collection" brief exactly.
    debug: __DEV__,
    // Never send PII beyond what this app explicitly attaches itself
    // (breadcrumb data, tags) — no automatic device/user PII scraping.
    sendDefaultPii: false,
  });
}
