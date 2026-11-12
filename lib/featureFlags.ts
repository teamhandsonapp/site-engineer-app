// Location tracking was removed from the app in v34 (Google Play closed
// testing without location permissions). Historical location data — red-zone
// entries, boundary exits, location-off episodes, GPS lockouts, day trails —
// is still in the database, but every screen hides it while this is false.
// Flip to true when the location feature is rebuilt.
export const LOCATION_FEATURES_ENABLED = false;
