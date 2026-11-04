# Performance TODO (planned for v37)

From the November 2026 audit. Deferred on purpose: with today's data
(15 tasks, 13 task links, 0 parallel links, 3 projects) none of these is
noticeable yet, and they touch core data loading. Do them before a project
passes roughly 200 tasks, or before any table passes 1,000 rows — at that
point Supabase/PostgREST's default 1,000-row response cap makes some of these
**silently wrong**, not just slow.

Rule for all of them: results must stay exactly the same (same counts, same
tasks shown) — only faster. Any database change (view, RPC, index) goes in a
migration file and is reviewed before it is applied to the live database.

## High

### H8 — Home loads every task in every project
- **Where:** `lib/projectStats.ts` (`fetchAllProjectStats`), called by
  `components/home/AppHome.tsx`; `app/project-dashboard.tsx` also runs the
  all-projects version to show one project (`findProjectStat`). Also pulls
  `fetchAllPendingClientAlerts` and `fetchProcurementSchedule`
  (`lib/tasks/procurementSchedule.ts`), which loads all tasks again.
- **Problem:** 3 full-table reads per Home open, repeated on every
  `dependency_completions` change anywhere (`lib/dependencyCompletionsRealtime.ts`
  has no filter). Past 1,000 tasks the counts are silently wrong.
- **Fix:**
  1. A `project_stats` view or RPC that counts per project in SQL
     (total / completed / overdue / pending client responses).
  2. Project dashboard: pass `projectId` and filter with
     `.eq('work.project_id', id)`.
  3. Throttle the realtime refetch on Home to ~5–10 s, and skip it while
     Home isn't focused.
- **Related (M-level):** `lib/dependencyAlerts.ts` `fetchAllPendingClientAlerts`
  selects every client checklist item in every project and filters status in
  JS — filter by project, and filter completions server-side (or a
  `pending_client_items` view).

### H9 — Flowchart / Gantt load all task links in the system
- **Where:** `lib/flowchart/data.ts` (~line 121, also used by
  `app/(authenticated)/task-list.tsx`), `lib/projectTimeline.ts` (~line 131,
  Gantt + `components/home/ClientHome.tsx`), `lib/reports/taskReport.ts`
  (~line 261, pages through every finish-to-start link to walk one task's
  ancestors).
- **Problem:** `task_dependencies` / `task_parallel_links` fetched with no
  filter and no paging. Past 1,000 links, edges silently go missing.
- **Fix:** `.in('task_id', projectTaskIds)` (chunk the id list to keep URLs
  short) or an RPC `project_dependencies(project_id)`. Ancestor walk:
  a recursive-CTE RPC. Also: `lib/flowchart/data.ts` tasks query needs
  `.range()` paging and `.eq('hidden_from_flowchart', false)` server-side.

### H10 — DPR lists load every task in the project, filter in JS
- **Where:** `lib/dprEntries.ts` `fetchAllProjectTasks` (~line 268), used by
  `fetchWeekDprTasks` (status ≠ completed + week overlap, filtered in JS) and
  `fetchCompletedDprTasks` (status = completed + `actual_end_date >= since`,
  filtered in JS; used by `app/(authenticated)/completed-tasks.tsx`).
- **Fix:**
  - Completed: `.eq('status','completed').gte('actual_end_date', sinceKey)`.
  - Week: `.neq('status','completed')` plus the overlap condition on
    `coalesce(current_planned_start_date, planned_start_date)` /
    `coalesce(current_due_date, due_date)` — needs a generated column or an
    RPC to match the current JS logic exactly. Verify the same task list
    before/after on real data.

## Medium

### M7 — Daily Updates runs 4 independent queries one after another
- **Where:** `app/(authenticated)/daily-updates.tsx` (~line 213):
  `fetchTodayDprEntries`, `fetchTodaySubtasks`, `fetchPendingChecklistSummaries`,
  `fetchApprovedGrantsForToday`.
- **Fix:** one `Promise.all`. Also chunk `.in('task_id', allIds)` for large
  projects (URL length).

