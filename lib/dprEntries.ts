import { supabase } from './supabase';
import { isPilotVisible } from './pilot';
import { uploadDprPhoto } from './dprPhotoUpload';

// Daily Progress Report — points 1-6, 8, and 9 (see
// app/(authenticated)/daily-updates.tsx and its own header comment — the
// DPR tab's single screen, no separate landing page + form). Point
// 7 (quality checklist PDF + signed photo) lives in lib/dprChecklist.ts
// instead, a separate concern from this per-task row data. Replaces the old
// freeform 3-slot daily_progress_reports flow entirely with a per-task,
// once-a-day form driven by this app's real task/checklist data instead of
// its own duplicated fields.

export type TaskStatus = 'draft' | 'ready' | 'in_progress' | 'on_hold' | 'blocked' | 'completed';

// The DPR's own "who is this task currently blocked by" options — a
// DELIBERATELY smaller, separate set from the checklist's own
// DependencyCategory (architect/client/consultant/contractor/inspector/
// procurement/quantity/quality_*) — see add-dpr-entries.sql's own comment
// on why "vendor" isn't just reusing "procurement" as the same value.
// 'other' pairs with DprEntryFields.dependencyOtherText for a free-typed
// reason, by explicit request — same pattern as DprComment's own
// preset='other'+text. A normal multi-select chip like the rest; selecting
// it just also reveals a text field (see DprTaskRow / app/dpr-edit/[taskId].tsx).
export type DprDependencyCategory = 'architect' | 'client' | 'consultant' | 'contractor' | 'vendor' | 'other';
export const DPR_DEPENDENCY_CATEGORIES: DprDependencyCategory[] = ['architect', 'client', 'consultant', 'contractor', 'vendor', 'other'];
export const DPR_DEPENDENCY_LABEL: Record<DprDependencyCategory, string> = {
  architect: 'Architect',
  client: 'Client',
  consultant: 'Consultant',
  contractor: 'Contractor',
  vendor: 'Vendor',
  other: 'Other',
};

// 'other' shows its own typed-in reason instead of the generic "Other"
// chip label once one's been entered — same idea as Comments' own preset
// 'other' rendering comment.text instead of DPR_COMMENT_LABEL.other. Shared
// by DprTaskRow.tsx and app/dpr-edit/[taskId].tsx rather than duplicated.
export function dependencyDisplayLabel(cat: DprDependencyCategory, otherText: string | null): string {
  return cat === 'other' && otherText ? otherText : DPR_DEPENDENCY_LABEL[cat];
}

// Point 8's Comments preset list, as approved — 'other' is the only one
// paired with a free-typed commentText; every other preset's label IS the
// full comment (add-dpr-comments.sql).
export type DprCommentPreset =
  | 'awaiting_material_delivery'
  | 'awaiting_client_approval'
  | 'awaiting_drawing_clarification'
  | 'awaiting_vendor_confirmation'
  | 'awaiting_payment_clearance'
  | 'awaiting_inspection_signoff'
  | 'labour_shortage'
  | 'equipment_unavailable'
  | 'weather_delay'
  | 'site_access_blocked'
  | 'rework_required'
  | 'coordination_pending'
  | 'other';

export const DPR_COMMENT_PRESETS: DprCommentPreset[] = [
  'awaiting_material_delivery',
  'awaiting_client_approval',
  'awaiting_drawing_clarification',
  'awaiting_vendor_confirmation',
  'awaiting_payment_clearance',
  'awaiting_inspection_signoff',
  'labour_shortage',
  'equipment_unavailable',
  'weather_delay',
  'site_access_blocked',
  'rework_required',
  'coordination_pending',
  'other',
];

export const DPR_COMMENT_LABEL: Record<DprCommentPreset, string> = {
  awaiting_material_delivery: 'Awaiting material delivery',
  awaiting_client_approval: 'Awaiting client approval',
  awaiting_drawing_clarification: 'Awaiting drawing/design clarification',
  awaiting_vendor_confirmation: 'Awaiting vendor confirmation',
  awaiting_payment_clearance: 'Awaiting payment clearance',
  awaiting_inspection_signoff: 'Awaiting inspection/quality sign-off',
  labour_shortage: 'Labour shortage on site',
  equipment_unavailable: 'Equipment/machinery unavailable',
  weather_delay: 'Weather delay',
  site_access_blocked: 'Site access blocked',
  rework_required: 'Rework required',
  coordination_pending: 'Coordination pending with parallel task',
  other: 'Other — type your own',
};

export interface DprComment {
  preset: DprCommentPreset;
  text: string | null; // populated only when preset === 'other'
}

// Status values where Comments + Dependency are point 8's mandatory pair —
// i.e. everything except actually being worked on or done.
export function isDprPending(status: TaskStatus): boolean {
  return status !== 'in_progress' && status !== 'completed';
}

export interface DprTask {
  id: string;
  taskCode: string;
  taskName: string;
  workName: string; // "Department"
  workId: string | null;
  status: TaskStatus;
  // Effective (live) planned span — current_planned_start_date/
  // current_due_date if a cascade has touched them, else the original
  // planned_start_date/due_date. Null if either half is genuinely unset
  // (that task can't be said to be "scheduled" any specific week/day).
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  // Real Quantity of Work — the 'Quantity Of Work Done' DependencyItem
  // (category='quantity'), NOT Task.totalSft/sft_progress_entries. Null
  // quantityItemId means this task has no such checklist item at all
  // (shouldn't happen for a real seeded task, but guarded rather than
  // assumed).
  quantityItemId: string | null;
  quantityDone: number | null;
  quantityUnit: string | null;
  scheduledToday: boolean;
}

