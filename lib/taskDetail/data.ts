import { supabase } from '../supabase';
import {
  isComputedQuantityItem,
  MAX_DRAWING_REVISIONS,
  type AccountabilityType,
  type ApprovalOutcome,
  type CompletionStatus,
  type DependencyCategory,
  type QuantityUnit,
} from './constants';

export interface ChecklistItem {
  id: string;
  category: DependencyCategory;
  itemLabel: string;
  sortOrder: number;
  quantityUnit: QuantityUnit | null;
  quantityValue: number | null;
  status: CompletionStatus;
  // null = no dependency_completions row exists yet for this item (treated
  // as PENDING for display, same as admin-web) — kept so a status change
  // can record the correct oldStatus (null, not a fabricated "PENDING") in
  // dependency_status_history the first time an item is ever touched.
  hadCompletionRow: boolean;
  // When the CURRENT status was last set — dependency_completions.updated_at
  // already IS exactly this (upserted on every status change, see
  // updateItemStatus), no separate history read needed just to show it
  // inline. Null when no completion row exists yet (never changed).
  statusChangedAtISO: string | null;
  // When the CURRENT status actually happened, as opposed to
  // statusChangedAtISO (when someone logged it) — backdatable via the
  // status-change date picker, only ever set for a non-"done" status (see
  // isItemDone). 'YYYY-MM-DD', null when never backdated.
  issueDate: string | null;
  isComputedQuantity: boolean;
  // Drives whether the inline quick-add comment box shows (only when 0
  // comments exist yet) vs. the icon-opens-full-thread path — matches
  // admin-web's DefaultCommentBox condition exactly.
  commentCount: number;
}

// Checklist completion -> admin notification -> on-site verification.
// Set server-side (a Postgres trigger on dependency_completions, see
// prisma/add-checklist-verification.sql) the moment the last checklist item
// reaches YES/PROCEED — never written directly by this app. Null means the
// checklist is still in progress (not yet 100% complete); 'pending' means
// complete and awaiting an admin/manager's on-site review.
export type ChecklistVerificationStatus = 'pending' | 'verified' | 'needs_rework';

export interface TaskDetailInfo {
  id: string;
  taskCode: string;
  taskName: string;
  description: string | null;
  workName: string;
  workCode: string;
  // Threaded through so the checklist screen's own Critical Alert button
  // (see app/task/[taskId].tsx) can send straight to the RIGHT project's
  // admins regardless of whatever project happens to be globally selected
  // elsewhere in the app — this is the task's actual project, via its Work.
  projectId: string | null;
  projectName: string | null;
  // Task's own AC/AV override — resolved the same way the flowchart's
  // badge already resolves it (task override ?? work default), NOT
  // task-only, so the category-hiding rule agrees with whatever badge is
  // actually showing on this task's flowchart card.
  accountabilityType: AccountabilityType | null;
  checklistCompletedAtISO: string | null;
  checklistCompletedByName: string | null;
  verificationStatus: ChecklistVerificationStatus | null;
  verifiedByName: string | null;
  verifiedAtISO: string | null;
  verificationNote: string | null;
  // Procurement lead time — see PROCUREMENT_INPUT_PRESET_DAYS's own
  // comment. Null when the task has no Procurement Duration Type set, or
  // no planned start date to count back from (nothing to compute against).
  procurementTypeDurationDays: number | null;
  referenceStartDateISO: string | null;
  // The task's own real planned dates — by explicit request, shown on the
  // checklist screen itself, which previously had no date display at all.
  plannedStartDate: string | null;
  dueDate: string | null;
}

export interface TaskDetail {
  task: TaskDetailInfo;
  items: ChecklistItem[];
}

