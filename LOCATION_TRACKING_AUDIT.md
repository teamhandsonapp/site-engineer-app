# Location Tracking Audit — site-engineer-app

Audited: 2026-09-27, against the current working tree (Android build 28 / iOS build 17 were built from this code).
Scope: `site-engineer-app` only. Documentation only — nothing was changed.

Legend: ✅ Implemented · ⚠️ Partially implemented · ❌ Not implemented

---

## 0. Headline finding — read this first

**Location tracking is fully built in code but switched off in the shipped app.** Three independent things each disable it:

1. **The component that starts tracking is not mounted.** `components/FieldLocationGuard.tsx` is the *only* caller of `useFieldLocationTracking()` (`lib/locationTracking/useFieldLocationTracking.ts`), which is the only code path that registers any tracking task. `FieldLocationGuard` is referenced nowhere except a comment in `app/_layout.tsx:118`: *"Location permission gate + tracking (FieldLocationGuard) removed entirely, by explicit request — the app no longer asks for location or tracks anyone."*
2. **Android location permissions are blocked at build time.** `app.json` → `expo.android.blockedPermissions` strips `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION` and `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` from the manifest. Even if the code ran, Android would refuse location access and the battery-exemption prompt.
3. **iOS has no location configuration.** The `expo-location` config plugin is not in `app.json` → `plugins`, `ios.infoPlist` contains no `NSLocationWhenInUseUsageDescription` / `NSLocationAlwaysAndWhenInUseUsageDescription`, and there is no `UIBackgroundModes: ["location"]`.

**Live data confirms it:** the most recent row in `location_pings` is **2026-08-15 13:03 UTC**; zero pings in the last 7 days.

**Unexplained item:** `account_lockouts` has two `location_services_disabled` locks for the CMF phone (model `A001`) on **2026-09-23** and **2026-09-25**. No code path reachable in the current app calls `lock_own_account_for_gps` (the only callers are `gpsLockout.ts` via `trackingStatus.ts` / `locationGate.ts` / `locationPingTask.ts`, all reachable only through the unmounted `FieldLocationGuard`). I cannot determine from the code what produced those two locks — most likely an older installed build that still had tracking mounted, but that is **unverified**.

Everything below describes the code as written; unless stated otherwise, none of it executes in the current builds.

---

## 1. Current background location setup

### Task definitions (`TaskManager.defineTask`)
| Task name (constant) | Value | Defined in | Purpose |
|---|---|---|---|
| `LOCATION_PING_TASK` | `'field-location-ping-updates'` | `lib/locationTracking/locationPingTask.ts:67` | Continuous location updates → ping queue |
| `GEOFENCE_TASK` | `'field-location-geofence-events'` | `lib/locationTracking/geofence.ts:209` | OS geofence enter/exit events |
| `BACKGROUND_SNAPSHOT_TASK` | `'field-location-background-snapshot'` | `lib/locationTracking/backgroundSnapshotTask.ts:69` | Periodic catch-up / sync / re-evaluate (expo-background-task) |
| `TEST_TRACKING_TASK` | (see `testTrackingTask.ts`) | `lib/locationTracking/testTrackingTask.ts:49` | Debug-only tracking for `app/debug-test-tracking.tsx` |

All four `defineTask` calls run at module import. `locationPingTask.ts`, `geofence.ts` and `backgroundSnapshotTask.ts` are only imported through the `FieldLocationGuard` chain, so ⚠️ their tasks are not defined in the running app. `testTrackingTask.ts` is imported by the route file `app/debug-test-tracking.tsx`; whether Expo Router evaluates that module before the route is opened is **not verified**.

### `startLocationUpdatesAsync` — ✅ implemented (in code)
`registerLocationPingTask()` — `lib/locationTracking/locationPingTask.ts:164`:
```ts
Location.startLocationUpdatesAsync(LOCATION_PING_TASK, {
  accuracy: Location.Accuracy.Balanced,
  timeInterval: LOCATION_PING_INTERVAL_MINUTES * 60_000,   // 5 min (constants.ts:136)
  distanceInterval: 0,
  foregroundService: {
    notificationTitle: testPhase ? 'PMC Portal - Test Mode' : 'PMC Portal',
    notificationColor: testPhase ? '#DC2626' : '#0F1F33',
    notificationBody:  testPhase ? 'Location testing active.' : 'Site tracking active.',
    killServiceOnDestroy: false,
  },
});
```
- `testPhase` = `isTestModeActive()` (§5), which is currently `false`, so the non-test strings apply.
- Guarded by `isLocationPingTaskRegistered()` (`Location.hasStartedLocationUpdatesAsync`) so it never double-registers.
- Called from `evaluateLocationPingTask(shiftOn)` (`evaluateTracking.ts:105`) only when `shiftOn` is true **and** `hasBackgroundLocationPermission()` is true, and from `runDebugWatchdog()` (`debugWatchdog.ts:117`).

