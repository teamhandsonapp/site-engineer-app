# Changelog

## 2026-07-09 — Initial scaffold: intro screen, login UI, Supabase auth

### What was scaffolded

- `npx create-expo-app` (blank-typescript template) into this folder, TypeScript, git initialized
  by the CLI itself.
- `expo-router` (file-based routing) wired as the app entry (`main: "expo-router/entry"`),
  `typedRoutes` experiment on, deep-link `scheme: "mobileportal"`.
- `nativewind` v4 + Tailwind v3 for styling, with a starter `brand.navy` / `brand.amber` color
  pair in `tailwind.config.js`.
- `@supabase/supabase-js` client in `lib/supabase.ts`, using `AsyncStorage` for session
  persistence, plus an `AppState` listener to pause/resume Supabase's auto token refresh when the
  app backgrounds/foregrounds (this is Supabase's documented React Native pattern, not something
  called out explicitly in the brief but needed for `autoRefreshToken` to behave correctly).
- Route structure exactly as specified: `app/_layout.tsx`, `app/index.tsx`, `app/login.tsx`,
  `app/(authenticated)/_layout.tsx`, `app/(authenticated)/home.tsx`, `lib/supabase.ts`, plus
  `lib/getUserRole.ts` (role-lookup helper, mirrors the web app's fallback logic) and
  `components/Logo.tsx`.

### Where current docs differed from the brief (verified against docs.expo.dev / nativewind.dev /
supabase.com, since this SDK/version is newer than training data)

- **Reanimated is a genuine hard requirement of Nativewind v4, not an optional extra.**
  Nativewind's own `package.json` only lists `tailwindcss` as a peer, but its actual CSS
  interop engine (`react-native-css-interop`, one level down) has a required
  (non-optional) peer on `react-native-reanimated >=3.6.2`, and its Babel preset
  unconditionally references `"react-native-worklets/plugin"` with no existence check. I first
  removed Reanimated (misreading the surface-level peer list as "not needed" after nothing in
  the app used an Animated API), which broke the Metro bundle
  (`Cannot find module 'react-native-worklets/plugin'`) — reinstalled both
  `react-native-reanimated` and its own required peer `react-native-worklets` to fix it, even
  though neither is used directly by our screens; Nativewind's styling engine needs them present
  to load at all.
- **`babel-preset-expo` needed an explicit top-level install.** It's a transitive dependency of
  `expo` and normally hoists to the root `node_modules` automatically, but repeated
  `--legacy-peer-deps` installs (needed because `expo-router`'s bundled Radix/web deps have peer
  conflicts with no `react-dom` installed) left it nested under `node_modules/expo/node_modules/`,
  which broke `babel.config.js`'s `require('babel-preset-expo')`. Fixed by adding it as an
  explicit devDependency pinned to the same version Expo uses (`~57.0.2`).
- **Expo's own "Using Supabase" guide (docs.expo.dev) now shows a different pattern** —
  `expo-sqlite/localStorage/install` as a `localStorage` polyfill, instead of
  `@react-native-async-storage/async-storage`. The brief explicitly asked for AsyncStorage, which
  is still Supabase's own documented React Native approach and is Expo-Go-compatible, so I kept
  AsyncStorage. Worth knowing this Expo doc page has drifted, in case you want to switch later.
- **Native splash screen config uses the `expo-splash-screen` config plugin** (not the legacy
  `app.json` `splash` key, which SDK 57 no longer reads the same way) — already wired in
  `app.json`. Important caveat found in Expo's own docs: **the native OS splash configured this
  way cannot be previewed in Expo Go or a dev build** — it only renders in a preview/production
  build. In Expo Go you'll only ever see the JS `app/index.tsx` intro screen, not the native splash
  underneath it. Everything else in this pass is fully Expo-Go-testable as required; this one
  piece of Part 2 structurally can't be.
