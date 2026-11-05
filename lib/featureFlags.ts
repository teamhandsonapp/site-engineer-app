// Location tracking was removed from the app in v34 (Google Play closed
// testing without location permissions). Historical location data — red-zone
// entries, boundary exits, location-off episodes, GPS lockouts, day trails —
// is still in the database, but every screen hides it while this is false.
// Flip to true when the location feature is rebuilt.
export const LOCATION_FEATURES_ENABLED = false;

// Site Groups (WhatsApp groups inside the app). Backend runs in mock mode;
// the UI is for local development only until it's approved for release.
// __DEV__ is false in every EAS preview/production build (they ship a
// bundled release JS), so this can never be on in a store build. EAS
// development builds load JS from a local Metro server, i.e. local dev.
export const WHATSAPP_ENABLED = __DEV__;