interface RawQuantityItem {
  id: string;
  item_label: string;
  quantity_value: string | number | null;
  quantity_unit: string | null;
}

interface RawTaskRow {
  id: string;
  task_id: string;
  task_name: string;
  status: TaskStatus;
  planned_start_date: string | null;
  due_date: string | null;
  current_planned_start_date: string | null;
  current_due_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  assigned_to: string | null;
  urgent_pushed_at: string | null;
  work: { id: string; name: string; code: string | null; project_id: string } | { id: string; name: string; code: string | null; project_id: string }[] | null;
  dependency_items: RawQuantityItem[] | null;
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

const TASK_SELECT = `
  id, task_id, task_name, status,
  planned_start_date, due_date, current_planned_start_date, current_due_date,
  actual_start_date, actual_end_date, assigned_to, urgent_pushed_at,
  work:works!inner(id, name, code, project_id),
  dependency_items(id, item_label, quantity_value, quantity_unit)
`;

// Pending tab's own prerequisite-checklist summary — by explicit request:
// a Pending task should show its taskId/department plus which checklist
// CATEGORIES still have unfulfilled items and how many (e.g. "Architect: 3
// pending"), not the full DPR entry row. Tapping through to /task/[taskId]
// (already built — see that screen's own dependency checklist section)
// covers "click inside to see what's delayed" — no new detail screen
// needed. Excludes the 'quantity' category on purpose — that's a tracked
// quantity figure, not a blocking prerequisite, so it doesn't belong in a
// "still waiting on" summary.
export interface PendingChecklistGroup {
  category: string;
  pendingCount: number;
}

interface RawPendingItemRow {
  task_id: string;
  category: string;
  completion: { status: string } | { status: string }[] | null;
}

export async function fetchPendingChecklistSummaries(taskIds: string[]): Promise<Record<string, PendingChecklistGroup[]>> {
  if (taskIds.length === 0) return {};
  const { data, error } = await supabase
    .from('dependency_items')
    .select('task_id, category, completion:dependency_completions(status)')
    .in('task_id', taskIds)
    .neq('category', 'quantity');
  if (error) throw new Error(error.message);

  const byTask: Record<string, Record<string, number>> = {};
  for (const row of (data ?? []) as unknown as RawPendingItemRow[]) {
    const completion = Array.isArray(row.completion) ? row.completion[0] : row.completion;
    const status = completion?.status ?? 'PENDING'; // no completion row yet = PENDING, same convention as ChecklistItem.hadCompletionRow
    if (status === 'YES' || status === 'PROCEED') continue; // done — not part of this summary
    const groups = byTask[row.task_id] ?? {};
    groups[row.category] = (groups[row.category] ?? 0) + 1;
    byTask[row.task_id] = groups;
  }

  const result: Record<string, PendingChecklistGroup[]> = {};
  for (const [taskId, groups] of Object.entries(byTask)) {
    result[taskId] = Object.entries(groups).map(([category, pendingCount]) => ({ category, pendingCount }));
  }
  return result;
}

// PostgREST caps a single response at 1000 rows by default — see
// lib/reports/taskList.ts's own comment on the exact bug this silent
// truncation already caused once; paged the same way here.
const PAGE_SIZE = 1000;

function toDprTask(row: RawTaskRow, todayKey: string): DprTask {
  const work = normalizeToOne(row.work);
  const plannedStartDate = row.current_planned_start_date ?? row.planned_start_date;
  const plannedEndDate = row.current_due_date ?? row.due_date;
  const quantityItem = (row.dependency_items ?? []).find((i) => i.item_label === 'Quantity Of Work Done') ?? null;
  return {
    id: row.id,
    taskCode: row.task_id,
    taskName: row.task_name,
    workName: work?.name ?? 'Unassigned',
    workId: work?.id ?? null,
    status: row.status,
    plannedStartDate,
    plannedEndDate,
    actualStartDate: row.actual_start_date,
    actualEndDate: row.actual_end_date,
    quantityItemId: quantityItem?.id ?? null,
    quantityDone: quantityItem?.quantity_value != null ? Number(quantityItem.quantity_value) : null,
    quantityUnit: quantityItem?.quantity_unit ?? null,
    // Real planned window includes today, OR the task is actively
    // in_progress/on_hold — by explicit correction: a task that's fallen
    // behind its own planned window (common in real construction) shouldn't
    // silently vanish from daily DPR reporting just because the calendar
    // plan is stale. Only affects which tasks SHOW here — doesn't touch
    // plannedStartDate/plannedEndDate themselves, so "planned days"/target%
    // math everywhere else stays correct off the real dates.
    // Every task on the flowchart that isn't completed shows in the DPR, by
    // explicit request (2026-11-09): a task whose planned window is in the
    // past or future can still have any of its days filled in from its own
    // DPR 1..N pager, so hiding it by date only got in the way.
    scheduledToday: row.status !== 'completed',
  };
}

// One task by id, plus its project id (needed by several of this task's own
// report/works fetches) — the data behind the standalone DPR edit/history
// page (app/dpr-edit/[taskId].tsx), which
// can't receive a task object as a prop the way DprTaskRow.tsx's old inline
// form did, since navigation params are just a taskId string.
export async function fetchDprTaskById(taskId: string, todayKey: string): Promise<{ task: DprTask; projectId: string | null } | null> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq('id', taskId)
    .eq('dependency_items.category', 'quantity')
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as RawTaskRow;
  const work = normalizeToOne(row.work);
  return { task: toDprTask(row, todayKey), projectId: work?.project_id ?? null };
}

