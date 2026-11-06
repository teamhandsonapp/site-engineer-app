# Mobile app performance audit

Date: 6 November 2026. Read-only: no code, config or data was changed to
produce this report.

**Scope:** the mobile app (`site-engineer-app`), the Supabase queries it
makes and the Edge Functions it relies on. Admin-web is out of scope.

**Code audited:** `main` plus `feature/whatsapp-groups` (Site Groups) and
`feature/email-reports`. Both branches are ahead of main, not diverged. The
uncommitted Site Groups redesign files were ignored.

**Database:** live project, read-only transactions only, connected as
`postgres` and, for one `EXPLAIN`, as `authenticated` with a staff user's
JWT claims. No credentials appear in this file.

**Earlier plan:** this report builds on `docs/TODO-performance.md`. Items
already listed there are tagged with their ID (H8–H10, M7–M14, "Low") and
are not re-specified here.

Status words used below:
- **done:** in place and working.
- **partly:** some screens or paths have it.
- **missing:** not in place.
- **n/a:** not applicable.

---

## 0. Read this first

### 0.1 Fetch loop on four screens (critical, new)

`lib/useLatestRequest.ts` returns a new `{ begin }` object on every render.
Four screens list that object in their `load` `useCallback` dependencies, so
the screen refetches forever:

1. `load` changes on every render.
2. The `useEffect([load])` runs again and calls `load`.
3. `load` sets state, which renders again, which creates a new `load`.

| Screen | File | Measured in the web build |
|---|---|---|
| Site Engineer Attendance | `app/(authenticated)/engineer-attendance.tsx:133,148` | 680–1,140 requests in 45 s (≈25 a second): `projects`, `project_users`, `user_profiles`, `attendance_records` |
| Completed Tasks | `app/(authenticated)/completed-tasks.tsx:38,53` | 37 `tasks` requests in 10 s |
| Documents | `app/(authenticated)/documents.tsx:427,441` | 57 `documents` requests in 10 s (each one also signs a URL per file once documents exist) |
| Engineer attendance detail | `app/team-attendance-detail/[userId].tsx:460,481` | same pattern in the code; not measured |