interface RawItemRow {
  id: string;
  category: DependencyCategory;
  item_label: string;
  sort_order: number;
  quantity_unit: QuantityUnit | null;
  quantity_value: string | number | null;
  completion:
    | { status: CompletionStatus; updated_at: string; issue_date: string | null }
    | { status: CompletionStatus; updated_at: string; issue_date: string | null }[]
    | null;
  comments: { count: number }[] | { count: number } | null;
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

// One fetch, joined all the way down — same "read the whole detail page in
// one round trip" shape as admin-web's own task/[taskId] page (which reads
// task + dependency_items + completions together too), just via PostgREST
// embeds instead of a Prisma include.
export async function fetchTaskDetail(taskId: string): Promise<TaskDetail> {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      id, task_id, task_name, description, accountability_type,
      planned_start_date, due_date, current_planned_start_date,
      checklist_completed_at, checklist_verification_status, checklist_verified_at, checklist_verification_note,
      work:works(name, code, accountability_type, project_id, project:projects(name)),
      task_type:task_types(default_duration_days),
      completed_by:user_profiles!tasks_checklist_completed_by_fkey(full_name),
      verified_by:user_profiles!tasks_checklist_verified_by_fkey(full_name),
      dependency_items(
        id, category, item_label, sort_order, quantity_unit, quantity_value,
        completion:dependency_completions(status, updated_at, issue_date),
        comments(count)
      )
    `)
    .eq('id', taskId)
    .single();

  if (error) throw new Error(error.message);

  const raw = data as unknown as {
    id: string;
    task_id: string;
    task_name: string;
    description: string | null;
    accountability_type: AccountabilityType | null;
    planned_start_date: string | null;
    due_date: string | null;
    current_planned_start_date: string | null;
    checklist_completed_at: string | null;
    checklist_verification_status: ChecklistVerificationStatus | null;
    checklist_verified_at: string | null;
    checklist_verification_note: string | null;
    work:
      | { name: string; code: string; accountability_type: AccountabilityType | null; project_id: string | null; project: { name: string } | { name: string }[] | null }
      | { name: string; code: string; accountability_type: AccountabilityType | null; project_id: string | null; project: { name: string } | { name: string }[] | null }[]
      | null;
    task_type: { default_duration_days: number } | { default_duration_days: number }[] | null;
    completed_by: { full_name: string } | { full_name: string }[] | null;
    verified_by: { full_name: string } | { full_name: string }[] | null;
    dependency_items: RawItemRow[] | null;
  };

  const work = normalizeToOne(raw.work);

  const items: ChecklistItem[] = (raw.dependency_items ?? [])
    .map((i) => {
      const completion = normalizeToOne(i.completion);
      return {
        id: i.id,
        category: i.category,
        itemLabel: i.item_label,
        sortOrder: i.sort_order,
        quantityUnit: i.quantity_unit,
        quantityValue: i.quantity_value == null ? null : Number(i.quantity_value),
        status: completion?.status ?? 'PENDING',
        hadCompletionRow: completion != null,
        statusChangedAtISO: completion?.updated_at ?? null,
        issueDate: completion?.issue_date ?? null,
        isComputedQuantity: isComputedQuantityItem(i.category, i.item_label),
        commentCount: normalizeToOne(i.comments)?.count ?? 0,
      };
    })
    .sort((a, b) => (a.category === b.category ? a.sortOrder - b.sortOrder : a.category.localeCompare(b.category)));

  return {
    task: {
      id: raw.id,
      taskCode: raw.task_id,
      taskName: raw.task_name,
      description: raw.description,
      workName: work?.name ?? 'Unassigned',
      workCode: work?.code ?? '—',
      projectId: work?.project_id ?? null,
      projectName: normalizeToOne(work?.project ?? null)?.name ?? null,
      accountabilityType: raw.accountability_type ?? work?.accountability_type ?? null,
      checklistCompletedAtISO: raw.checklist_completed_at,
      checklistCompletedByName: normalizeToOne(raw.completed_by)?.full_name ?? null,
      verificationStatus: raw.checklist_verification_status,
      verifiedByName: normalizeToOne(raw.verified_by)?.full_name ?? null,
      verifiedAtISO: raw.checklist_verified_at,
      verificationNote: raw.checklist_verification_note,
      procurementTypeDurationDays: normalizeToOne(raw.task_type)?.default_duration_days ?? null,
      referenceStartDateISO: raw.current_planned_start_date ?? raw.planned_start_date,
      plannedStartDate: raw.planned_start_date,
      dueDate: raw.due_date,
    },
    items,
  };
}

// Admin/manager only (enforced server-side by the RPC itself, not just this
// client) — reviews a fully-completed checklist on site. 'needs_rework'
// resets every item back to PENDING and clears checklistCompletedAt/By
// server-side too (see verify_task_checklist), so a fresh fetchTaskDetail
// after this call already reflects the reset checklist with no extra work
// here.
export async function verifyTaskChecklist(
  taskId: string,
  status: Exclude<ChecklistVerificationStatus, 'pending'>,
  note: string | null
): Promise<void> {
  const { error } = await supabase.rpc('verify_task_checklist', { p_task_id: taskId, p_status: status, p_note: note });
  if (error) throw new Error(error.message);
}

// ── Admin review queue ──────────────────────────────────────────────────
// Every checklist currently awaiting on-site verification for one project —
// Task List's admin/manager-only "Pending Review" toggle. `work:works!inner`
// is required (not just `work:works`) for `.eq('work.project_id', ...)` to
// actually filter rows rather than just shape the embed — same pattern
// fetchFlowchartData already relies on (lib/flowchart/data.ts's TASK_SELECT).
export interface PendingChecklistVerification {
  id: string;
  taskCode: string;
  taskName: string;
  workName: string;
  completedAtISO: string;
  completedByName: string | null;
}

interface RawPendingRow {
  id: string;
  task_id: string;
  task_name: string;
  checklist_completed_at: string;
  completed_by: { full_name: string } | { full_name: string }[] | null;
  work: { name: string; project_id: string } | { name: string; project_id: string }[] | null;
}

export async function fetchPendingChecklistVerifications(projectId: string): Promise<PendingChecklistVerification[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      id, task_id, task_name, checklist_completed_at,
      completed_by:user_profiles!tasks_checklist_completed_by_fkey(full_name),
      work:works!inner(name, project_id)
    `)
    .eq('checklist_verification_status', 'pending')
    .eq('work.project_id', projectId)
    .is('deleted_at', null)
    .order('checklist_completed_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawPendingRow[]).map((r) => ({
    id: r.id,
    taskCode: r.task_id,
    taskName: r.task_name,
    workName: normalizeToOne(r.work)?.name ?? 'Unassigned',
    completedAtISO: r.checklist_completed_at,
    completedByName: normalizeToOne(r.completed_by)?.full_name ?? null,
  }));
}