async function fetchAllProjectTasks(projectId: string): Promise<RawTaskRow[]> {
  const all: RawTaskRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('work.project_id', projectId)
      .eq('dependency_items.category', 'quantity')
      .is('deleted_at', null)
      .order('task_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RawTaskRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

// This week's real scheduled set (point 3's "week bucket") — every
// non-completed task whose effective [plannedStartDate, plannedEndDate]
// span overlaps [weekStartKey, weekEndKey] at all, not just ones starting
// inside the week. Today's subset (scheduledToday, point 3's "day bucket")
// is flagged per-task rather than fetched separately, since it's always a
// subset of this same week query.
export async function fetchWeekDprTasks(
  projectId: string,
  weekStartKey: string,
  weekEndKey: string,
  todayKey: string
): Promise<DprTask[]> {
  const rows = await fetchAllProjectTasks(projectId);
  return rows
    .filter((row) => isPilotVisible(row.task_id, normalizeToOne(row.work)?.code))
    .filter((row) => row.status !== 'completed') // point 5 — auto-hide, checked live every fetch
    // No date filter any more — every non-completed task comes back (see
    // toDprTask's scheduledToday). Upcoming/Week still narrow this list by
    // their own planned-date checks on the screen; weekStartKey/weekEndKey
    // stay in the signature for callers.
    .map((row) => toDprTask(row, todayKey));
}

// DPR's own "Urgent" tab — tasks an admin pushed to THIS engineer from the
// flowchart's multi-select (pushTasksUrgent, lib/flowchart/data.ts),
// regardless of whether the task is actually scheduled today; urgency is
// exactly the case where it might not be. Scoped to the currently
// selected project (same as every other DPR fetch) and to this one
// engineer specifically (assigned_to), not every urgent task project-wide.
export async function fetchUrgentTasksForEngineer(projectId: string, engineerId: string, todayKey: string): Promise<DprTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq('work.project_id', projectId)
    .eq('dependency_items.category', 'quantity')
    .eq('assigned_to', engineerId)
    .not('urgent_pushed_at', 'is', null)
    .neq('status', 'completed')
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RawTaskRow[];
  return rows
    .filter((row) => isPilotVisible(row.task_id, normalizeToOne(row.work)?.code))
    .map((row) => toDprTask(row, todayKey));
}

// Point 6's separate Completed Tasks tab — status = completed AND actually
// finished within the window (actual_end_date, the real field; a task can
// carry status='completed' with a null actual_end_date only in a data
// anomaly, in which case it's excluded here rather than shown with a
// blank date).
export async function fetchCompletedDprTasks(projectId: string, sinceKey: string): Promise<DprTask[]> {
  const rows = await fetchAllProjectTasks(projectId);
  return rows
    .filter((row) => isPilotVisible(row.task_id, normalizeToOne(row.work)?.code))
    .filter((row) => row.status === 'completed' && row.actual_end_date != null && row.actual_end_date >= sinceKey)
    .map((row) => toDprTask(row, sinceKey))
    .sort((a, b) => (b.plannedEndDate ?? '').localeCompare(a.plannedEndDate ?? ''));
}

// Task Status — writes through update_task_status(), a single shared
// Postgres function that ports admin-web's own updateTaskStatus rules
// (completed-lock, ready-before-in-progress, cross-trade FS/SS/FF/SF
// prerequisite gating, write-once actual dates) — see add-dpr-entries.sql.
// Deliberately NOT a plain `.from('tasks').update(...)`, which would let
// mobile silently bypass every one of those rules.
export async function updateTaskStatusRpc(taskId: string, status: TaskStatus): Promise<void> {
  const { error } = await supabase.rpc('update_task_status', { p_task_id: taskId, p_status: status });
  if (error) throw new Error(error.message);
}

// Actual Start Date — the task's own real field, same write path the
// Flowchart's TaskDetailSheet already uses (lib/flowchart/data.ts). A
// manual entry here (task not yet in_progress) and update_task_status's
// own auto-capture (on entering in_progress) both write the same column;
// whichever happens first wins, the other becomes a no-op once it's set.
export { updateTaskActualDate } from './flowchart/data';

// Quantity of Work — the task's own real DependencyItem row, same write
// path the checklist screen already uses (lib/taskDetail/data.ts).
export { updateItemQuantity, createQuantityDoneItem } from './taskDetail/data';

// Subtask used to live here as a single subtask/subtaskWorkId pair — by
// explicit request, a day can now have SEVERAL subtasks, each with its own
// text and Department, so that moved out to its own DprSubtaskItem list
// (fetchSubtasksForTask/fetchTodaySubtasks/createSubtask/updateSubtask/
// deleteSubtask below) instead of a field on this interface. The old
// dpr_entries.subtask/subtask_work_id columns still exist with their real
// history (migrated into dpr_entry_subtasks by add-dpr-entry-subtasks.sql's
// own backfill) but nothing writes to them anymore.
export interface DprEntryFields {
  dependencyCategories: DprDependencyCategory[];
  // Free-typed reason, populated only when 'other' is one of
  // dependencyCategories — null otherwise, same convention as
  // DprComment.text only being set for preset 'other'.
  dependencyOtherText: string | null;
  comment: DprComment | null;
  // Day's % of the task's total work done, 0-100 — the task's full
  // duration is the 100% baseline (e.g. a 4-day task = ~25%/day), by
  // explicit request. Null = not logged for this day yet.
  percentComplete: number | null;
  // Manpower for this task's day — planned (targeted) vs. who actually
  // showed up (actual). Both optional/null until the site engineer logs
  // them; only surfaced on reports when the project's admin has turned on
  // showWorkforceOnReport.
  targetedWorkforcePerDay: number | null;
  actualWorkforcePerDay: number | null;
  // Who last saved this row and when — null on a brand-new, never-saved
  // entry. Used to show admin a real "Submitted by X · <time>" line
  // instead of the same blank always-editable form a site engineer gets;
  // see DprTaskRow's own isAdmin review-mode.
  submittedByName: string | null;
  submittedAtISO: string | null;
  // Distinct from submittedAtISO above (which is really just updated_at,
  // "last touched") — this is dpr_entries.submitted_at, set only once by
  // the "Submit Today's DPR" action passing validation. Null means still
  // freely editable; non-null is what locks the form for a non-admin (see
  // DprTaskRow.tsx's own isLockedForEngineer) until an admin approves a
  // "Contact Admin" edit request for this same (task, day).
  dprSubmittedAtISO: string | null;
  // Free-typed notes relaying what the architect/client said, separate from
  // the site engineer's own `comment` above — by explicit request, its own
  // pair of plain text boxes on the DPR form.
  architectComment: string | null;
  clientComment: string | null;
  // One comment per selected Reason for Delay, keyed by category — by
  // explicit request (2026-11-09). dpr_entries.delay_reason_comments.
  delayReasonComments: Partial<Record<DprDependencyCategory, string>>;
}

const EMPTY_ENTRY: DprEntryFields = {
  dependencyCategories: [],
  dependencyOtherText: null,
  comment: null,
  percentComplete: null,
  targetedWorkforcePerDay: null,
  actualWorkforcePerDay: null,
  submittedByName: null,
  submittedAtISO: null,
  dprSubmittedAtISO: null,
  architectComment: null,
  clientComment: null,
  delayReasonComments: {},
};

// Dependency (points 1-6) + Comment (point 8) + daily % Complete — fields
// with no other real home (see add-dpr-entries.sql's own comment on why
// Actual Start Date/Quantity of Work are NOT duplicated onto this table).
// One row per (task, day), upserted so re-submitting today's DPR for a
// task updates its own row rather than creating a new one.
export async function fetchTodayDprEntries(taskIds: string[], todayKey: string): Promise<Record<string, DprEntryFields>> {
  if (taskIds.length === 0) return {};
  const { data, error } = await supabase
    .from('dpr_entries')
    .select(
      'task_id, dependency_categories, dependency_other_text, comment_preset, comment_text, percent_complete, targeted_workforce_per_day, actual_workforce_per_day, submitted_by, updated_at, submitted_at, architect_comment, client_comment, delay_reason_comments'
    )
    .in('task_id', taskIds)
    .eq('report_date', todayKey);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    task_id: string;
    dependency_categories: DprDependencyCategory[];
    dependency_other_text: string | null;
    comment_preset: DprCommentPreset | null;
    comment_text: string | null;
    percent_complete: number | null;
    targeted_workforce_per_day: number | null;
    actual_workforce_per_day: number | null;
    submitted_by: string | null;
    updated_at: string | null;
    submitted_at: string | null;
    architect_comment: string | null;
    client_comment: string | null;
    delay_reason_comments: Partial<Record<DprDependencyCategory, string>> | null;
  }[];

  const submitterIds = [...new Set(rows.map((r) => r.submitted_by).filter((id): id is string => id != null))];
  const nameById = new Map<string, string>();
  if (submitterIds.length > 0) {
    const { data: profiles } = await supabase.from('user_profiles').select('id, full_name').in('id', submitterIds);
    for (const p of (profiles ?? []) as { id: string; full_name: string }[]) nameById.set(p.id, p.full_name);
  }

  const map: Record<string, DprEntryFields> = {};
  for (const row of rows) {
    map[row.task_id] = {
      dependencyCategories: row.dependency_categories ?? [],
      dependencyOtherText: row.dependency_other_text,
      comment: row.comment_preset ? { preset: row.comment_preset, text: row.comment_text } : null,
      percentComplete: row.percent_complete,
      targetedWorkforcePerDay: row.targeted_workforce_per_day,
      actualWorkforcePerDay: row.actual_workforce_per_day,
      submittedByName: row.submitted_by ? (nameById.get(row.submitted_by) ?? 'Unknown user') : null,
      submittedAtISO: row.updated_at,
      dprSubmittedAtISO: row.submitted_at,
      architectComment: row.architect_comment,
      clientComment: row.client_comment,
      delayReasonComments: row.delay_reason_comments ?? {},
    };
  }
  return map;
}