- `expo install` needed `--legacy-peer-deps` for every install step after the router, for the
  reason above (expo-router's web dependency chain wants `react-dom`, which this app doesn't
  have since it's not targeting web in this pass).
- Added `@expo/vector-icons` (+ its `expo-font` peer, explicitly declared after finding it only
  resolved as a nested transitive dep otherwise) for the building glyph on the intro screen —
  same hoisting issue as `babel-preset-expo` below, same fix.

### Verification performed

- `npx tsc --noEmit` — clean.
- `npx expo export --platform ios --clear` — full Metro bundle succeeds (1624 modules, cache
  cleared to be sure), confirming Babel/Nativewind/expo-router/Supabase/vector-icons all resolve
  correctly together.
- Did **not** run the live device test (login → force-quit → reopen → still authenticated)
  myself — `.env.local` only has placeholder Supabase values, and this needs a real device via
  Expo Go. **You already had `expo start` running against this project in another window while I
  worked (a device was connected) — please restart it (`npx expo start -c`, clearing the cache)
  before testing, since I changed `babel.config.js`/`metro.config.js`/dependencies after your
  server started, and those are only read at boot.**

### Intro screen — redesigned to a supplied mockup

The intro screen was rebuilt to match a mockup you provided directly: navy (`#0F1F33`)
background, an 84px amber (`#F0A227`) badge with a dark-amber (`#412402`) building glyph
(`Ionicons name="business"`, via `@expo/vector-icons`), "PMC Portal" in medium-weight white type,
"by TeamHandsOn" as the subtitle, a spinner (`ActivityIndicator`, tinted amber) instead of a
tagline sentence, and a faint "v{app version}" footer read live from `app.json` via
`expo-constants`. This replaced the original tagline-based layout — no tagline is shown anymore.
If "by TeamHandsOn" was just placeholder text in the mockup rather than an intended subtitle,
that's a one-line change in `app/index.tsx`.

### Placeholder logo

Amber (`#F0A227`) rounded-square badge with a dark-amber (`#412402`) building glyph — generated
as a static PNG (`assets/icon.png`, `assets/splash-icon.png`, also used for the app icon) and
reused live via `components/Logo.tsx` for in-app screens. Original pick was navy+amber (the web
app's `globals.css` theme is an intentionally monochrome black/white/zinc system with no brand
color to inherit, so that was my own choice); superseded by the amber-badge/navy-background
scheme from your mockup. Swapping in a real logo later is still a one-line change inside
`Logo.tsx` (replace the `View`+`Ionicons` with an `Image`); no other screen needs to change.

### ⚠️ RLS flag on `user_profiles` — needs your decision before this is production-safe

Confirmed by reading `supabase/schema.sql` and `PROJECT_SUMMARY.md` in `portal`: **Row Level
Security is explicitly and intentionally not defined** on any table, because the web app connects
via Prisma straight to Postgres (`DATABASE_URL`), bypassing PostgREST/RLS entirely. `proxy.ts` +
a signed cookie is the web app's only access-control layer — there is no DB-level enforcement.

This mobile app has no such option — it only has the anon/authenticated Supabase client, which
goes through PostgREST, which respects RLS. Two things follow from RLS being absent:

1. **It will probably still work end-to-end**, because Supabase's default project setup grants
   `SELECT`/`INSERT`/`UPDATE`/`DELETE` on all `public` schema tables to the `anon` and
   `authenticated` roles regardless of RLS state — RLS is meant to be the *only* thing narrowing
   that down, and here it isn't narrowing anything. So `lib/getUserRole.ts`'s
   `.from('user_profiles').select('role').eq('email', ...)` call should return a row once you
   paste in real credentials.
2. **But it isn't scoped to "your own row only."** Any authenticated mobile client can currently
   query *any* user's profile — email, role, phone, `last_login` — not just their own, because
   nothing at the database layer restricts the row set. That's fine for this narrow login-time
   lookup, but it's an open door for anything else built on top of this client later.
3. There's an added wrinkle if you do want to lock this down: `user_profiles.id` is its own
   independently-generated UUID (`gen_random_uuid()`), **not** a foreign key to
   `auth.users.id`. The only thing linking a Supabase Auth identity to a `user_profiles` row is a
   matching `email`. So a correct policy has to be
   `using (email = auth.email())`, not `using (id = auth.uid())` — the usual RLS boilerplate
   won't work here as-is.

I did not add an RLS policy myself — that's a real security decision (locking down a table that's
currently open) and changes production access behavior, so it should be a deliberate call on your
end, not something I decide silently. If you want it, the policy would look like:

```sql
alter table user_profiles enable row level security;
create policy "read own profile" on user_profiles
  for select using (email = auth.email());
```

I could not test any of this against the real project — `.env.local` has placeholder values only.
Flagging it now as requested, before starting the next feature.

