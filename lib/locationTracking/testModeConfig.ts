// ============================================================
// PRE-LAUNCH TEST MODE — the one toggle for the 3-day always-on tracking
// test (Oppo/Redmi/CMF background-reliability comparison). This is the
// ENTIRE control surface: flip TEST_MODE_ALWAYS_TRACK to false once the
// test window ends and every behavior gated on it (see call sites below)
// reverts automatically to normal shift-hours-only tracking — no other
// code changes needed, nothing else to "rip out."
//
// true  → every site engineer is tracked from the moment they log in,
//         24 hours/day, regardless of shift hours or check-in state, and
//         the foreground-service notification says "Test Mode."
// false → normal production behavior: tracking scoped to shift hours (+
//         the existing buffer in TRACKING_END_MINUTES), notification says
//         the normal "PMC Portal" copy.
//
// Call sites that read this (grep TEST_MODE_ALWAYS_TRACK to find all of
// them if auditing before/after flipping it):
//   - shiftWindow.ts        (isWithinScheduledShiftWindow — the actual
//                             tracking-registration gate)
//   - trackingHealth.ts     (the "Off shift" vs live UI badge, so it
//                             doesn't misreport during the test window)
//   - locationPingTask.ts   (foreground-service notification copy/color,
//                             and whether test_location_logs gets the
//                             extra per-point diagnostic row)
//   - FieldLocationGuard.tsx (proactive battery-optimization exemption
//                             request on every login, not just once-ever)
//   - debugWatchdog.ts      (extends watchdog coverage to every site
//                             engineer during the test window, not just
//                             the 2 accounts from the earlier, narrower
//                             debug pass)
export const TEST_MODE_ALWAYS_TRACK = true;

// Safety net, not the primary control — TEST_MODE_ALWAYS_TRACK above is
// the intended one-line toggle. This just means an accidentally-forgotten
// `true` doesn't silently stay on forever past the actual test window;
// update this alongside flipping the flag if the window shifts.
const TEST_MODE_SAFETY_NET_END_DATE = new Date('2026-08-18T00:00:00+05:30'); // 3 days from 2026-08-15, IST

export function isTestModeActive(now: Date = new Date()): boolean {
  return TEST_MODE_ALWAYS_TRACK && now.getTime() < TEST_MODE_SAFETY_NET_END_DATE.getTime();
}