export interface DprHistoryEntry {
  reportDate: string;
  fields: DprEntryFields;
}

// Every real DPR entry ever submitted for ONE task, oldest first — the
// data behind the "DPR 1 of N, Prev/Next" day pager (app/dpr-edit/[taskId].tsx),
// by explicit request: a task that's had 4 days of DPR should let both the
// site engineer and admin page through all 4 and edit/save any of them, not
// just today's. Same row shape as fetchTodayDprEntries, just scoped to one
// task across every report_date instead of many tasks on one date.
export async function fetchAllDprEntriesForTask(taskId: string): Promise<DprHistoryEntry[]> {
  const { data, error } = await supabase
    .from('dpr_entries')
    .select(
      'report_date, dependency_categories, dependency_other_text, comment_preset, comment_text, percent_complete, targeted_workforce_per_day, actual_workforce_per_day, submitted_by, updated_at, submitted_at, architect_comment, client_comment, delay_reason_comments'
    )
    .eq('task_id', taskId)
    // Overall-progress rows have their own card, not a day in the pager.
    .eq('is_overall', false)
    .order('report_date', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    report_date: string;
    dependency_categories: DprDependencyCategory[];
    dependency_other_text: string | null;
    comment_preset: DprCommentPreset | null;
    comment_text: string | null;
    percent_complete: number | null;
    targeted_workforce_per_day: number | null;
    actual_workforce_per_day: number | null;
    submitted_by: string | null;
    updated_at: string | null;
    submitted_at: string | null;
    architect_comment: string | null;
    client_comment: string | null;
    delay_reason_comments: Partial<Record<DprDependencyCategory, string>> | null;
  }[];

  const submitterIds = [...new Set(rows.map((r) => r.submitted_by).filter((id): id is string => id != null))];
  const nameById = new Map<string, string>();
  if (submitterIds.length > 0) {
    const { data: profiles } = await supabase.from('user_profiles').select('id, full_name').in('id', submitterIds);
    for (const p of (profiles ?? []) as { id: string; full_name: string }[]) nameById.set(p.id, p.full_name);
  }

  return rows.map((row) => ({
    reportDate: row.report_date,
    fields: {
      dependencyCategories: row.dependency_categories ?? [],
      dependencyOtherText: row.dependency_other_text,
      comment: row.comment_preset ? { preset: row.comment_preset, text: row.comment_text } : null,
      percentComplete: row.percent_complete,
      targetedWorkforcePerDay: row.targeted_workforce_per_day,
      actualWorkforcePerDay: row.actual_workforce_per_day,
      submittedByName: row.submitted_by ? (nameById.get(row.submitted_by) ?? 'Unknown user') : null,
      submittedAtISO: row.updated_at,
      dprSubmittedAtISO: row.submitted_at,
      architectComment: row.architect_comment,
      clientComment: row.client_comment,
      delayReasonComments: row.delay_reason_comments ?? {},
    },
  }));
}