## 2026-07-09 (later) — Real credentials, role/active gating, root-caused the launch crash

### Root cause of "loads then closes"

`.env.local` had blank `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` (placeholders
from the first pass). `lib/supabase.ts` calls `createClient(...)` as a **top-level side effect**
at module-import time, before any component mounts — `supabase-js` validates the URL immediately
and throws synchronously on an empty string. That's an uncaught exception during the very first
bundle evaluation, before anything can render or a JS error boundary can catch it — matching
"shows loading, then the app just closes" exactly. Fixed by populating `.env.local` with the real
project URL + anon/publishable key you provided. Used `.env.local` (already gitignored, already
wired, Expo's own convention) rather than creating a separate `.env` — the two aren't both needed
and having both invites confusion about which wins.

**I only wrote the URL and anon/publishable key into `.env.local`.** The service role key and
`DATABASE_URL`/`DIRECT_URL` you pasted were not used anywhere and never will be from this
app — those must never ship inside a mobile bundle. Separately: that key and DB password are now
sitting in plaintext in this chat transcript — worth rotating if you're not comfortable with that.

### RLS check — tested live against the real project, not theorized

Queried `user_profiles` directly over PostgREST using only the anon/publishable key, no login at
all:
```
curl .../rest/v1/user_profiles?select=email,role,status,is_active&limit=3
→ 200 OK, three real rows returned (emails, roles, status, is_active — unredacted)
```
**Confirmed empirically: RLS is not just permissive, it's fully open.** Zero authentication was
enough to read arbitrary rows, including other users' role/status. This isn't a wall the mobile
login hits — it's the opposite problem, live in production right now, independent of the mobile
app. The lookup in `lib/AuthContext.tsx` will succeed cleanly. Still recommend the policy from the
earlier RLS section above; happy to write and apply it if you want to lock this down now that it's
confirmed rather than suspected.

### Enumeration check — also tested live

```
signInWithPassword(unknown-email, wrong-password)      → 400 invalid_credentials
signInWithPassword(real-email arjun.kumar@..., wrong)   → 400 invalid_credentials
```
Identical error for both — Supabase Auth itself doesn't distinguish "no such account" from "wrong
password," so mapping both to one generic "Invalid email or password" message (already what the
code does) carries no enumeration risk.

### What was built

- `lib/AuthContext.tsx` — replaces the old `lib/getUserRole.ts` fallback-to-metadata approach
  entirely (that approach no longer fits: this app must *reject* valid Auth credentials for
  non-site-engineers, not fall back to guessing a role). `loadSiteEngineerProfile()` queries
  `user_profiles` by email with `.maybeSingle()` (so "no row" is data, not a thrown error — needed
  to tell "not provisioned" apart from a genuine RLS/grant wall) and gates in order: query error →
  distinguish permission-denied (Postgres code `42501` / HTTP 401/403) from other errors; no row →
  "not set up for this app"; `role !== 'site_engineer'` → "site engineers only"; `status !==
  'active'` or `is_active === false` → "account inactive"; otherwise signed in. `AuthProvider`
  exposes `{ state, signIn, signOut }` via context; `state` is `loading | signed-out |
  signed-in` (carrying the profile), used by both `login.tsx` and the `(authenticated)` layout
  guard so the check lives in exactly one place.