### Is `foregroundService` actually configured?
✅ **Yes, in code** — the `foregroundService` block above is passed on every start. ⚠️ **But it cannot take effect today**: `FOREGROUND_SERVICE_LOCATION` is in `blockedPermissions` (Android 14+ requires it for a location foreground service) and the task is never started (§0). Regarding the earlier Prashuramu "1 point in 5 hours" issue: the code-level fix (foreground service + `killServiceOnDestroy: false`) is present, but it has never run on any build that shipped with tracking unmounted, so it is **not verified in production**.

### Per-ping handling inside the task (`locationPingTask.ts:67–135`)
1. `getCurrentFieldSession()` — exits if signed out / not a field role.
2. `isWithinScheduledShiftWindow(projectId, userId)` (`shiftWindow.ts:33`) — exits outside the shift window. `TEMPORARY_24H_TRACKING_USER_IDS` (`constants.ts:34`: Kabilan `37b0a4d4-…`, Prashuramu `bcb3b273-…`) bypass the window (24h tracking).
3. Uses the **last** location in the batch; records `recordSuccessfulFix()` + `touchTrackingHeartbeat()`.
4. Discards fixes with accuracy > `PING_MAX_ACCEPTABLE_ACCURACY_METERS` = **50 m** (`constants.ts:150`).
5. `enqueuePing(...)` (§6), then `syncPendingPings()`, `checkTrackingStatusNow()` → `reportTrackingStatusIfChanged()`, `syncPendingTrackingStatusEvents()`, `checkDeadZoneAndReport()` (dead-zone lock after `DEAD_ZONE_TIMEOUT_MINUTES` = 30, `constants.ts:177`).

### `stopLocationUpdatesAsync` — when tracking stops
| Call site | Trigger |
|---|---|
| `unregisterLocationPingTask()` — `locationPingTask.ts:209` | Called by the two rows below |
| `evaluateLocationPingTask(false)` — `evaluateTracking.ts:107` | Shift window ends / not checked in (evaluated on a 60 s tick, AppState resume and in the background task) |
| `useFieldLocationTracking` cleanup — `useFieldLocationTracking.ts:108` | Hook's `active` flag goes false (signed out, not a field role, or component unmounts) |
| `testTrackingTask.ts:96, 118` | Debug screen only |

- **Checkout:** ⚠️ indirect only. `attendance.tsx:23` calls `writeShiftState()`; the stop happens the next time `evaluateLocationPingTask` re-reads shift state (≤ 60 s while the app is open, or the next background-task run).
- **Logout:** ⚠️ `signOut()` in `lib/AuthContext.tsx` does **not** call any tracking API. Tracking stops only because `useFieldLocationTracking`'s `active` becomes false when auth state changes; if the app is killed before that effect runs, nothing stops the task.

---

## 2. Battery optimization exemption