// ── Dependencies (predecessors/successors/parallel) ───────────────────────
// Reuses the SAME task_dependencies/task_parallel_links tables Flowchart's
// own fetchFlowchartData already reads (lib/flowchart/data.ts) — no second
// dependency model. Two-step fetch (raw edge rows, then a batched lookup of
// the referenced tasks' names) instead of a PostgREST embed, because a
// single task_dependencies row references `tasks` twice (task_id AND
// depends_on_task_id) and PostgREST can't embed the same table twice off
// one row without a constraint-name hint this app doesn't otherwise rely
// on elsewhere — matching fetchFlowchartData's own choice to join edges to
// tasks client-side rather than via embed.
export interface TaskDependencyRef {
  id: string;
  taskCode: string;
  taskName: string;
  // Only set for predecessors/successors (task_dependencies has a type;
  // task_parallel_links doesn't distinguish types, it's symmetric).
  type: 'FS' | 'SS' | 'FF' | 'SF' | null;
}

export interface TaskDependencies {
  predecessors: TaskDependencyRef[];
  successors: TaskDependencyRef[];
  parallel: TaskDependencyRef[];
}

export async function fetchTaskDependencies(taskId: string): Promise<TaskDependencies> {
  const [predRes, succRes, parallelRes] = await Promise.all([
    supabase.from('task_dependencies').select('depends_on_task_id, type').eq('task_id', taskId),
    supabase.from('task_dependencies').select('task_id, type').eq('depends_on_task_id', taskId),
    supabase.from('task_parallel_links').select('task_a_id, task_b_id').or(`task_a_id.eq.${taskId},task_b_id.eq.${taskId}`),
  ]);
  if (predRes.error) throw new Error(predRes.error.message);
  if (succRes.error) throw new Error(succRes.error.message);
  if (parallelRes.error) throw new Error(parallelRes.error.message);

  const predEdges = (predRes.data ?? []) as { depends_on_task_id: string; type: 'FS' | 'SS' | 'FF' | 'SF' }[];
  const succEdges = (succRes.data ?? []) as { task_id: string; type: 'FS' | 'SS' | 'FF' | 'SF' }[];
  const parallelEdges = (parallelRes.data ?? []) as { task_a_id: string; task_b_id: string }[];

  const referencedIds = Array.from(
    new Set([
      ...predEdges.map((e) => e.depends_on_task_id),
      ...succEdges.map((e) => e.task_id),
      ...parallelEdges.map((e) => (e.task_a_id === taskId ? e.task_b_id : e.task_a_id)),
    ])
  );
  if (referencedIds.length === 0) return { predecessors: [], successors: [], parallel: [] };

  const { data: taskRows, error: taskErr } = await supabase.from('tasks').select('id, task_id, task_name').in('id', referencedIds);
  if (taskErr) throw new Error(taskErr.message);
  const taskMap = new Map((taskRows ?? []).map((t) => [t.id as string, { taskCode: t.task_id as string, taskName: t.task_name as string }]));

  function toRef(id: string, type: 'FS' | 'SS' | 'FF' | 'SF' | null): TaskDependencyRef | null {
    const t = taskMap.get(id);
    if (!t) return null; // referenced task deleted/inaccessible — silently drop rather than show a broken row
    return { id, taskCode: t.taskCode, taskName: t.taskName, type };
  }

  return {
    predecessors: predEdges.map((e) => toRef(e.depends_on_task_id, e.type)).filter((r): r is TaskDependencyRef => r != null),
    successors: succEdges.map((e) => toRef(e.task_id, e.type)).filter((r): r is TaskDependencyRef => r != null),
    parallel: parallelEdges
      .map((e) => toRef(e.task_a_id === taskId ? e.task_b_id : e.task_a_id, null))
      .filter((r): r is TaskDependencyRef => r != null),
  };
}

