import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The ONE place "how far to sit above the device's own bottom safe area"
// is computed. Audited (2026-08-14) against every screen-edge absolute/
// fixed-footer element in the app (drawer Logout, canvas zoom controls,
// RelationshipToolbar's "Link type" bar, Toast/bottom-sheet/modal footers)
// — every one of them already calls this hook, so a missing-hook gap was
// ruled out as the cause of the clipping being reported again on a real
// device (Redmi 13C 5G) after this hook already shipped.
//
// The actual mechanism: this Expo version's Android template
// (@expo/prebuild-config's edge-to-edge plugin) makes edge-to-edge
// MANDATORY with no opt-out ("Android 16 makes edge-to-edge mandatory" —
// the `edgeToEdgeEnabled` app.json key has been removed entirely). That
// means app content always draws behind the system gesture-nav bar on
// Android now, full stop — insets.bottom is the ONLY thing standing
// between real content and that dead zone, and OEM skins (MIUI/HyperOS,
// ColorOS) are a known category of under-reporting or slow-to-settle
// WindowInsets, especially right after Android 15's edge-to-edge mandate.
// A bare 12px floor is razor-thin against that: it only helped the case
// where insets.bottom is exactly 0 (old 3-button nav), not the case where
// it's non-zero but still tight on a specific OEM gesture bar.
//
// Two independent safety nets now, not one:
//   - GESTURE_SAFETY_MARGIN is added ON TOP of whatever insets.bottom
//     actually reports (even when it's non-zero), covering an
//     under-reported real gesture-bar height.
//   - MIN_FLOOR is the absolute minimum regardless (covers insets.bottom
//     reporting exactly 0, e.g. 3-button nav or web).
// `extra` still layers on top of both for a control's own additional
// clearance need (e.g. a sibling toolbar's measured height).
//
// NOTE: this could not be verified against a real device from this
// machine (no simulator, no adb/device connection available here) — the
// margins below are a deliberately generous, defensive increase given
// that constraint, not a number confirmed against the actual Redmi 13C 5G
// gesture bar. Needs real-device re-confirmation.
const GESTURE_SAFETY_MARGIN = 16;
const MIN_FLOOR = 24;

export function useSafeBottomOffset(extra = 0): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom + GESTURE_SAFETY_MARGIN, MIN_FLOOR) + extra;
}
