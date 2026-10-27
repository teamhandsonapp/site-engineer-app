# Tracking Reliability — Device Test Plan

Status: **not yet run.** These tests need physical phones; results below are blank until a test session happens. The "Expected" column is a prediction from reading the code (see `LOCATION_TRACKING_AUDIT.md`), not a result.

## Before you start

1. **Install a build that contains everything.** The Android preview build `c2198fe1` (queued 2026-09-27) has tracking re-enabled but **not** the gap segments (they were written after it started). Build a new one (`npx eas-cli build --platform android --profile preview`) and install it on all three phones.
2. **Log in with the two debug accounts** where possible — `Kabilan` and `Prashuramu` are in `TEMPORARY_24H_TRACKING_USER_IDS`, so they're tracked 24h (no shift-window surprises) and the watchdog logs every check/restart to `tracking_debug_events`. Use a third site-engineer account for the third phone; it only tracks inside its shift window (09:00–20:00 unless the project sets its own).
3. On each phone: grant location **"Allow all the time"**, allow notifications, and **check in** on the Attendance screen.
4. Note the start time. At any point, run from `site-engineer-app/`:
   ```
   npm run tracking-report -- --since "2026-09-28 10:00"
   ```
   It prints, per account: device + build, every gap > 8 min, its duration, and what recovered it (watchdog restart / app reopened / resumed on its own), plus whether the server flagged it. Send me the output and I'll fill in the table.

| Phone | Model | Brand checklist |
|---|---|---|
| Oppo | CPH2721 | **Mandatory, no skip** (key `oppo`) |
| Redmi 13C 5G | — | **Mandatory, no skip** (key `xiaomi`) |
| CMF Phone 2 Pro | A001 | None (generic "Battery → Unrestricted" tip only) |

## Scenarios

| # | Scenario | How to run it | Expected (from code) | Pass if |
|---|---|---|---|---|
| 1 | Baseline | Check in, lock the phone, wait 30 min | "PMC Portal · Site tracking active." notification stays; a ping every ~5 min | ≥ 5 pings in 30 min, notification visible |
| 2 | Memory-pressure kill | Open 10+ heavy apps (camera, games, maps) and leave them 20 min; or `adb shell am kill com.pmcportal.mobile` | Pings **continue without the watchdog** — updates come via a Google Play services PendingIntent that wakes the app. Watchdog (15 min) is the backup | Gap < 15 min, no `watchdog_restart` needed |
| 3 | OEM idle kill, checklist NOT done | Oppo/Redmi: tap through the checklist **without changing settings**. CMF: leave battery on "Optimized". Lock the phone 2–3 h | Likely gaps or a full stop on Oppo/Redmi; the watchdog may not run either if the OEM also defers WorkManager | Record whatever happens — this is the baseline to beat |
| 4 | OEM idle kill, checklist done | Actually apply every checklist step (Autostart on, battery "No restrictions"/"Unrestricted"), repeat #3 | Noticeably fewer / shorter gaps than #3 | Gaps shorter and fewer than #3 on the same phone |
| 5 | Reboot mid-shift | While checked in, restart the phone; **don't open the app** afterwards; wait 20 min | Tracking resumes via expo-task-manager's boot receiver (`restoreTasks()`). Needs "Allow all the time" on Android 14+ | Pings resume within ~5–15 min of boot without opening the app |
| 6 | Reopen after a silent kill | After a gap from #3, open the app | Hook re-checks on open (AppState `active`) and restarts the ping task within seconds | New ping within 1–2 min of opening |
| 7 | Force stop | Settings → Apps → PMC Portal → **Force stop**; wait 30 min; then open the app | **Stays dead** (Android blocks everything for a force-stopped app — expected, not a bug). After ~15 min the server records a `no_heartbeat` episode. Admin trail shows a **dashed red "Tracking gap: …"** segment once pings resume | No pings until reopened; gap appears on the admin trail map |
| 8 | Geofence exit | Walk out past the site radius and stay out 5 min; then walk back | Exit confirmed ~3 min after crossing the **outer** ring (radius × 1.15); no alert for brief edge crossings; return logged after entering the **inner** ring (radius × 0.85) | One exit alert, within ~3–5 min; zero false alerts while standing near the edge |

## Results

Fill from `npm run tracking-report` output (or send it to Claude).

| Device | Scenario | Recovered? | Time to recover | Notes |
|---|---|---|---|---|
| Oppo CPH2721 | 1 Baseline | | | |
| Oppo CPH2721 | 2 Memory kill | | | |
| Oppo CPH2721 | 3 OEM kill, no checklist | | | |
| Oppo CPH2721 | 4 OEM kill, checklist | | | |
| Oppo CPH2721 | 5 Reboot | | | |
| Oppo CPH2721 | 6 Reopen | | | |
| Oppo CPH2721 | 7 Force stop | | | |
| Oppo CPH2721 | 8 Geofence | | | |
| Redmi 13C 5G | 1 Baseline | | | |
| Redmi 13C 5G | 2 Memory kill | | | |
| Redmi 13C 5G | 3 OEM kill, no checklist | | | |
| Redmi 13C 5G | 4 OEM kill, checklist | | | |
| Redmi 13C 5G | 5 Reboot | | | |
| Redmi 13C 5G | 6 Reopen | | | |
| Redmi 13C 5G | 7 Force stop | | | |
| Redmi 13C 5G | 8 Geofence | | | |
| CMF Phone 2 Pro | 1 Baseline | | | |
| CMF Phone 2 Pro | 2 Memory kill | | | |
| CMF Phone 2 Pro | 3 OEM kill, no checklist | | | |
| CMF Phone 2 Pro | 4 OEM kill, checklist | | | |
| CMF Phone 2 Pro | 5 Reboot | | | |
| CMF Phone 2 Pro | 6 Reopen | | | |
| CMF Phone 2 Pro | 7 Force stop | | | |
| CMF Phone 2 Pro | 8 Geofence | | | |

## iOS (first-ever iOS location test)

Not ready: iOS has only ever had production/TestFlight builds, and none of them include the new location config. A new iOS production build → TestFlight is needed first (the `preview` profile needs ad-hoc device registration, which isn't set up). iOS differs: no foreground-service notification (a blue location indicator instead), "Force stop" doesn't exist (swiping the app away stops background location updates until reopened — iOS rule), and reboot recovery depends on significant-location-change, which this app doesn't use.