// Always writes the full row (all fields) so a change to any one of them
// never clobbers the others — callers pass the merged next-state, not a
// partial patch (see app/(authenticated)/daily-updates.tsx's
// handleChangeDependencies/handleChangeComment/handleChangePercentComplete,
// which read the current entry out of state before calling this). Despite
// the name, this writes to whichever report_date is passed in — reused
// as-is by app/dpr-edit/[taskId].tsx to save an edit to any past day's entry,
// not just "today's."
export async function upsertTodayDprEntry(
  taskId: string,
  todayKey: string,
  fields: DprEntryFields,
  submittedBy: string | null
): Promise<void> {
  const { error } = await supabase.from('dpr_entries').upsert(
    {
      task_id: taskId,
      report_date: todayKey,
      dependency_categories: fields.dependencyCategories,
      dependency_other_text: fields.dependencyCategories.includes('other') ? fields.dependencyOtherText : null,
      comment_preset: fields.comment?.preset ?? null,
      comment_text: fields.comment?.preset === 'other' ? fields.comment.text : null,
      percent_complete: fields.percentComplete,
      targeted_workforce_per_day: fields.targetedWorkforcePerDay,
      actual_workforce_per_day: fields.actualWorkforcePerDay,
      submitted_by: submittedBy,
      architect_comment: fields.architectComment,
      client_comment: fields.clientComment,
      // Only comments for reasons still selected are kept.
      delay_reason_comments: Object.fromEntries(
        Object.entries(fields.delayReasonComments ?? {}).filter(([cat, text]) => fields.dependencyCategories.includes(cat as DprDependencyCategory) && !!text?.trim())
      ),
    },
    { onConflict: 'task_id,report_date' }
  );
  if (error) throw new Error(error.message);
}

// "Submit Today's DPR" locking a task's row, by explicit request — this
// previously wrote nothing to the database at all (pure client-side
// validation gate). Called once per validated task when that button is
// pressed; DprTaskRow.tsx's own isLockedForEngineer is what actually reads
// this back to gate further edits for a non-admin.
export async function markDprSubmitted(taskId: string, todayKey: string): Promise<void> {
  const { data, error } = await supabase
    .from('dpr_entries')
    .update({ submitted_at: new Date().toISOString() })
    .eq('task_id', taskId)
    .eq('report_date', todayKey)
    .select('id');
  if (error) throw new Error(error.message);
  // An UPDATE that matches no row is not an error in PostgREST — catch it, so
  // a day whose draft never saved can't look submitted.
  if (!data || data.length === 0) throw new Error("this day's DPR wasn't saved yet");
}

export { EMPTY_ENTRY as EMPTY_DPR_ENTRY };

// ─── Pre-construction gate (supabase/preconstruction-gate.sql) ────────────
// A task enters the DPR / construction phase only once its whole checklist
// is done — the database moves it draft/blocked -> ready at that point and
// refuses DPR entries / Actual Start / manual status changes before then.
export function inPreconstruction(status: TaskStatus): boolean {
  return status === 'draft' || status === 'blocked';
}

export async function fetchChecklistProgress(taskId: string): Promise<{ done: number; total: number }> {
  const { data, error } = await supabase
    .from('dependency_items')
    .select('id, is_mandatory, completion:dependency_completions(status)')
    .eq('task_id', taskId);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as unknown as { is_mandatory: boolean; completion: { status: string } | { status: string }[] | null }[]).filter(
    (r) => r.is_mandatory !== false
  );
  // Cleared = Issued (YES / legacy PROCEED) or Not Required (NO) — same rule
  // as the database's recalculate_task_status().
  const done = rows.filter((r) => {
    const c = Array.isArray(r.completion) ? r.completion[0] : r.completion;
    return c?.status === 'YES' || c?.status === 'PROCEED' || c?.status === 'NO';
  }).length;
  return { done, total: rows.length };
}