⚠️ **Implemented in code, blocked in the build, and not reachable.**
- `requestIgnoreBatteryOptimizations()` — `lib/locationTracking/batteryOptimization.ts`: fires `IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` with `data: package:com.pmcportal.mobile` (Android only). A one-time "already prompted" flag is stored under `BATTERY_OPT_PROMPTED_KEY` (`hasPromptedBatteryOptimization` / `markBatteryOptimizationPrompted`).
- Callers: `components/FieldLocationGuard.tsx:83`, `components/BatteryOptimizationPrompt.tsx:28` (only rendered inside `FieldLocationGuard`), `debugWatchdog.ts:122`.
- **Blocker:** `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is in `app.json` `blockedPermissions`. That intent requires the permission to be declared, so it cannot work in the current build even if called.

---

## 3. OEM-specific handling

✅ **Implemented in code** (⚠️ not reachable — only rendered via `FieldLocationGuard`).
- Detection: `getDeviceManufacturer()` = `Device.manufacturer` — `lib/locationTracking/deviceInfo.ts:8`; `getDeviceModel()` at `:12`.
- `KNOWN_PROBLEM_MANUFACTURERS` = `['xiaomi','samsung','huawei','oneplus','oppo','vivo','nothing','cmf']` — `deviceInfo.ts:20`; `isKnownProblemManufacturer()`.
- Per-brand tips: `MANUFACTURER_TIPS` + `getManufacturerTip()` — `deviceInfo.ts:27–74`. Nothing/CMF get a generic "Battery → Unrestricted" tip (the file notes Nothing OS has no documented per-OEM toggle set).
- Link: `DONT_KILL_MY_APP_URL` = `https://dontkillmyapp.com` — `deviceInfo.ts:80`.
- Mandatory step-by-step checklist: `lib/locationTracking/manufacturerChecklist.ts` — checklists keyed **oppo, realme, xiaomi, vivo, huawei, oneplus, samsung** (`key:` at lines 41–118), with aliases redmi/poco → xiaomi and honor → huawei (`MANUFACTURER_TO_CHECKLIST_KEY`, line 155); `getMandatoryChecklist()`, `hasCompletedManufacturerChecklist()`, `markManufacturerChecklistComplete()`. Explicitly **excludes nothing/cmf** (comment at `:145`). UI: `components/ManufacturerChecklistGate.tsx`.
- Note: the CMF Phone 2 Pro reports `Device.modelName` = `A001` (confirmed live in `user_devices`); its `Device.manufacturer` string was not captured in this audit.

---

## 4. Geofencing

✅ **Implemented in code — circular, not polygon** (⚠️ not reachable).
- Registration: `registerGeofence(boundary, zones)` — `lib/locationTracking/geofence.ts:433` → `Location.startGeofencingAsync(GEOFENCE_TASK, regions)` at `:501`. Max `MAX_GEOFENCE_REGIONS` = 100 (`constants.ts:113`).
- **Site boundary:** one circle from `projects.site_latitude / site_longitude / site_radius_meters` (via `fetchProjectSettings`, `lib/projectSettings.ts:55`; wired in `evaluateGeofence`, `evaluateTracking.ts:42`).
- **Hysteresis:** each circle is registered as two rings — inner `radius × HYSTERESIS_INNER_FACTOR (0.85)` and outer `radius × HYSTERESIS_OUTER_FACTOR (1.15)` (`constants.ts:105–106`, `geofence.ts:445/453`). Exit = leaving the outer ring; re-enter = entering the inner ring.
- **Restricted (red) zones:** also circles, from `restricted_zones` (`id, name, latitude, longitude, radius_meters, severity`) — `lib/locationTracking/restrictedZones.ts:41`, same two-ring scheme (`geofence.ts:484/492`).
- **Separate "100 m radius" check:** ❌ none. The only circular checks are the site boundary (radius from project settings) and restricted zones. There is no polygon geometry anywhere.
- **Detection & debounce** (task handler `geofence.ts:209`):
  - Boundary exit → `handleExit()` writes a pending exit (AsyncStorage); `confirmPendingExitIfDue()` (`:298`) confirms after `GEOFENCE_CONFIRMATION_MINUTES` = 3, captures a fresh position, enqueues a `create/boundary` event. Re-entering before confirmation cancels it; after confirmation, re-entry enqueues `mark-return`.
  - Zone entry → `handleZoneEnter()`; confirmed by `confirmPendingZoneEntriesIfDue()` (`:334`) after `ZONE_CONFIRMATION_SECONDS` per severity (`constants.ts:92`). Leaving before confirmation cancels.
- **Where events are written** (via `lib/locationTracking/zoneEventQueue.ts` → `syncPendingZoneEvents()`):
  - Boundary exits/returns → **`geofence_alerts`** (`geofenceAlerts.ts`: `insertConfirmedGeofenceAlert`, `markGeofenceAlertReturned`)
  - Zone entries/exits → **`restricted_zone_alerts`** (`restrictedZones.ts`: `insertConfirmedRestrictedZoneAlert`, `markRestrictedZoneAlertExited`)

---

## 5. Test-mode / debug tracking