- `app/(authenticated)/_layout.tsx` now re-runs the full role/active check on every relaunch
  (via `AuthProvider`'s `restore()`) instead of only checking "does a session exist" — an admin
  deactivating someone mid-session is caught on next launch, not ignored.
- `app/login.tsx` and `app/(authenticated)/home.tsx` now go through `useAuth()` instead of calling
  `supabase.auth` directly; `home.tsx` reads the profile straight from context instead of
  re-fetching it.

### What I could not test myself — needs you, on a real device

I don't have a real user's password, and can't force-quit a device from here, so four of the five
required scenarios still need you to verify on your phone:
1. ✅ Wrong password / unknown email → generic error (tested live above, both routes covered by
   code review — same code path either way).
2. ⬜ A real `site_engineer` + active login → lands on the home screen.
3. ⬜ A real admin/senior-engineer login → rejected with "This app is for site engineers only."
4. ⬜ An inactive site-engineer login → rejected with "Your account is currently inactive."
5. ⬜ Session restore on force-quit (not just backgrounding) → still lands on home without
   re-prompting for login, until sign-out or actual session expiry.

Please restart your dev server (`npx expo start -c`) to pick up both the new env values and the
`AuthContext` rewiring, then run through 2–5 above and let me know what you see.

## 2026-07-09 (later still) — Second crash: native module version mismatch

After the env-var fix, the app still crashed after showing only Expo Go's own generic
icon+name loading screen (never reaching our custom JS screens at all) — a strong signal the
crash was happening at native-module init, before React even mounted, not in our JS logic.

`npx expo-doctor` found it immediately: we'd installed `react-native-worklets@0.10.x`, which npm
resolved to `0.10.2` — but Expo Go's SDK 57 binary has `react-native-worklets@0.10.0` baked into
its native layer. Worklets' native/JS halves have to match exactly; a patch-version drift between
them is a known cause of silent native crashes on real devices that never surface as a JS error or
a Metro build failure (both stayed clean throughout, which is why `tsc`/`expo export` never caught
this). Fixed with `npx expo install --fix`, which pinned it to the exact expected `0.10.0`.
`expo-doctor` now reports 20/20 checks passing. Worth running `npx expo-doctor` first the next time
something crashes only on-device with clean builds — it checks exactly this class of issue.

## 2026-07-09 (offline sync foundation)

Built the local-first sync queue per spec — every submission always writes to SQLite
synchronously first; a background engine separately pushes unsynced rows to Supabase whenever
connectivity allows. No "online vs. offline" branching anywhere in the write path.

- `lib/db/localDb.ts` — opens `mobile-portal.db` via `expo-sqlite`'s async API, creates
  `sync_queue` (schema exactly as specified) on first run, exposes `enqueue`, `getPending`,
  `markSyncing`, `markSynced`, `markRetry`, `markFailed`, `getQueueCounts`. Pure CRUD — no retry
  policy lives here.
- `lib/sync/syncEngine.ts` — `processQueue()` processes pending rows strictly sequentially
  (`for...of` with `await`, never `Promise.all`), each dispatched through a small
  `entity_type -> handler` registry (`lib/sync/handlers.ts`) so wiring in `attendance`/`dpr` later
  is one new map entry, not an engine change. Retry cap is 5 attempts; backoff is exponential
  (1s, 2s, 4s, 8s, 16s, capped at 30s) tracked in an in-memory `Map<id, cooldownUntil>` rather than
  a new DB column — kept the schema exactly as specified, and backoff resetting on a fresh app
  launch is fine since it's only meant to stop a live session from hammering a row, not survive
  restarts. A 200ms pause between rows keeps a large queue draining smoothly rather than in one
  burst.
- `lib/sync/syncTriggers.ts` — `NetInfo.addEventListener` fires `processQueue()` on the
  offline→online transition; `AppState` fires it on foreground. No polling interval anywhere.
  Wired once from `app/_layout.tsx` via `useEffect`.
- `lib/sync/useSyncStatus.ts` + `lib/sync/syncEvents.ts` — a tiny pub/sub so any screen can read
  live queue counts; every `localDb` mutation calls `notifyQueueChanged()`, so badges update the
  instant a row's status changes, not just on manual refresh.
- `app/(authenticated)/sync-test.tsx` — throwaway 3-field test form, linked from the home screen
  ("Sync test →"). **Delete this screen, the `test_entry` entry + handler in
  `lib/sync/handlers.ts`, and the `test_sync_entries` table once a real feature is wired into the
  queue instead — this is disposable testing infrastructure, not a feature.**

Verified: `tsc --noEmit` clean, `expo export --platform ios` bundles clean, `expo-doctor` 20/20
(checked immediately after installing `expo-sqlite`/`netinfo`, given the worklets version-mismatch
lesson above).

**What I could not do myself:** creating the `test_sync_entries` Supabase table needs DDL
privileges the anon key doesn't have, and the sandbox's safety layer blocks using the service-role
key directly in a shell command — so that table needs to be created via the SQL Editor, by you.
Same for the 5-step manual test script (toggling wifi, force-quitting the app) — that needs a
physical device I don't have access to.

## 2026-07-09 (geofenced check-in)

Verified the `portal`-side prerequisite before starting: `Project.siteLatitude`/`siteLongitude`,
`AttendanceRecord`/`attendance_records`, and the real `/attendance` admin page all already exist
and match exactly. Confirmed live: `projects` and `attendance_records` are both readable via the
anon key with zero RLS wall (same open posture as `user_profiles`) — did not live-test the
INSERT itself, to avoid writing fake data into production without asking; that gets proven by the
real end-to-end device test below.

**Android mock-location signal — confirmed real, not assumed.** Checked
`node_modules/expo-location`'s actual type declarations (v57.0.2, not training-data memory):
`LocationObject.mocked?: boolean`, explicitly tagged `@platform android` — this is expo-location's
current wrapper around Android's native `isFromMockProvider()`. It's genuinely there; used
directly as `location.mocked`. On iOS this field is simply absent/undefined — there is no public
Apple API for a third-party app to detect a spoofed location, so `mockLocationSuspected` is always
`false` on iOS. That's a permanent platform gap, not a bug.

**The timestamp-gap distinction — the one piece worth walking through carefully,** since
`serverReceivedAt` (needed for the gap check) doesn't exist until the row is actually inserted,
which structurally can't happen at capture time in a local-first design:
1. At capture time (`app/(authenticated)/attendance.tsx`), `isOnline()` — a live flag maintained
   by `lib/sync/syncTriggers.ts`'s `NetInfo` listener — is read synchronously and stored on the
   payload as `submissionMode: 'immediate' | 'queued'`. This captures *intent*: was the device
   online right when the button was tapped.
2. Distance/no-site/mock-location flags are computed and finalized immediately, at capture time,
   exactly as required — these don't depend on anything that happens later.
3. The gap check itself is evaluated once, inside the `'attendance'` sync handler
   (`lib/sync/handlers.ts`), at the moment the row is actually about to be inserted — using
   `Date.now()` there as the proxy for `serverReceivedAt` (a fair proxy: network latency for one
   insert is milliseconds, not the minutes we're checking for). It's only applied when
   `submissionMode === 'immediate'`; a `'queued'` row is never flagged for this reason, no matter
   how long it sat offline. Threshold is 5 minutes — generous enough to absorb normal retry/backoff
   delays (worst case a few minutes across 5 capped-at-30s retries) without false-flagging a
   legitimately-immediate submission that just hit a transient server error along the way.
4. Both stages route through the same `buildFlags()` (`lib/attendance/flags.ts`) so the
   reason-joining logic exists in exactly one place — capture time calls it with
   `implausibleImmediateGap: false` (unknowable yet), the handler calls it again with that one
   input finalized, merging with the three already-decided flags.

**Found and fixed a real bug in the existing sync engine while wiring this in:** `processQueue()`'s
`isProcessing` guard silently dropped any trigger that arrived while a run was already in flight —
meaning a row enqueued mid-run wouldn't be picked up until some unrelated future trigger fired.
Since every check-in tap now calls `enqueueAndSync()` (enqueue + immediate best-effort sync
attempt), concurrent calls got much more likely. Fixed by having a dropped trigger set a
`rerunRequested` flag that makes `processQueue()` loop once more before releasing its lock.

**Project selection — a gap the prompt assumed away.** Nothing in the mobile app tracks "which
project is this user on" — no such field exists on `UserProfile`, and no project-picker UI existed
before this. Built a minimal one: `attendance.tsx` fetches all projects, auto-selects silently if
there's exactly one (true today — the only project in the system, "ABC Villa Construction", has
no site coordinates set, so every check-in will show the "No site location configured" flag until
that's set via the `portal` app), and shows a simple chip picker if there's ever more than one.

**"Current status" (Check In vs. Check Out) is derived purely from local history** — today's
most recent `'attendance'` entry in `sync_queue` on this device, regardless of sync status — not
a Supabase query. This keeps the toggle correct while offline by design, but means it's
per-device: it doesn't know about a check-in made from a different phone. Flagging this as a
known simplification, not an oversight.

**What I could not do myself:** the full 5 required checks — a real check-in while offline, a
force-close, connectivity restored, confirming the record lands correctly (with correct flags) in
`portal`'s `/attendance` page, and specifically confirming the offline-queued record does *not*
get the timestamp-gap flag while an online one with an artificially large gap *does* — all need a
physical device and can't be simulated from here. `tsc --noEmit`, `expo export --platform android`,
and `expo-doctor` (20/20) are all clean, which rules out build-time issues, but says nothing about
whether the actual flagging logic behaves correctly against a real GPS fix and a real network
blip. Please run through those and report back what the `/attendance` page actually shows.