// ─── Submission History (admin, DPR tab) ──────────────────────────────────
// Real submitted DPRs (submitted_at set) for one project, newest first.
// Soft-deleted tasks (incl. archived flowchart-only sets) are excluded.
export interface DprSubmission {
  key: string;
  taskName: string;
  workName: string;
  status: TaskStatus;
  reportDate: string;
  submittedAtISO: string;
  submittedByName: string | null;
  isOverall: boolean;
  percentComplete: number | null;
  dependencies: DprDependencyCategory[];
  commentPreset: DprCommentPreset | null;
}

export async function fetchDprSubmissionHistory(projectId: string, limit = 50): Promise<DprSubmission[]> {
  const { data, error } = await supabase
    .from('dpr_entries')
    .select(
      'task_id, report_date, submitted_at, submitted_by, is_overall, percent_complete, dependency_categories, comment_preset, task:tasks!inner(task_name, status, deleted_at, work:works!inner(name, project_id))'
    )
    .not('submitted_at', 'is', null)
    .is('task.deleted_at', null)
    .eq('task.work.project_id', projectId)
    .order('submitted_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  type Row = {
    task_id: string;
    report_date: string;
    submitted_at: string;
    submitted_by: string | null;
    is_overall: boolean;
    percent_complete: number | null;
    dependency_categories: DprDependencyCategory[] | null;
    comment_preset: DprCommentPreset | null;
    task: { task_name: string; status: TaskStatus; deleted_at: string | null; work: { name: string } | { name: string }[] | null } | null;
  };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.task && !r.task.deleted_at);

  const ids = [...new Set(rows.map((r) => r.submitted_by).filter((id): id is string => !!id))];
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase.from('user_profiles').select('id, full_name').in('id', ids);
    for (const p of (profiles ?? []) as { id: string; full_name: string }[]) nameById.set(p.id, p.full_name);
  }

  return rows.map((r) => {
    const work = Array.isArray(r.task!.work) ? r.task!.work[0] : r.task!.work;
    return {
      key: `${r.task_id}|${r.report_date}`,
      taskName: r.task!.task_name,
      workName: work?.name ?? '',
      status: r.task!.status,
      reportDate: r.report_date,
      submittedAtISO: r.submitted_at,
      submittedByName: r.submitted_by ? (nameById.get(r.submitted_by) ?? 'Unknown user') : null,
      isOverall: r.is_overall,
      percentComplete: r.percent_complete,
      dependencies: r.dependency_categories ?? [],
      commentPreset: r.comment_preset,
    };
  });
}

// ─── Overall progress (2026-11-09) ─────────────────────────────────────────
// One total % for the whole task (0-100) plus Reasons for Delay with a
// comment each, entered once from the top of the DPR screen instead of
// filling every planned day. Stored as an ordinary dpr_entries row dated the
// day it's saved, flagged is_overall, whose percent_complete is just that
// day's share — so the existing reports, which add up percent_complete
// across all of a task's rows, show exactly the overall % typed, and the
// reasons/comments appear on that date in the date-range reports.
export interface OverallProgress {
  // Sum of every DPR row's percent_complete for the task, capped at 100.
  overallPercent: number;
  // Reasons + comments from the most recent overall entry.
  reasons: DprDependencyCategory[];
  comments: Partial<Record<DprDependencyCategory, string>>;
  savedOn: string | null;
  savedByName: string | null;
}

export async function fetchOverallProgress(taskId: string): Promise<OverallProgress> {
  const { data, error } = await supabase
    .from('dpr_entries')
    .select('report_date, percent_complete, is_overall, dependency_categories, delay_reason_comments, submitted_by')
    .eq('task_id', taskId)
    .order('report_date', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    report_date: string;
    percent_complete: number | null;
    is_overall: boolean;
    dependency_categories: DprDependencyCategory[] | null;
    delay_reason_comments: Partial<Record<DprDependencyCategory, string>> | null;
    submitted_by: string | null;
  }[];
  const total = Math.min(100, rows.reduce((s, r) => s + (r.percent_complete ?? 0), 0));
  const latest = rows.find((r) => r.is_overall) ?? null;
  let savedByName: string | null = null;
  if (latest?.submitted_by) {
    const { data: p } = await supabase.from('user_profiles').select('full_name').eq('id', latest.submitted_by).maybeSingle();
    savedByName = (p as { full_name: string } | null)?.full_name ?? null;
  }
  return {
    overallPercent: total,
    reasons: latest?.dependency_categories ?? [],
    comments: latest?.delay_reason_comments ?? {},
    savedOn: latest?.report_date ?? null,
    savedByName,
  };
}

// Saves today's overall entry so that the task's total becomes
// `overallPercent`. Today's row gets (overall - everything already recorded
// on other days). Throws if the overall would have to go DOWN below what
// earlier days already add up to (a past day's share can't be negative).
export async function saveOverallProgress(
  taskId: string,
  overallPercent: number,
  reasons: DprDependencyCategory[],
  comments: Partial<Record<DprDependencyCategory, string>>,
  userId: string | null
): Promise<void> {
  const todayKey = todayDateKey();
  const { data, error } = await supabase.from('dpr_entries').select('report_date, percent_complete').eq('task_id', taskId);
  if (error) throw new Error(error.message);
  const otherDays = ((data ?? []) as { report_date: string; percent_complete: number | null }[])
    .filter((r) => r.report_date !== todayKey)
    .reduce((s, r) => s + (r.percent_complete ?? 0), 0);
  const todayShare = Math.round(overallPercent) - otherDays;
  if (todayShare < 0) {
    throw new Error(`Earlier days already add up to ${otherDays}%, so the overall can't be set lower than that.`);
  }
  const keptComments = Object.fromEntries(
    Object.entries(comments).filter(([cat, text]) => reasons.includes(cat as DprDependencyCategory) && !!text?.trim()).map(([c, t]) => [c, t!.trim()])
  );
  const nowIso = new Date().toISOString();
  const { error: upErr } = await supabase.from('dpr_entries').upsert(
    {
      task_id: taskId,
      report_date: todayKey,
      is_overall: true,
      percent_complete: Math.min(100, todayShare),
      dependency_categories: reasons,
      dependency_other_text: reasons.includes('other') ? (keptComments.other ?? null) : null,
      delay_reason_comments: keptComments,
      submitted_by: userId,
      submitted_at: nowIso,
    },
    { onConflict: 'task_id,report_date' }
  );
  if (upErr) throw new Error(upErr.message);
}