// Two sequential writes, not one atomic transaction — this app's Supabase
// client is a plain PostgREST/RLS-scoped client with no multi-statement
// transaction support, unlike admin-web's own updateDependencyCompletion
// (which wraps both writes in one Prisma $transaction via its direct
// superuser DB connection). A failure between the two calls would leave the
// completion updated but no history row for that specific change — a small,
// accepted non-atomicity gap here, same pragmatic tradeoff already made by
// e.g. updateTaskActualDate not replicating the planned-date cascade.
// issueDate ('YYYY-MM-DD') is when the status actually happened — backdatable,
// distinct from `now`/completed_at/changed_at below which record when this
// was entered into the system — only meaningful for a non-"done" status
// (see StatusPicker's own isItemDone gate for when it's even asked for), so
// callers pass null for a plain "simply checking it off." Mirrors
// admin-web's updateDependencyCompletion validation exactly.
export async function updateItemStatus(
  itemId: string,
  newStatus: CompletionStatus,
  previousStatus: CompletionStatus | null,
  userId: string,
  issueDate?: string | null
): Promise<string> {
  if (issueDate && new Date(issueDate) > new Date()) throw new Error('Issue date cannot be in the future');

  const now = new Date().toISOString();
  const { error: upsertErr } = await supabase.from('dependency_completions').upsert(
    {
      item_id: itemId,
      status: newStatus,
      completed_by: userId,
      completed_at: now,
      updated_at: now,
      issue_date: issueDate ?? null,
    },
    { onConflict: 'item_id' }
  );
  if (upsertErr) throw new Error(upsertErr.message);

  if (previousStatus === newStatus) return now; // no-op change, no history row — matches admin-web

  const { error: histErr } = await supabase.from('dependency_status_history').insert({
    dependency_item_id: itemId,
    old_status: previousStatus,
    new_status: newStatus,
    changed_by: userId,
    issue_date: issueDate ?? null,
  });
  if (histErr) throw new Error(histErr.message);
  return now;
}

// Mirrors admin-web's updateDependencyItemLabel exactly, including the
// activity_log write — same shared activity feed either app's edit shows up
// in, same audit-trail principle already applied elsewhere (account
// reactivation, Leave approval) — a silent, untracked rename left no record
// if one turned out to be wrong or disputed later.
export async function updateItemLabel(itemId: string, taskId: string, newLabel: string, userId: string | null): Promise<void> {
  const trimmed = newLabel.trim();
  if (trimmed.length < 3) throw new Error('Label must be at least 3 characters');

  const { data: existing, error: fetchErr } = await supabase
    .from('dependency_items')
    .select('item_label')
    .eq('id', itemId)
    .single();
  if (fetchErr) throw new Error(fetchErr.message);
  if (existing.item_label === trimmed) return; // no-op edit, nothing to log

  const { error } = await supabase.from('dependency_items').update({ item_label: trimmed }).eq('id', itemId);
  if (error) throw new Error(error.message);

  try {
    // Best-effort, matching admin-web's own .catch(() => {}) on this same
    // write — a failed audit-log insert shouldn't undo or block the rename
    // that already succeeded above.
    await supabase.from('activity_log').insert({
      task_id: taskId,
      user_id: userId,
      action_type: 'checklist_item_label_update',
      payload: { itemId, oldLabel: existing.item_label, newLabel: trimmed },
    });
  } catch {
    // Ignored — see comment above.
  }
}