### M8 — Long lists use ScrollView + `.map`, no pagination
- **Where:** `app/(authenticated)/contacts.tsx`, `project-contacts.tsx`
  (also: `filtered` recomputed every render → `useMemo`), `documents.tsx`
  (list + task picker), `completed-tasks.tsx`,
  `components/flowchart/FilteredTaskList.tsx`, `components/reports/TaskPicker.tsx`,
  `dpr-edit-requests.tsx`, `devices.tsx`, `engineer-attendance.tsx`.
- **Fix:** `FlatList` (or FlashList) with `keyExtractor`,
  `initialNumToRender ≈ 12`, `windowSize ≈ 5`; `.range()` paging +
  `onEndReached` for contacts, documents, DPR edit requests.

### M9 — Gantt renders every task twice, no virtualisation
- **Where:** `components/gantt/GanttChart.tsx` (~208–232 labels, ~267–361
  bars; `flatMap` over all tasks every render at ~151).
- **Fix:** one vertical virtualised list driving both columns; memoise the
  `detailTask` lookup.

### M10 — Flowchart canvas re-renders every node on each pan/zoom
- **Where:** `components/flowchart/FlowchartCanvas.tsx`, `TaskNode.tsx`.
- **Fix:** `React.memo(TaskNode)`; stable `handleDragStart` / `handleTap`
  (`useCallback`); `useMemo` for `milestoneById` and the Pinch/Pan gestures;
  replace the 3 `runOnJS(...)` calls per gesture end with one
  `runOnJS(onSettle)()` that batches `recomputeGridArea` /
  `recomputeVisibleTasks` / `recomputePositionIndicator`; keep a pre-sorted
  task list in `useMemo` for the position indicator.

### M11 — One signed-URL request per photo / file; full-size thumbnails
- **Where:** `lib/documents.ts` (~66), `lib/dprEntries.ts` (~775),
  `lib/dprChecklist.ts` (~101); thumbnails in `app/dpr-edit/[taskId].tsx`
  and `app/dpr-checklist/[taskId].tsx`.
- **Fix:** batch with `createSignedUrls(paths, ttl)`; limit / page
  `documents`; `expo-image` with `cachePolicy="memory-disk"` keyed by
  storage path; Supabase image `transform: { width: 200 }` for thumbnails;
  limit DPR photos to the selected day.

### M12 — Task List refetches on every task update in every project
- **Where:** `app/(authenticated)/task-list.tsx` (~159) — unfiltered
  `tasks` UPDATE channel; each Flowchart drag triggers it.
- **Fix:** 1–2 s debounce; filter by the project's `work_id`s; ignore
  payloads whose changed columns aren't checklist-related; pause while not
  focused.

### M13 — Leave log unbounded, fully reloads on each insert
- **Where:** `lib/leaveEvents.ts` (~184, no limit), `app/(authenticated)/leave-log.tsx`
  (~298, unfiltered channel).
- **Fix:** `.range()` paging on scroll + a recent date window by default;
  on INSERT prepend the new row instead of reloading; filter the channel by
  `project_id` when one is set.

### M14 — Notification bell downloads full lists just to count
- **Where:** `components/NotificationBell.tsx` (~62–80) using
  `fetchUnresolvedSiteIssues` (`lib/siteIssues.ts`, all projects, 2 embeds).
  Also still subscribes to `restricted_zone_alerts` / `account_lockouts`
  while location features are off.
- **Fix:** `select('id', { count: 'exact', head: true }).eq('resolved', false)`;
  skip the location channels when `!LOCATION_FEATURES_ENABLED`.

## Also from the audit (Low)
- `components/CriticalAlertPopup.tsx` polls every 30 s → realtime INSERT
  channel filtered by `recipient_id` + 5-min fallback poll.
- `lib/forceLogoutWatch.ts` polls every 60 s even in background → guard with
  `AppState.currentState === 'active'` or raise to 3–5 min.
- `lib/dprEntries.ts` `fetchAllDprEntriesForTask` and
  `lib/reports/generalParameterReport.ts` fetch full DPR history; the report
  also runs a separate count on the same rows — derive the count.
- `lib/departments.ts` counts tasks per department in JS → `works(…, tasks(count))`.
- MoM tabs refetch project tasks on every tab switch → lift into `useMomData`.
- `lib/dayTimeline.ts` `location_pings` query has no limit (feature hidden
  now; fix before re-enabling location).