// A day can have SEVERAL subtasks, each with its own free text and its own
// Department — by explicit request, replacing the old one-subtask-per-day
// dpr_entries.subtask/subtask_work_id fields (see add-dpr-entry-subtasks.sql).
// Independent of dpr_entries by design: a subtask routinely exists for a day
// before any other DPR field has ever been touched for it (e.g. pre-filled
// at task creation via CreateTaskSheet.tsx).
export interface DprSubtaskItem {
  id: string;
  taskId: string;
  reportDate: string;
  text: string;
  workId: string | null;
  sortOrder: number;
  // This subtask's own % complete (0-100), by explicit request — a day's
  // overall % Work Done is now the AVERAGE of its subtasks' own percents
  // (each subtask is an equal share of the task; a subtask at 75% out of,
  // say, 4 equal subtasks contributes 75%*25%=18.75% to the task's day
  // total), computed rather than typed once for the whole task. Null until
  // the site engineer has entered a number for this specific subtask.
  percentComplete: number | null;
}

interface RawSubtaskRow {
  id: string;
  task_id: string;
  report_date: string;
  text: string;
  work_id: string | null;
  sort_order: number;
  percent_complete: number | null;
}

function toSubtaskItem(row: RawSubtaskRow): DprSubtaskItem {
  return {
    id: row.id,
    taskId: row.task_id,
    reportDate: row.report_date,
    text: row.text,
    workId: row.work_id,
    sortOrder: row.sort_order,
    percentComplete: row.percent_complete,
  };
}

const SUBTASK_SELECT = 'id, task_id, report_date, text, work_id, sort_order, percent_complete';

// Every real subtask for one task across every day — the data behind the
// flowchart's Subtasks tab and DPR History's per-day list, both of which
// browse a task's full range of days at once. Grouping by report_date is
// left to the caller since each one's own day-range logic differs.
export async function fetchSubtasksForTask(taskId: string): Promise<DprSubtaskItem[]> {
  const { data, error } = await supabase
    .from('dpr_entry_subtasks')
    .select(SUBTASK_SELECT)
    .eq('task_id', taskId)
    .order('report_date', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawSubtaskRow[]).map(toSubtaskItem);
}

// Just today's subtasks for many tasks at once — the DPR list screen's own
// bulk fetch (same shape/purpose as fetchTodayDprEntries), scoped to a set
// of tasks + one date instead of one task across every date.
export async function fetchTodaySubtasks(taskIds: string[], todayKey: string): Promise<Record<string, DprSubtaskItem[]>> {
  if (taskIds.length === 0) return {};
  const { data, error } = await supabase
    .from('dpr_entry_subtasks')
    .select(SUBTASK_SELECT)
    .in('task_id', taskIds)
    .eq('report_date', todayKey)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  const map: Record<string, DprSubtaskItem[]> = {};
  for (const row of (data ?? []) as RawSubtaskRow[]) {
    const item = toSubtaskItem(row);
    (map[item.taskId] ??= []).push(item);
  }
  return map;
}