export async function updateItemQuantity(itemId: string, unit: QuantityUnit, value: number): Promise<void> {
  const { error } = await supabase.from('dependency_items').update({ quantity_unit: unit, quantity_value: value }).eq('id', itemId);
  if (error) throw new Error(error.message);
}

// Creates the task's 'Quantity Of Work Done' item (category='quantity') when
// it doesn't exist yet, so the DPR form's Quantity of Work box can always
// save instead of silently no-oping on a task that was never seeded with one.
export async function createQuantityDoneItem(taskId: string, unit: QuantityUnit, value: number): Promise<string> {
  const { data, error } = await supabase
    .from('dependency_items')
    .insert({ task_id: taskId, category: 'quantity', item_label: 'Quantity Of Work Done', quantity_unit: unit, quantity_value: value })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

// Hard delete, matching admin-web's own deleteDependencyItem exactly (a
// bare prisma.dependencyItem.delete, no soft-delete/archive flag) — its
// dependency_completions/comments/drawing_revisions/dependency_status_history
// rows all cascade-delete automatically via each one's onDelete: Cascade FK
// on dependencyItemId, same as admin-web relies on implicitly.
export async function deleteChecklistItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('dependency_items').delete().eq('id', itemId);
  if (error) throw new Error(error.message);
}

// ── Comments ────────────────────────────────────────────────────────────

export interface ItemComment {
  id: string;
  body: string;
  createdAtISO: string;
  authorName: string | null;
}

interface RawCommentRow {
  id: string;
  body: string;
  created_at: string;
  author: { full_name: string } | { full_name: string }[] | null;
}

export async function fetchItemComments(itemId: string): Promise<ItemComment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('id, body, created_at, author:user_profiles(full_name)')
    .eq('dependency_item_id', itemId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawCommentRow[]).map((r) => ({
    id: r.id,
    body: r.body,
    createdAtISO: r.created_at,
    authorName: normalizeToOne(r.author)?.full_name ?? null,
  }));
}

// Posting a comment isn't a privileged action on admin-web either (its own
// createComment allows any authenticated user, no role check) — authorId
// may be null (unattributed) rather than rejected, same as admin-web.
export async function createItemComment(itemId: string, body: string, authorId: string | null): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Comment cannot be empty');
  const { error } = await supabase.from('comments').insert({ dependency_item_id: itemId, body: trimmed, author_id: authorId });
  if (error) throw new Error(error.message);
}

// ── Drawing revisions ───────────────────────────────────────────────────

export interface DrawingRevisionRow {
  id: string;
  revisionNumber: number;
  fileName: string;
  uploadedAtISO: string;
  uploaderName: string | null;
}

interface RawDrawingRevisionRow {
  id: string;
  revision_number: number;
  file_name: string;
  uploaded_at: string;
  uploader: { full_name: string } | { full_name: string }[] | null;
}

export async function fetchDrawingRevisions(itemId: string): Promise<DrawingRevisionRow[]> {
  const { data, error } = await supabase
    .from('drawing_revisions')
    .select('id, revision_number, file_name, uploaded_at, uploader:user_profiles(full_name)')
    .eq('dependency_item_id', itemId)
    .order('revision_number', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawDrawingRevisionRow[]).map((r) => ({
    id: r.id,
    revisionNumber: r.revision_number,
    fileName: r.file_name,
    uploadedAtISO: r.uploaded_at,
    uploaderName: normalizeToOne(r.uploader)?.full_name ?? null,
  }));
}