✅ **Exists** — `lib/locationTracking/testModeConfig.ts:31`: `export const TEST_MODE_ALWAYS_TRACK = true;`
⚠️ **But it is currently inactive**: `isTestModeActive()` returns `TEST_MODE_ALWAYS_TRACK && now < TEST_MODE_SAFETY_NET_END_DATE`, with the end date hard-coded to **2026-08-18 00:00 IST** (`testModeConfig.ts`). Today is after that, so it returns `false`.

What it would affect when active:
- Foreground-service notification text/colour (§1).
- `logTestPhasePoint()` inserts into `test_location_logs` (`locationPingTask.ts`).
- Widens the debug watchdog to every site engineer (`debugWatchdog.ts:51`).
- `shiftWindow.ts:35` reads it ahead of the per-user check.

Related debug tooling:
- `app/debug-test-tracking.tsx` + `testTrackingTask.ts` — separate debug-only tracking task.
- `DEBUG_WATCHDOG_ENABLED_USER_IDS` = `TEMPORARY_24H_TRACKING_USER_IDS` (Kabilan, Prashuramu) — `debugWatchdog.ts:40`.

---

## 6. Offline queue (location pings)

✅ **Implemented** (⚠️ nothing currently enqueues into it).
- File: `lib/locationTracking/locationPings.ts`. Storage: AsyncStorage JSON array under `LOCATION_PING_QUEUE_KEY` (`storageKeys.ts`).
- Enqueue: `enqueuePing()` pushes `{ localId, userId, projectId, latitude, longitude, accuracyMeters, occurredAt, synced: false, syncedAt: null }`.
- Sync: `syncPendingPings()` — single-flight guard (`syncInFlight`, concurrent callers share one run); batches of `MAX_BATCH_SIZE` = 200 unsynced items; `supabase.from('location_pings').upsert(...)`.
- **Dedupe:** server-side by `{ onConflict: 'user_id,occurred_at', ignoreDuplicates: true }` — a re-sent ping with the same user + timestamp is ignored. Local items are marked `synced` by `localId` after a successful upsert.
- **Retry / backoff:** `lib/locationTracking/syncBackoff.ts` — `shouldAttemptSync()` skips when `NetInfo` reports offline or during backoff; `recordSyncFailure()` uses exponential backoff from 30 s (`BASE_BACKOFF_MS`) to a 30 min cap (`MAX_BACKOFF_MS`); `recordSyncSuccess()` resets it. Backoff state is per queue key (`'location-pings'`).
- **Retention:** synced items pruned after `LOCATION_PING_RETENTION_DAYS` = 7 (`pruneOldSyncedItems`).
- **Sync triggers:** the ping task itself (each ping) and `BACKGROUND_SNAPSHOT_TASK`.
- Same pattern exists for geofence/zone events (`zoneEventQueue.ts`, key `ZONE_EVENT_QUEUE_KEY`) and tracking-status events (`trackingStatusQueue.ts`).

---

## 7. What's currently missing