export async function createSubtask(
  taskId: string,
  reportDate: string,
  text: string,
  workId: string | null,
  sortOrder: number,
  percentComplete: number | null = null
): Promise<DprSubtaskItem> {
  const { data, error } = await supabase
    .from('dpr_entry_subtasks')
    .insert({ task_id: taskId, report_date: reportDate, text, work_id: workId, sort_order: sortOrder, percent_complete: percentComplete })
    .select(SUBTASK_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return toSubtaskItem(data as RawSubtaskRow);
}

export async function updateSubtask(
  id: string,
  patch: { text?: string; workId?: string | null; percentComplete?: number | null }
): Promise<void> {
  const update: { text?: string; work_id?: string | null; percent_complete?: number | null } = {};
  if (patch.text !== undefined) update.text = patch.text;
  if (patch.workId !== undefined) update.work_id = patch.workId;
  if (patch.percentComplete !== undefined) update.percent_complete = patch.percentComplete;
  const { error } = await supabase.from('dpr_entry_subtasks').update(update).eq('id', id);
  if (error) throw new Error(error.message);
}

// Per-subtask Actual Start Date (dpr_entry_subtasks.actual_start_date, see
// add-subtask-actual-start-date.sql). Deliberately NOT part of
// SUBTASK_SELECT: until that migration is run the column doesn't exist, and
// adding it there would break every subtask query in the app. A missing
// column just means "no per-subtask dates yet" here.
// Only a genuinely missing column (migration not run / API schema cache not
// yet reloaded) — any other error surfaces with its own real message.
function isMissingSubtaskStartColumn(message: string): boolean {
  return /actual_start_date/.test(message) && /(does not exist|could not find|schema cache)/i.test(message);
}

export async function fetchSubtaskActualStarts(ids: string[]): Promise<{ dates: Record<string, string | null>; columnMissing: boolean }> {
  if (ids.length === 0) return { dates: {}, columnMissing: false };
  const { data, error } = await supabase.from('dpr_entry_subtasks').select('id, actual_start_date').in('id', ids);
  if (error) return { dates: {}, columnMissing: isMissingSubtaskStartColumn(error.message) };
  const dates: Record<string, string | null> = {};
  for (const row of (data ?? []) as { id: string; actual_start_date: string | null }[]) dates[row.id] = row.actual_start_date;
  return { dates, columnMissing: false };
}

export async function updateSubtaskActualStart(id: string, isoDate: string | null): Promise<void> {
  const { error } = await supabase.from('dpr_entry_subtasks').update({ actual_start_date: isoDate }).eq('id', id);
  if (error) {
    if (isMissingSubtaskStartColumn(error.message)) {
      throw new Error('Per-subtask start dates need the add-subtask-actual-start-date.sql migration to be run first.');
    }
    throw new Error(error.message);
  }
}

export async function deleteSubtask(id: string): Promise<void> {
  const { error } = await supabase.from('dpr_entry_subtasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Point 9 — general daily progress photos, straight from a task's DPR row
// (not the printed/signed checklist copy — see lib/dprChecklist.ts's own
// signed-checklist photos, same table, different photo_type so the two
// galleries never mix). Each captioned "Photo N" + the date taken in the
// UI, oldest first, so numbering reads as an actual sequence.
export interface DailyProgressPhoto {
  id: string;
  storagePath: string;
  createdAtISO: string;
  signedUrl: string | null;
}

const DPR_PHOTO_BUCKET = 'dpr-photos';
const DPR_PHOTO_SIGNED_URL_TTL_SECONDS = 3600;

export async function fetchDailyProgressPhotos(taskId: string): Promise<DailyProgressPhoto[]> {
  const { data, error } = await supabase
    .from('dpr_entry_photos')
    .select('id, storage_path, created_at')
    .eq('task_id', taskId)
    .eq('photo_type', 'daily_progress')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; storage_path: string; created_at: string }[];
  return Promise.all(
    rows.map(async (r) => {
      const { data: signed } = await supabase.storage.from(DPR_PHOTO_BUCKET).createSignedUrl(r.storage_path, DPR_PHOTO_SIGNED_URL_TTL_SECONDS);
      return { id: r.id, storagePath: r.storage_path, createdAtISO: r.created_at, signedUrl: signed?.signedUrl ?? null };
    })
  );
}

export async function uploadDailyProgressPhoto(
  taskId: string,
  base64Data: string,
  contentType: 'image/jpeg' | 'image/png',
  uploadedBy: string | null
): Promise<void> {
  const storagePath = await uploadDprPhoto(base64Data, contentType);
  const { error } = await supabase
    .from('dpr_entry_photos')
    .insert({ task_id: taskId, storage_path: storagePath, uploaded_by: uploadedBy, photo_type: 'daily_progress' });
  if (error) throw new Error(error.message);
}

export function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysToKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "26 Aug 2026, Wednesday" — point 1.
export function formatHeaderDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const weekday = WEEKDAY_NAMES[new Date(`${key}T00:00:00Z`).getUTCDay()];
  return `${d} ${FULL_MONTHS[m - 1].slice(0, 3)} ${y}, ${weekday}`;
}

// Calendar week = Sunday-to-Saturday, matching this app's existing
// Sunday-skipping working-day convention elsewhere (lib/workingDays.ts).
// "Week N of <Month>" is the standard calendar reading — the 1st of the
// month falls in Week 1 regardless of which weekday it lands on, and the
// week number is always driven by TODAY's own date-of-month (not by
// whichever month its Sunday happens to fall in, for a week that spans a
// month boundary) — not an ISO week number.
export function weekRangeAndLabel(todayKey: string): { weekStartKey: string; weekEndKey: string; label: string } {
  const [y, m, d] = todayKey.split('-').map(Number);
  const today = new Date(`${todayKey}T00:00:00Z`);
  const weekStart = new Date(today);
  weekStart.setUTCDate(d - today.getUTCDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  const firstOfMonthWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const weekNumber = Math.ceil((d + firstOfMonthWeekday) / 7);

  return {
    weekStartKey: weekStart.toISOString().slice(0, 10),
    weekEndKey: weekEnd.toISOString().slice(0, 10),
    label: `Week ${weekNumber} of ${FULL_MONTHS[m - 1]}`,
  };
}

export { addDaysToKey };

// One slot per planned calendar day in [startKey, endKey] (e.g. a 4-day task
// always yields 4 entries), not just days that already have a real
// dpr_entries row — shared by app/dpr-edit/[taskId].tsx (the day pager) and
// TaskDetailSheet.tsx's own per-day Subtasks tab, so a day missing a real
// row still gets an empty, fully-editable/saveable placeholder rather than
// silently not appearing at all. Any real entry OUTSIDE the planned range
// (task ran long) is kept too, via the Set union below.
export function buildFullDayEntryList(real: DprHistoryEntry[], startKey: string | null, endKey: string | null): DprHistoryEntry[] {
  const byDate = new Map(real.map((e) => [e.reportDate, e]));
  const keys = new Set(byDate.keys());
  if (startKey && endKey && startKey <= endKey) {
    for (let k = startKey; k <= endKey; k = addDaysToKey(k, 1)) keys.add(k);
  }
  return [...keys].sort().map((k) => byDate.get(k) ?? { reportDate: k, fields: EMPTY_ENTRY });
}