// fileUrl is a placeholder string, not a real upload — matching admin-web
// exactly (see its own drawing-revisions action comment: "Storage is a
// dummy placeholder for now"). Only the file NAME the user typed is ever
// persisted; there's no real file storage wired up on either platform yet,
// so this app doesn't add a document-picker native dependency for a feature
// that wouldn't actually store real bytes anywhere either way.
export async function uploadDrawingRevision(
  itemId: string,
  fileName: string,
  uploadedBy: string,
  currentMaxRevision: number
): Promise<DrawingRevisionRow> {
  // 0-indexed (2026-08-17) — first revision is R0, total count stays 5
  // (R0-R4), matching admin-web's mirrored cap on the same shared table.
  if (currentMaxRevision >= MAX_DRAWING_REVISIONS - 1) throw new Error(`Maximum ${MAX_DRAWING_REVISIONS} revisions reached for this item.`);
  const nextRevision = currentMaxRevision + 1;
  const fileUrl = `placeholder://drawing-revisions/${itemId}/r${nextRevision}/${encodeURIComponent(fileName)}`;
  const { data, error } = await supabase
    .from('drawing_revisions')
    .insert({ dependency_item_id: itemId, revision_number: nextRevision, file_name: fileName, file_url: fileUrl, uploaded_by: uploadedBy })
    .select('id, revision_number, file_name, uploaded_at')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, revisionNumber: data.revision_number, fileName: data.file_name, uploadedAtISO: data.uploaded_at, uploaderName: null };
}

// ── Approval rounds — the A0/A1/A2/... counterpart to drawing revisions ───

export interface ApprovalRoundRow {
  id: string;
  approvalNumber: number;
  outcome: ApprovalOutcome;
  note: string | null;
  recordedAtISO: string;
  recorderName: string | null;
}

interface RawApprovalRoundRow {
  id: string;
  approval_number: number;
  outcome: ApprovalOutcome;
  note: string | null;
  recorded_at: string;
  recorder: { full_name: string } | { full_name: string }[] | null;
}

export async function fetchApprovalRounds(itemId: string): Promise<ApprovalRoundRow[]> {
  const { data, error } = await supabase
    .from('dependency_approvals')
    .select('id, approval_number, outcome, note, recorded_at, recorder:user_profiles(full_name)')
    .eq('dependency_item_id', itemId)
    .order('approval_number', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawApprovalRoundRow[]).map((r) => ({
    id: r.id,
    approvalNumber: r.approval_number,
    outcome: r.outcome,
    note: r.note,
    recordedAtISO: r.recorded_at,
    recorderName: normalizeToOne(r.recorder)?.full_name ?? null,
  }));
}

export async function recordApprovalRound(
  itemId: string,
  outcome: ApprovalOutcome,
  note: string | null,
  recordedBy: string,
  currentMaxNumber: number
): Promise<ApprovalRoundRow> {
  const nextNumber = currentMaxNumber + 1;
  const { data, error } = await supabase
    .from('dependency_approvals')
    .insert({ dependency_item_id: itemId, approval_number: nextNumber, outcome, note: note || null, recorded_by: recordedBy })
    .select('id, approval_number, outcome, note, recorded_at')
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id,
    approvalNumber: data.approval_number,
    outcome: data.outcome,
    note: data.note,
    recordedAtISO: data.recorded_at,
    recorderName: null,
  };
}

// ── Status history ──────────────────────────────────────────────────────

export interface StatusHistoryEntry {
  id: string;
  oldStatus: CompletionStatus | null;
  newStatus: CompletionStatus;
  changedAtISO: string;
  changedByName: string | null;
  // When this specific transition actually happened (backdatable) — see
  // ChecklistItem.issueDate's own comment. 'YYYY-MM-DD', null when this
  // change wasn't backdated (or predates the feature).
  issueDate: string | null;
}

interface RawHistoryRow {
  id: string;
  old_status: CompletionStatus | null;
  new_status: CompletionStatus;
  changed_at: string;
  issue_date: string | null;
  changer: { full_name: string } | { full_name: string }[] | null;
}

export async function fetchStatusHistory(itemId: string): Promise<StatusHistoryEntry[]> {
  const { data, error } = await supabase
    .from('dependency_status_history')
    .select('id, old_status, new_status, changed_at, issue_date, changer:user_profiles(full_name)')
    .eq('dependency_item_id', itemId)
    .order('changed_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawHistoryRow[]).map((r) => ({
    id: r.id,
    oldStatus: r.old_status,
    newStatus: r.new_status,
    changedAtISO: r.changed_at,
    changedByName: normalizeToOne(r.changer)?.full_name ?? null,
    issueDate: r.issue_date,
  }));
}