- **When it started:** commit `124fdbf` ("M16: ignore stale responses after
  a project switch"), 4 Nov 21:33, on `main`.
- **Shipped builds:** the v34 Play build was cut earlier the same day
  (`602bae9`, 13:43), so it should not contain the loop. Every build made
  from `main` since then does.
- **Why it matters:** the drawer keeps visited screens mounted, so once a
  manager opens one of these screens it can keep looping in the background.
  That drains battery and mobile data and loads the database.
- **Fix (S, JS only):** in `useLatestRequest`, return a stable object:
  `return useMemo(() => ({ begin }), [begin]);`. Alternatively, depend on
  `latest.begin` instead of `latest`. Fix this before the next build.

### 0.2 Security finding (outside performance; not touched)

Ten public tables have **RLS disabled**, while `anon` and `authenticated`
both hold SELECT / INSERT / UPDATE / DELETE grants on them:
- `activity_log`
- `holidays`
- `task_types`
- `accountability_trades`
- `inventory_items`
- `inventory_transactions`
- `draft_sequences`
- `draft_task_nodes`
- `draft_task_edges`
- `daily_update_reminders_sent`

Anyone holding the public anon key, which ships inside the app, can read and
change these tables through the REST API.

Do not simply switch RLS on. The app reads `holidays`, `task_types` and
`activity_log`, so it would stop working until policies exist. This needs a
reviewed migration: add policies first, enable RLS, then revoke `anon`.

---

## 1. Baseline measurements

### 1.1 Round trip from this laptop to Supabase (Tokyo)

| Path | Warm | Cold (first request) |
|---|---|---|
| REST API (`/rest/v1`, 1 row) | median **164 ms** (152–175) | 643 ms |
| Auth (`/auth/v1/health`) | median 164 ms | 1,197 ms (DNS + TLS) |
| Storage (`/storage/v1/version`) | median 160 ms | 177 ms |
| Database `select 1`, transaction pooler (6543) | **~111 ms** | connect 976 ms |
| Database `select 1`, session pooler | ~110 ms | connect 735 ms |

Ping to the API host is 11 ms, but that only reaches Cloudflare's edge. Every
real request goes on to Tokyo, so **one sequential round trip costs about
120–165 ms** from India. The estimates below use 120 ms, as asked.

### 1.2 Screen load: requests on open, waves, total time

**How it was measured:**
- **Build:** Expo web dev build on 8081, Chrome headless at a 390×844 phone
  size, live database.
- **Accounts and project:** the git-ignored test users (`site_engineer` and
  `manager`) on project ROAST @ Kokapet.
- **Runs:** three per screen; the median is shown.
- **Navigation:** in-app, without a page reload. Each in-app navigation
  remounted the signed-in layout, which adds a fixed set of 8 layout
  requests (profile, device heartbeat, bell, projects, assignments, Site
  Groups badge). A real tab tap does not send these, so they were removed;
  the cold-open row keeps everything.
- **Waves:** a wave is a group of requests sent together. A new wave starts
  only after the previous one has answered, so **waves equal sequential
  round trips**.
- **Time:** from the screen's first request to its last response. It doesn't
  include rendering, and the dev build renders slower than release.

| Screen (route) | Requests | Waves (sizes) | Median time | Notes |
|---|---|---|---|---|
| **Home**, cold app open (`/home`, full page load) | 14 | 3 (1, 12, 1) | **1,692 ms** | includes ~700 ms of dev-bundle start; profile → 12 in parallel → Site Groups badge |
| **Home**, in-app | 6 | 1 (holidays chained inside) | **451 ms** | projects + all tasks + client alerts + procurement (all tasks again) + task types + holidays (H8) |
| **Attendance** (`/attendance`, clock-in screen) | 1 | 1 | **426 ms** (164–448) | today's records only |
| **Site Attendance** (`/team-attendance`) | 0 | — | — | **demo data**; no database reads (`components/team/WorkforceAttendance.tsx`) |
| **Site Engineer Attendance** (`/engineer-attendance`) | ∞ | ∞ | never settles | fetch loop, §0.1 |
| **DPR list** (`/daily-updates`) | 7 | **5** (3, 1, 1, 1, 1) | **1,407 ms** (860–2,206) | 4 independent queries run one after another (M7) |
| **DPR entry** (`/dpr-edit/[taskId]`) | 15 | **4–5** (1, 10, 1, 3) | **1,159 ms** (986–2,410) | task → batch → subtask starts; delay card: task report → links → tasks → holidays → project/count/entries |
| **Flowchart** (`/flowchart`) | 7 | 2 (5, 2) | **404 ms** | `milestones` fetched twice; `works` after the main batch |
| **Gantt** (`/gantt`) | 4 | **3** (1, 2, 1) | **607 ms** (573–813) | tasks → links + types → holidays |

**Data volumes today:** 3 projects, 15 tasks, 13 task links, 630 checklist
items, 98 attendance rows and a 35 MB database. Every list is still small,
so most numbers above are latency-bound (round trips), not data-bound. The
H8–H10 problems will dominate once a project has hundreds of tasks.

---

## 2. Screens and UI

### 1. Skeleton loading — **partly**

**Skeleton** (5 screens):
- Home (`components/home/AppHome.tsx:263`)
- DPR entry (`app/dpr-edit/[taskId].tsx`)
- Site Groups list and chat
- Site Photos (`components/files/SitePhotosBrowser.tsx`)

**Full-screen spinner** (`ActivityIndicator`), grouped by impact:

| Impact | Screens |
|---|---|
| High: opened daily | DPR list (`daily-updates.tsx`), Attendance (`attendance.tsx`), Task List (`task-list.tsx`), Flowchart (`flowchart.tsx`), Gantt (`gantt.tsx`), Project Dashboard (`project-dashboard.tsx`), Task detail (`task/[taskId].tsx`), DPR checklist (`dpr-checklist/[taskId].tsx`), the project gate (`components/ProjectGate.tsx:38`, shown before every gated screen) |
| Medium | Completed Tasks, Documents, Contacts, Project Contacts, Engineer Attendance, attendance detail, Leave log, MoM, Day timeline (`components/DayTimelineView.tsx`), `team/[category]` |
| Low: admin or occasional | Invoices, Access & Roles, Settings, Devices, DPR edit requests, all 8 report screens, checklist and flowchart templates (5 screens) |

**Blank:** none found.

**Fix:**
- Reuse `SkeletonList` / `SkeletonCard` from `components/ui/States.tsx`,
  shaped like each screen's real rows.
- Do the high-impact group first. Flowchart and Gantt can use a simple
  canvas-shaped skeleton.
- The ProjectGate spinner can go once projects are cached (item 13).

### 2. Optimistic updates — **partly**

| Action | Where | Status | Waits for |
|---|---|---|---|
| Checklist status tick, quantity | `components/taskDetail/ChecklistItemRow.tsx:94,105` | **done**: optimistic with revert | — |
| Checklist label rename, quick comment | same file, `:72`, `:117` | missing | 1 round trip (low) |
| MoM meetings, attendance marks, history | `lib/mom/store.ts` | **n/a**: stored on the device (AsyncStorage), instant | — |
| Attendance clock-in / clock-out | `app/(authenticated)/attendance.tsx:237` → `lib/attendance.ts:155` | missing (by design: server-validated) | **4 sequential round trips ≈ 480–650 ms**: read today's records → shift window (check-in) → insert → reload |
| DPR task status change | `app/dpr-edit/[taskId].tsx:318` | missing | RPC, then refetch the task: 2 round trips |
| DPR "Submit" | `app/dpr-edit/[taskId].tsx:398` | missing | save fields, then mark submitted: 2 round trips |
| DPR photo add | `app/dpr-edit/[taskId].tsx:446` | missing | resize → Edge Function upload → reload all photos (list + one signed URL each) |
| Task field edits (Flowchart sheet) | `components/flowchart/TaskDetailSheet.tsx:354` | missing | 1+ round trips |
| Client approval (ClientHome) | `components/home/ClientHome.tsx:255` | not optimistic **on purpose** (comment) | — |

**Fixes:**
- **Attendance:** keep the server as the authority, but cut the trips. Run
  the session check and the shift-window read in parallel, or move both into
  one RPC. Use `.insert(...).select()` to get the new row instead of
  reloading. That makes 2 round trips instead of 4, saving **≈240 ms**.
- **DPR status:** have `update_task_status` return the updated row, saving
  1 round trip (≈120 ms).
- **Submit:** write `submitted_at` in the same upsert as the fields, saving
  1 round trip.
- **Photos:** see item 15.

### 3. Debounce — **n/a (low)**

All 8 search boxes filter data already in memory; none queries the server
per keystroke:
- `contacts.tsx:457`
- `project-contacts.tsx:445`
- `documents.tsx:202`
- `task-list.tsx:271`
- `leave-log.tsx:142`
- `devices.tsx:224`
- `components/reports/TaskPicker.tsx:74`
- `components/mom/RecipientPicker.tsx:92`

The only cost: `contacts.tsx:378`, `project-contacts.tsx:365` and
`documents.tsx:173` re-filter without `useMemo`, then redraw the whole
ScrollView list on every key (M8).

**Fix:** `useMemo` plus `useDeferredValue(query)`. No timer needed. Low impact.

### 4. Pagination — **missing** for user-facing lists

| List | Where | Status |
|---|---|---|
| DPR history for a task | `lib/dprEntries.ts` `fetchAllDprEntriesForTask` (DPR entry loads every day's entry for the task) | missing (Low list) |
| Activity log | the app only **writes** `activity_log`; the activity report pages through everything in the range (`lib/reports/dprActivityReport.ts:134`) | report: acceptable (export) |
| Notifications | `app/(authenticated)/notifications.tsx` is **dummy data** | n/a |
| Files | `app/(authenticated)/files.tsx` is **dummy data**; Site Photos are stored on the device | n/a (needs paging when real) |
| Documents | `lib/documents.ts:60` loads every document and signs every URL | missing (M11) |
| Contact book | `lib/contacts.ts:83`, `lib/projectContacts.ts` | missing (M8) |
| Tasks | Task List, Flowchart, Gantt, DPR lists load all project tasks | missing (H9, H10) |
| Leave log | `lib/leaveEvents.ts:184` | missing (M13) |
| Site Groups messages | `lib/groupChats/useChatMessages.ts` | **done**: keyset paging |

Several `.range()` loops exist (`dprEntries.ts:279`, `attendanceReview.ts:494`,
`reports/*`). They page in order to fetch **everything**, which avoids the
1,000-row cap; they are not lazy paging.

### 5. Virtualization — **partly**

- **FlatList used:** Task List, Leave log, Invoices, Access & Roles, Site
  Groups, comment thread.
- **ScrollView + `.map` over data lists (M8):**
  - Contacts, Project Contacts, Documents, Completed Tasks, DPR edit
    requests, Devices, Engineer Attendance.
  - `components/flowchart/FilteredTaskList.tsx`,
    `components/reports/TaskPicker.tsx`.
  - Two not in M8: **DPR list** (`daily-updates.tsx`, 10 `.map` calls
    inside one ScrollView; every task row is mounted) and **Project
    Dashboard** sections.
- **Gantt:** `components/gantt/GanttChart.tsx` renders every task twice
  (labels and bars), with no virtualization (M9).
- **Flowchart:** an absolutely positioned canvas. It already culls off-screen
  nodes (`recomputeVisibleTasks`), but every node re-renders on pan and zoom
  (M10).
- **Fix:** M8 / M9 / M10. Add `daily-updates.tsx` to M8: use a `SectionList`
  keyed by bucket (Urgent / This week / Pending).

### 6. Re-renders — **partly**

- **Contexts:** `AuthContext` and `ProjectContext` values are memoised with
  `useMemo`; Toast is stable. **done**.
- **`React.memo`:** used only in Site Groups (`ChatListRow`, `MessageBubble`,
  `ChatBackground`). Missing in:
  - `TaskNode` (M10)
  - Gantt rows (M9)
  - DPR task rows (`components/dpr/DprTaskRow.tsx`)
  - contact rows
- **Inline `renderItem`** creating a new function every render:
  - `access-roles.tsx:627`
  - `leave-log.tsx:365`
  - `invoices.tsx:416`
  - `task-list.tsx:253,289`

  These are low impact while the rows themselves aren't memoised.
- **Timers:** Attendance's 1-second clock lives in its own small component
  (`LiveClock`), which is fine. The 30–60 s "now" tickers (`attendance.tsx:197`,
  `engineer-attendance.tsx:162`, `team-attendance-detail:249`,
  `MeetingTab.tsx:65`) re-render the whole screen once a minute (low).
- **Fix:** `React.memo` `DprTaskRow` and `TaskNode`; hoist `renderItem` with
  `useCallback`. Low effort, medium value on the DPR list.

### 7. Images — **partly**

- **Upload: done.** `lib/preparePhoto.ts`:
  - Longest edge 1600 px, JPEG quality 0.6, typically 200–400 KB.
  - The picker also asks for quality 0.8 first (`dpr-edit:478,488`,
    `dpr-checklist:153,163`), so every photo is JPEG-encoded twice. Ask the
    picker for `quality: 1`; the resize step compresses anyway.
- **Transport:** base64 JSON through the `upload-dpr-photo` Edge Function.
  That is +33 % bytes and a second hop (Tokyo function → Storage).
  **Fix (M):** a signed upload URL (`createSignedUploadUrl`) and a direct
  binary upload.
- **Thumbnails: missing.** DPR entry shows 96×96 tiles from the full
  1600 px photo (`dpr-edit/[taskId].tsx:961`); the same holds on DPR
  checklist (M11).
- **Caching: missing.** RN `Image` only (`expo-image` isn't installed).
  Signed URLs change on every fetch, so even the platform cache misses
  every time (M11).
- **Storage today:** `dpr-photos` holds 1 object and drawings 13 (106 kB
  total), so there is no real volume yet.

### 8. Unused dependencies, assets and bundle size

**Dependencies:**
- Every package in `dependencies` is imported, or is a required peer or
  build package (`expo-dev-client`, `expo-linking`, `react-dom`,
  `react-native-web`, `react-native-worklets`, `tailwindcss`). **None unused.**
- (Checked by import search. knip/depcheck were not installed, to keep the
  audit read-only.)
- `react-native-maps` is still bundled while location features are switched
  off: native code only, so no bundle weight. Keep it, since the features
  come back.

**Assets:** 3.5 MB in total.
- `splash-icon.png` and `android-icon-background.png` are not referenced
  (44 KB).
- 13 notification sounds are uncompressed WAV (**≈2.8 MB**) in `app.json`.
  OGG/MP3 for Android would be about 10× smaller (needs a native build).
- Sample photos (Site Photos demo) total 270 KB.

**Release bundle:** `expo export --platform android`, written to a temp
folder.

| | Size |
|---|---|
| Hermes bytecode | **8.2 MB** |
| Bundled assets | 3.2 MB |

Share of the bundle, estimated from the source map:

| Package | Share | ~MB |
|---|---|---|
| App code | 20 % | 1.65 |
| **`xlsx`** | **12.5 %** | **1.02** |
| react-native | 10 % | 0.84 |
| expo-router | 10 % | 0.80 |
| reanimated | 7 % | 0.57 |
| Sentry (core, RN, browser, replay, feedback) | ~15 % | ~1.2 |
| supabase auth-js | 3 % | 0.23 |

- **`xlsx`** is used only by the flowchart template-sheet import
  (`lib/flowchart/templateSheetParser.ts`), an admin-only action.
  **Fix (M):** parse the sheet in an Edge Function, or switch to a small
  CSV/XLSX reader. A dynamic `import()` alone won't shrink the native
  bundle.
- **Sentry Replay and Feedback** (~0.26 MB) ship even though Replay is
  deliberately off. Low priority.
- Hermes memory-maps bytecode, so size mostly affects download and update
  size, not start-up.

---

## 3. Data and API

### 9. Sequential awaits that could run in parallel

The ✱ marks a measured figure; the rest are from the code.

| Screen / action | Where | Today | Possible | Saved at 120 ms |
|---|---|---|---|---|
| DPR list | `daily-updates.tsx:213-233` | 5 waves ✱ | 2 | **≈360 ms** (M7) |
| DPR entry: main load | `dpr-edit/[taskId].tsx:126-145` | task → batch → subtask starts | 1–2 (embed subtask starts, or one RPC) | ≈120–240 ms |
| DPR entry / Task detail / DPR checklist: delay card | `lib/reports/generalParameterReport.ts:134-191` | task report (+ ancestor link pages) → holidays → project/count/entries ≈ 4 waves | holidays and the project row in parallel with the task report; derive the count from the entries (Low list) | ≈240 ms |
| Gantt | `lib/projectTimeline.ts:110-147` | 3 waves ✱ | 1 (links filtered by project, H9; holidays from cache) | **≈240 ms** |
| Flowchart | `flowchart.tsx:83` + `FlowchartCanvas.tsx:251` | 2 waves ✱, milestones twice | 1 | ≈120 ms + 1 request |
| Home | `lib/projectStats.ts:66` → procurement → holidays | 1 wave + 1 chained ✱ | 1 (cached holidays) | ≈120 ms |
| Attendance clock-in | `lib/attendance.ts:155-161` + reload | 4 sequential | 2 | ≈240 ms |
| DPR status / Submit | `dpr-edit:318-324`, `:398-419` | 2 each | 1 each | ≈120 ms each |
| DPR checklist load | `dpr-checklist/[taskId].tsx:85-105` | batch → delay report (≈4 more) | start the delay report as soon as the project id is known | ≈120–240 ms |

### 10. N+1 patterns — **missing** (new, beyond M11)

- **Engineer Attendance and `team/[category]`**
  (`lib/attendanceReview.ts:509` and `:562`).
  - **Per engineer:** one "older record?" query, plus geofence,
    restricted-zone and location-disabled queries
    (`fetchEngineerDailyAttendance`, `:284-300`).
  - **Volume:** up to 4 × engineers requests per open. With 12 engineers
    that is ~40–50 requests, in parallel but heavy on a phone connection.
  - **Fix (M):** 3 batched queries with `.in('user_id', ids)` plus the
    project and date filter, grouped in JS. The "older record" check
    becomes one query over all users, or an RPC.
- **Signed URLs one per file** (M11):
  - `lib/documents.ts:68`
  - `lib/dprEntries.ts:780`
  - `lib/dprChecklist.ts:102`

  Use `createSignedUrls(paths, ttl)`.
- **Ancestor walk** for the delay card pages through **all**
  finish-to-start links (H9).

### 11. Duplicate requests

Duplicates seen in the measurements:
- **Home:** all tasks fetched twice (`projectStats` and
  `procurementSchedule`), and `projects` twice (`ProjectContext` and
  `projectStats`) (H8).
- **Flowchart:** `milestones` fetched twice (`flowchart.tsx:85` and
  `FlowchartCanvas.tsx:251`). Pass it down as a prop.
- **DPR entry:**
  - `tasks` 3×, `dpr_entries` 2× plus a count, `dpr_entry_subtasks` 2×.
  - The delay card refetches what the screen already has.
  - Pass the task and entries into `fetchGeneralParameterReport`, or let it
    accept preloaded rows.
- **App start:** `user_profiles` read 2–3× (AuthContext, force-logout watch,
  role).

Duplicates over time:
- **Force-logout watch** (`lib/forceLogoutWatch.ts:116`): **23,196 calls**,
  the most frequent app query. A 60 s poll runs **on top of** a realtime
  channel on the same row. Poll only when realtime is disconnected, or every
  5 min (Low list).
- **Home refetch:** Home reloads every dataset on any checklist change in
  any project (`useDependencyCompletionsRealtime(load)`, unfiltered) (H8).
- **Task List:** M12.
- **Leave log:** M13.
- **Notification bell:** M14.

There is no refetch on every focus, which is good. Only the template screens
and the Flowchart canvas use `useFocusEffect`.

### 12. `select('*')` / unneeded columns — **done (low)**

- `select('*')` appears only in the undo snapshots
  (`lib/flowchart/undo.ts:101-124`, `templateUndo.ts:46`). These need whole
  rows to restore, so that is intended.
- Elsewhere, explicit column lists are used.
- **Minor:** the Home tasks query embeds `work:works(project_id, code)` for
  every task in every project (H8).

### 13. Data that could be cached on the phone — **missing**

Only Site Groups caches today (`lib/groupChats/cache.ts`). Candidates, all
small, slow-changing and read on many screens:

| Data | Calls since stats reset | Read by | Suggested |
|---|---|---|---|
| Holidays | 3,265 | Home (procurement), Gantt, delay card, reports | memory + AsyncStorage, 24 h, keyed by year |
| Task types | 2,878 | Flowchart, Gantt, Home, printouts | memory + AsyncStorage, 24 h |
| Projects (id, name) | 3,476 + 5,254 (settings row) | ProjectContext, Home, settings, attendance check-in | memory per session; settings (shift, geofence) for 10 min |
| Departments (`works`) | — | DPR entry, Flowchart, departments | memory per project, 10 min, cleared on edit |
| Contacts / project contacts | — | Contacts, MoM recipient picker | stale-while-revalidate |
| Own profile / role | — | AuthContext | already in memory; could be persisted for an instant cold start |

Removing the holidays and task-types round trips takes **1 wave off Home,
Gantt and DPR entry**. Caching projects lets ProjectGate render at once.

### 14. Timeouts — **partly**

- **App → Supabase: missing globally.**
  - `lib/supabase.ts` creates the client with no `global.fetch` timeout.
  - `withTimeout` (`lib/withTimeout.ts`) is used only by Flowchart, Gantt,
    Task List and AuthContext. It races the promise but **doesn't cancel**
    the request.
  - On a bad site network, every other screen can spin until the operating
    system gives up, often 60 s or more.
  - **Fix (S):** pass a `fetch` wrapper using `AbortSignal.timeout`: about
    20 s for REST and RPC, longer for Storage and Functions uploads.
- **Edge Functions → external APIs:**

  | Call | Where | Timeout |
  |---|---|---|
  | Whapi send | `_shared/whapi.ts:259` | **done** (AbortController) |
  | Expo push | `send-push-notification/index.ts:63` | **missing** |
  | Expo push + Resend | `send-zone-alert/index.ts:92,113` | **missing** |
  | Resend (welcome / reset email) | `manage-user/index.ts:131` | **missing** |
  | `send-broadcast-push` | invoked by `lib/broadcastPush.ts` | **unknown**: its source isn't in any repo checkout |
  | Meta (WhatsApp Cloud API) | — | n/a: not used (Whapi instead) |

  **Fix (S):** `signal: AbortSignal.timeout(10_000)` on each `fetch`.
  Server-only, so no app build is needed.

### 15. Slow work while the user waits

- **DPR photo add** (`dpr-edit:446-464`): the user waits for the whole
  sequence while a spinner shows:
  1. resize and re-encode on the JS thread;
  2. base64 upload through the Edge Function;
  3. site-photo record;
  4. reload of all photos with N signed URLs.

  **Fix (M):** show the local file at once, upload in the background with a
  small retry queue, and append the one new photo instead of reloading.
  Uses expo-file-system, which is already installed.
- **Attendance clock-in:** 4 round trips (item 2).
- **PDF export and printing** (`expo-print`): expected to wait; already has
  progress state.
- **Home realtime refetch:** a full reload of 3 datasets on any checklist
  change anywhere (H8; throttle it, or skip while Home isn't focused).

---

## 4. Database (live, read-only)

Statistics were reset on 22 June 2026, so the counts below cover about
4.5 months. `pg_stat_statements` is available.

### 16. Indexes

- **RLS policy cost (new, high as data grows).**
  - 149 of 150 policies call helper functions (`current_app_role()`,
    `current_client_project_id()` and others). Only 7 wrap any of them in
    `(select …)`.
  - Unwrapped, Postgres calls the helper **once per row, per table in the
    embed**, and each call looks up `user_profiles` by email. This explains
    **30.3 million sequential scans on the 16-row `user_profiles`** and
    4.3 million on `dependency_completions`.
  - **Measured:** the Home client-alerts query takes 1.5 ms without RLS and
    **15 ms with RLS** as a staff user today (630 rows), and the cost grows
    linearly with rows.
  - **Fix (M, database only, no app build):** a migration that rewrites each
    policy to `(select current_app_role()) <> 'client'` and so on. This is
    Supabase's `auth_rls_initplan` advisor. The results are identical, but
    review it and run the access test suite.
  - **Also:** `projects` and `user_profiles` each have 2 permissive SELECT
    policies for `authenticated`, so both are evaluated. Merge them.
- **Unindexed foreign keys:** 47. The ones that matter for app queries:
  - `works.project_id`: every project-scoped tasks query filters on it via
    the embed. Tiny today, but it is the main project filter.
  - `tasks.milestone_id`
  - `dpr_entries.submitted_by`, `dpr_entries.subtask_work_id`
  - `dpr_edit_requests.project_id`
  - `whatsapp_group_reads.group_id`: the primary key is
    `(user_id, group_id)`, which is fine for per-user reads.

  The other ~40 are audit columns (`created_by`, `resolved_by_id`, …). They
  only matter when a referenced user or row is deleted. Low.
- **Duplicate indexes:** none.
- **Unused indexes:** 30, all 16 KB primary or unique keys on tiny tables.
  Nothing to drop.

### 17. Top queries from the app (`authenticated` role)

The `authenticated` role accounts for 238,635 calls and 1,740 s of database
time.

**By total time:**

| # | Query (PostgREST) | Calls | Mean | Share of app DB time | Source |
|---|---|---|---|---|---|
| 1 | `dependency_items` (category = client) + task → work → project + completions | 2,926 | **371 ms** | **62 %** | `lib/dependencyAlerts.ts` `fetchAllPendingClientAlerts` (Home, H8) |
| 2 | `tasks` + work (project) + checklist items (quantity) | 328 | 375 ms | 7 % | project task lists with checklist quantities (procurement / DPR) |
| 3 | same shape, more columns | 93 | 752 ms | 4 % | same family |
| 4 | same shape with `actual_*` dates | 100 | 676 ms | 4 % | same family |
| 5 | `tasks` + task type (Flowchart / Gantt list) | 2,029 | 29 ms | 3.4 % | `lib/flowchart/data.ts`, `projectTimeline.ts` |
| 6 | `tasks` (id, status, due date) + work | 2,000 | 27 ms | 3.1 % | Home `projectStats` (H8) |
| 7 | `dependency_items` client alerts (variant) | 120 | 285 ms | 2 % | same as #1 |
| 8 | `user_profiles` force_logout_at, gps_locked_at by email | **23,196** | 0.9 ms | 1.1 % | `lib/forceLogoutWatch.ts` |
| 9 | `hvac_tasks` + work | 950 | 19 ms | 1 % | old table name, not referenced in current app or admin-web code: older installed builds |
| 10 | `tasks` + work + checklist items (another shape) | 44 | 388 ms | 1 % | — |
| 11 | `task_dependencies` (all, paged) | 441 | 20 ms | 0.5 % | H9 |
| 12 | `task_dependencies` type = FS (all) | 365 | 19 ms | 0.4 % | H9, ancestor walk |
| 13 | `task_parallel_links` (all) | 440 | 15 ms | 0.4 % | H9 |
| 14 | `dependency_items` (task_id, category) + completion | 276 | 24 ms | 0.4 % | checklist summaries |
| 15 | `tasks` detail columns | 834 | 7.5 ms | 0.4 % | task detail |

**By frequency:**

| Rank | Query | Calls |
|---|---|---|
| 1 | PostgREST's per-request `set_config` | 100,424 (one per API call) |
| 2 | Force-logout poll | 23,196 |
| 3 | Force-logout (older shape) | 8,822 |
| 4 | Project settings row | 5,254 |
| 5 | Projects (id, name) | 3,476 |
| 6 | Holidays | 3,265 |
| 7 | Client alerts | 2,926 |
| 8 | Task types | 2,878 |

**Why the averages run high:** today the #1 query takes about 15 ms. The
371 ms mean covers the period when `dependency_items` was much larger
(47,084 inserts since the reset, 630 rows now). That is exactly how RLS
per-row cost and H8's "load everything" grow together. Wrapping the policy
calls (item 16) and H8's SQL-side counts address #1–#7.

### 18. Fast-growing tables the app reads

| Table | Rows now | Inserts since reset | App's common filter | Indexed? |
|---|---|---|---|---|
| `dependency_items` | 630 | 47,084 | `category`, `task_id` | `(task_id, category)`: yes. `category` alone (Home all-projects alerts): no, fixed by H8's per-project filter |
| `dependency_completions` | 574 | 6,421 | `item_id` | yes |
| `activity_log` | 1,780 | 1,837 | app writes only | `task_id`, `created_at`: yes (**RLS off**, §0.2) |
| `attendance_records` | 98 | 105 | `user_id` + `client_captured_at`, `project_id` | yes |
| `dpr_entries` | 5 | 84 | `task_id` + `report_date`, `submitted_at` | yes |
| `dpr_entry_subtasks`, `dpr_entry_photos` | 88 / few | — | `task_id` (+ date / type) | yes |
| `whatsapp_messages` | 469 | 640 | `group_id`, `wa_timestamp DESC` | yes (keyset) |
| `location_pings` | 240 | 266 | `user_id`, `occurred_at` | yes (no limit in `dayTimeline.ts`, Low list) |
| `critical_alert_messages` | 80 | 95 | `recipient_id`, `project_id` + `created_at` | yes |
| geofence / zone / location-disabled alerts | 43–67 | 73–82 | `user_id` + date, `project_id` | `user_id` and `project_id` separately; fine at this size; `(user_id, entered_at)` composites once batched (item 10) |
| `notifications` | — | — | — | table doesn't exist (screen is dummy) |

---

## 5. Monitoring

### 19. Sentry — **missing (tracing off)**

- `lib/sentryInit.ts:26` initialises errors and breadcrumbs only. There is no
  `tracesSampleRate`, so performance tracing is off, deliberately, per the
  comment. Replay is off (good). It is disabled entirely in the web dev
  build.
- `Sentry.wrap(RootLayout)` is in place (`app/_layout.tsx:186`).
- **Fix (S, JS only):**
  - `tracesSampleRate: 0.1` and
    `integrations: [Sentry.reactNavigationIntegration()]`, registered with
    expo-router's navigation container. That gives screen load time, slow
    and frozen frames and app start in production, the real-device
    counterpart to §1.2.
  - Keep `sendDefaultPii: false`.
  - 10 % sampling keeps the quota small with ~20 users.

---

## 6. Top 10 fixes (impact ÷ effort)

**Builds:** the app has **no OTA updates** (`expo-updates` isn't installed),
so every app-side change ships as a new Play build. "Native" means it also
needs a new native module or native config (prebuild); "JS" means
JavaScript only.

**Ship windows:**
- **During the 14-day test:** low risk, behaviour unchanged. Database-only
  and Edge-Function-only fixes need no app build at all.
- **v37:** changes to core data loading, per the rule in
  `TODO-performance.md` that results must stay identical, verified on real
  data.

| # | Fix | Impact | Size | Build | When |
|---|---|---|---|---|---|
| 1 | Stop the fetch loop: `useMemo` in `useLatestRequest` (§0.1) | **Critical**: battery, data, database load on 4 screens | S | JS | **Now**, before any new build |
| 2 | Wrap RLS helper calls in `(select …)`; merge the duplicate permissive policies (item 16) | High: up to ~10× less database time per row on every RLS read; grows with data | M (mechanical, 150 policies) | none (migration) | During the test: database only, reviewed migration, then run the access tests |
| 3 | Timeouts on Expo push / Resend `fetch` in Edge Functions (item 14) | Medium: a hung provider can't hold a function to its limit | S | none (redeploy named functions) | During the test |
| 4 | Global request timeout in `lib/supabase.ts` (item 14) | High on site networks: no endless spinners | S | JS | During the test (20 s REST, longer for uploads) |
| 5 | Cache holidays, task types, projects and project settings (item 13) | Medium: −1 wave on Home, Gantt and DPR entry; ProjectGate instant | S–M | JS | v37 |
| 6 | Batch the per-engineer attendance queries (item 10) | Medium–high: ~45 requests → ~4 | M | JS | v37 |
| 7 | DPR list `Promise.all` (M7) plus parallel delay-card stages (item 9) | Medium: ≈360 ms off DPR list, ≈240 ms off DPR entry | S | JS | v37 (planned M7) |
| 8 | Attendance clock-in: 4 → 2 round trips (item 2) | Medium: the most-used button, ≈240 ms | S | JS | v37 (attendance rules are sensitive) |
| 9 | Sentry tracing at 10 % (item 19) | Medium: real-device numbers to verify everything above | S | JS | During the test |
| 10 | Skeletons on DPR list, Attendance, Task List, Flowchart, Gantt, Project Dashboard (item 1) | Medium (perceived speed) | M | JS | During the test (UI only) |

**Next tier:**
- Photo upload in the background with a direct signed upload (item 15, M,
  JS, v37).
- `xlsx` out of the bundle (item 8, M, JS, v37).
- WAV → OGG notification sounds (item 8, S, **native**, v37).
- `React.memo` `DprTaskRow` and add `daily-updates` to M8 (S, JS, v37).
- Remove the duplicate `milestones` fetch on Flowchart (S, JS, during the
  test).

**Separate from performance, but urgent:** the RLS-disabled tables (§0.2).
This is a database migration that must add policies before enabling RLS.

---

## 7. Already planned (don't duplicate)

From `docs/TODO-performance.md`, all for v37:

| ID | Topic | Confirmed by this audit |
|---|---|---|
| H8 | Home loads every task in every project; realtime refetch unfiltered | yes: query #1 / #6 / #7, all tasks fetched twice on Home |
| H9 | Flowchart / Gantt / reports load all task links | yes: queries #11–#13 |
| H10 | DPR lists load every project task, filter in JS | yes |
| M7 | Daily Updates: 4 sequential queries | yes: 5 waves, 1.4 s measured |
| M8 | ScrollView + map lists | yes; **add** `daily-updates.tsx` and Project Dashboard |
| M9 | Gantt renders every task twice | yes |
| M10 | Flowchart re-renders every node on pan / zoom | yes (culling exists; memo missing) |
| M11 | One signed URL per photo / file; full-size thumbnails | yes; also double JPEG encode and base64 upload (item 7) |
| M12 | Task List refetches on every task update | not re-measured |
| M13 | Leave log unbounded, full reload on insert | not re-measured |
| M14 | Notification bell downloads full lists to count | yes (`site_issues` on every layout mount) |
| Low | CriticalAlertPopup 30 s poll; force-logout 60 s poll; full DPR history; department counts; MoM tab refetch; `location_pings` no limit | force-logout poll confirmed as the most frequent app query (23,196 calls) |

**New in this audit:**
- §0.1 fetch loop
- §0.2 RLS-disabled tables
- RLS initplan cost (item 16)
- Team Attendance N+1 (item 10)
- No global request timeout (item 14)
- Edge Function provider timeouts (item 14)
- Reference-data cache (item 13)
- Duplicate fetches on DPR entry and Flowchart (item 11)
- Attendance / DPR submit round trips (item 2)
- Upload path (item 7 / item 15)
- `xlsx` and WAV weight (item 8)
- Sentry tracing (item 19)
- Skeleton coverage (item 1)