| Item | Status | Detail |
|---|---|---|
| **START_STICKY / sticky restart** | ❌ Not configurable in this repo | There is no `android/` folder and no custom config plugin; the only lever used is `killServiceOnDestroy: false`. How expo-location's own internal service handles restarts (its `onStartCommand` return value) was **not verified** in this audit. |
| **WorkManager-style watchdog** | ⚠️ Present in code, not registered | `BACKGROUND_SNAPSHOT_TASK` uses `expo-background-task` (Android: WorkManager; iOS: BGTaskScheduler) with `minimumInterval: 15` min (`BACKGROUND_TASK_MIN_INTERVAL_MINUTES`). Each run calls `evaluateLocationPingTask(withinWindow)`, which **re-starts the ping task if it's dead** — for every field user — plus `runDebugWatchdog()` (logs `watchdog_check` / `watchdog_restart`, restricted to test mode or the 2 debug user IDs). Registration happens only in `useFieldLocationTracking.ts:117` → not running today. |
| **Boot receiver** | ❌ Not implemented | No `RECEIVE_BOOT_COMPLETED` handling or boot receiver anywhere. (WorkManager work persists across reboot by design, so a *registered* background task would resume after boot — but the location foreground service itself would not restart until that task's next run.) |
| **Reattach-on-reopen ("should be tracking but isn't")** | ⚠️ Present in code, not mounted | `useFieldLocationTracking.ts:189–194, 217+`: on a 60 s tick and every AppState `active`, calls `evaluateGeofence()` + `evaluateLocationPingTask()` (restarts the ping task if missing) + `runDebugWatchdog()`. Silent restart, no UI — but only if the hook is mounted. |
| **Gap detection / visualization for admin** | ⚠️ Partial | (a) **Health pill** green/red/grey via `computeTrackingHealth()` — `lib/trackingHealth.ts:69`, stale after `TRACKING_STALE_AFTER_MINUTES` = 15 — shown on `app/(authenticated)/engineer-attendance.tsx` and `app/team-attendance-detail/[userId].tsx`. (b) **Silence episodes** — the server job `tracking-silence-watcher` (confirmed active in the database: `*/5 * * * *`) records `no_heartbeat` episodes, shown on `team-attendance-detail/[userId].tsx` as *"Stopped reporting — phone likely killed the app"* with a "Still silent" state. ❌ There is **no "tracking gap: 45 min" segment on the trail map** itself (`components/DayTrailMap.tsx` / `app/(authenticated)/day-timeline.tsx` draw the points with no gap markers). |

---

## 8. Relevant dependencies (`package.json`)

| Package | Version |
|---|---|
| `expo-location` | `~57.0.7` |
| `expo-task-manager` | `~57.0.7` |
| `expo-device` | `~57.0.1` |
| `expo-background-task` | `~57.0.7` (WorkManager-backed on Android) |
| `expo-battery` | `~57.0.2` |
| `expo-intent-launcher` | `~57.0.1` |
| `@react-native-community/netinfo` | `12.0.1` |
| Dedicated WorkManager / background-geolocation package | ❌ None (`react-native-background-fetch`, `react-native-background-geolocation`, etc. are not installed) |

---

## Summary for deciding next steps

- The tracking engine (foreground service, 5-min pings, circular geofences with hysteresis, offline queues with backoff, WorkManager re-check every 15 min, OEM guidance) **already exists** in `lib/locationTracking/`.
- To turn it back on you need all of: remount `FieldLocationGuard` (or call `useFieldLocationTracking`) in `app/_layout.tsx`; remove the 5 entries from `android.blockedPermissions`; add the `expo-location` config plugin (iOS permission strings + background mode + Android foreground-service permission); then a new build.
- Genuinely missing even after re-enabling: boot receiver, explicit sticky-restart control, gap segments on the admin trail map, and an updated `TEST_MODE_SAFETY_NET_END_DATE` if test mode is wanted again.
- Open question: the origin of the 2026-09-23 / 2026-09-25 `location_services_disabled` locks on the CMF phone.

---

## Follow-up findings (2026-09-27, after re-enabling)

- **Boot receiver — not needed, already present.** `expo-task-manager` ships `expo.modules.taskManager.TaskBroadcastReceiver` listening for `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED`; on receipt it constructs `TaskService`, whose constructor calls `restoreTasks()` and re-registers every persisted task (location updates, geofencing, background task) through its consumer. `RECEIVE_BOOT_COMPLETED` is declared by `expo-notifications` and merged in — confirmed present, together with the receiver, in the shipped build 28 manifest. After a reboot the location task comes back even outside a shift; the JS ping handler exits outside the shift window and `evaluateLocationPingTask` stops it on its next run.
- **Sticky restart — no custom native code needed.** `LocationTaskService.onStartCommand` returns `START_REDELIVER_INTENT`; `onTaskRemoved` only stops the service when `killServiceOnDestroy` is true (we pass false). Location updates are requested with a `PendingIntent` (`LocationTaskConsumer.startLocationUpdates` → `requestLocationUpdates(request, pendingIntent)`), so Google Play services keeps delivering fixes and wakes the app even after its process is killed. Not covered: a user "Force stop" (Android cancels the app's alarms/intents until it's opened again) and OEM task killers — that's what the battery-exemption + manufacturer checklist are for.
- **Gap segments — built.** `lib/trackingGaps.ts` (`computeTrackingGaps`, `splitTrailIntoRuns`, `gapLabel`); wired into `fetchDayTimeline` (`lib/dayTimeline.ts`, new `gaps` field, `no_heartbeat` episodes from `location_disabled_alerts` as the authoritative source + ping gaps > 15 min not covered by an episode), rendered as dashed red tappable segments in `components/DayTrailMap.tsx` and as rows in `components/DayTimelineView.tsx`.
