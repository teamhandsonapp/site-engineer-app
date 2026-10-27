import { supabase } from '../supabase';
import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABEL,
  STATUS_CHIP,
  STATUS_ORDER,
  isCategoryNotRequired,
  isItemDone,
  type AccountabilityType,
  type CompletionStatus,
  type DependencyCategory,
  type QuantityUnit,
} from '../taskDetail/constants';

// Ported from admin-web's lib/data/task-report.ts getTaskReportData() — same
// 6 parameters, same formulas, just PostgREST embeds instead of a Prisma
// include and scoped to the current project (see lib/reports/taskList.ts's
// own comment on why: admin-web's own version is unscoped across every
// project, a gap this port doesn't repeat).

export interface StatusBreakdownEntry {
  status: CompletionStatus;
  label: string;
  color: string;
  count: number;
}

export interface DepartmentCompletionEntry {
  category: DependencyCategory;
  label: string;
  color: string;
  done: number;
  total: number;
  // The real, still-pending items in this category, each with its most
  // recent real comment (from the item's own Comment thread) when one
  // exists — added for Pre Construction's own "Reasons for Delays" list
  // (General Parameter report), which previously showed a single generic
  // sentence instead of which items are actually open and why.
  // Only real delays: Pending / On Hold / Revisions. Issued (YES/PROCEED)
  // and Not Required (NO) are left out, by explicit request.
  pendingItems: { label: string; comment: string | null; statusLabel: string }[];
  // Real status-change timestamps off this category's own items — added
  // for Pre Construction's own "Actual Procurement Start/End" (General
  // Parameter report, procurement/vendor category specifically). No
  // separate "actual procurement date" field exists anywhere in the
  // schema — this is the earliest/latest real dependency_status_history
  // entry across the category's items instead of a fabricated one.
  // firstActivityAtISO is set the moment ANY item in the category first
  // changes status; lastActivityAtISO is just the latest one, meaningful
  // as a real "finished on" date only once done === total (the caller's
  // job to check, not this layer's).
  firstActivityAtISO: string | null;
  lastActivityAtISO: string | null;
}

export type DelaySource = 'own' | 'upstream' | 'none';

export interface TaskDelayInfo {
  plannedStart: string | null;
  plannedEnd: string | null;
  actualOrProjectedStart: string | null;
  actualOrProjectedEnd: string | null;
  // Whether the *Start/*End values above are the real recorded actual dates
  // vs. a projected (current planned) fallback — drives the "Actual" vs.
  // "Projected" row label in DelayComparisonChart.
  hasActualStart: boolean;
  hasActualEnd: boolean;
  totalDelayDays: number;
  source: DelaySource;
  causedByTaskCode: string | null;
  causedByTaskName: string | null;
}

export interface TaskQuantityInfo {
  unit: QuantityUnit | null;
  targeted: number;
  done: number;
  pending: number;
  excess: number;
  // done/pending/excess above default to 0 when that checklist row was
  // never created (see fetchTaskReport below) — a REAL confirmed "0" and a
  // "this was never entered" fallback both render as the number 0, which
  // the debug param-check panel needs to tell apart (see its own comment
  // on why "not a hardcoded 0/default fallback" matters). Purely additive:
  // nothing that already renders `quantity.done` etc. needs to change.
  hasDone: boolean;
  hasPending: boolean;
  hasExcess: boolean;
}

export interface TaskDependencyRef {
  taskCode: string;
  taskName: string;
}

export interface TaskReportData {
  task: {
    id: string;
    taskCode: string;
    taskName: string;
    description: string | null;
    workName: string;
    accountabilityType: AccountabilityType | null;
    // Procurement Duration Type (task_types.name/default_duration_days) +
    // the task's own live planned start — same inputs
    // computeProcurementLeadTime (lib/taskDetail/constants.ts) already
    // takes elsewhere in this app, exposed here too since General
    // Parameter's own Status of the Work now shows this per task.
    procurementTypeName: string | null;
    procurementTypeDurationDays: number | null;
    referenceStartDateISO: string | null;
  };
  completion: { done: number; total: number } | null;
  statusBreakdown: StatusBreakdownEntry[];
  departmentCompletion: DepartmentCompletionEntry[];
  // Raw scheduling dates ('YYYY-MM-DD' strings, same as everywhere else in
  // this file) — added for the General Parameter report (D/E/H there).
  // Separate from delay.plannedStart/plannedEnd/actualOrProjectedStart/End
  // below, which are fallback-merged for the delay chart's own display —
  // these four are the literal columns, null exactly when genuinely unset.
  plannedStartDate: string | null;
  dueDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  delay: TaskDelayInfo;
  quantity: TaskQuantityInfo | null;
  statusActivity: { changeCount: number; mostRecentChangeAtISO: string | null };
  // Both added 2026-08-17 — previously fetched by nothing on this screen at
  // all (confirmed via the debug panel: real code gaps, not missing data).
  // assignedEngineerName is null both when nobody is assigned AND when
  // assigned_to points at a since-deleted profile — this screen has no way
  // to tell those two apart from a single lookup, same limitation
  // admin-web's own resolution has.
  assignedEngineerName: string | null;
  dependencies: { blockedBy: TaskDependencyRef[]; blocking: TaskDependencyRef[] };
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

interface RawCompletion {
  status: CompletionStatus;
}

interface RawHistoryEntry {
  changed_at: string;
}

interface RawComment {
  body: string;
  created_at: string;
}

interface RawItem {
  id: string;
  category: DependencyCategory;
  item_label: string;
  quantity_unit: QuantityUnit | null;
  quantity_value: string | number | null;
  completion: RawCompletion | RawCompletion[] | null;
  status_history: RawHistoryEntry[] | null;
  comments: RawComment[] | null;
}

interface RawWork {
  name: string;
  accountability_type: AccountabilityType | null;
  project_id: string | null;
}

interface RawTask {
  id: string;
  task_id: string;
  task_name: string;
  description: string | null;
  due_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  planned_start_date: string | null;
  current_planned_start_date: string | null;
  current_due_date: string | null;
  cascade_delay_days: number | null;
  accountability_type: AccountabilityType | null;
  assigned_to: string | null;
  task_type: { name: string; default_duration_days: number } | { name: string; default_duration_days: number }[] | null;
  work: RawWork | RawWork[] | null;
  dependency_items: RawItem[] | null;
}

const TASK_REPORT_SELECT = `
  id, task_id, task_name, description, due_date, actual_start_date, actual_end_date,
  planned_start_date, current_planned_start_date, current_due_date,
  cascade_delay_days, accountability_type, assigned_to,
  task_type:task_types(name, default_duration_days),
  work:works(name, accountability_type, project_id),
  dependency_items(
    id, category, item_label, quantity_unit, quantity_value,
    completion:dependency_completions(status),
    status_history:dependency_status_history(changed_at),
    comments(body, created_at)
  )
`;

// task_dependencies has no project_id of its own and both FKs point at the
// same `tasks` table, so this resolves both directions with plain scalar
// queries (same pattern findUpstreamDelayCause already uses below) rather
// than an ambiguous embed.
async function fetchTaskDependencyRefs(taskId: string): Promise<{ blockedBy: TaskDependencyRef[]; blocking: TaskDependencyRef[] }> {
  const [{ data: blockedByRows, error: blockedByError }, { data: blockingRows, error: blockingError }] = await Promise.all([
    supabase.from('task_dependencies').select('depends_on_task_id').eq('task_id', taskId),
    supabase.from('task_dependencies').select('task_id').eq('depends_on_task_id', taskId),
  ]);
  if (blockedByError) throw new Error(blockedByError.message);
  if (blockingError) throw new Error(blockingError.message);

  const blockedByIds = (blockedByRows ?? []).map((r) => r.depends_on_task_id);
  const blockingIds = (blockingRows ?? []).map((r) => r.task_id);
  const allIds = [...new Set([...blockedByIds, ...blockingIds])];
  if (allIds.length === 0) return { blockedBy: [], blocking: [] };

  const { data: refTasks, error: refError } = await supabase.from('tasks').select('id, task_id, task_name').in('id', allIds);
  if (refError) throw new Error(refError.message);
  const refMap = new Map((refTasks ?? []).map((t) => [t.id, { taskCode: t.task_id, taskName: t.task_name }]));

  return {
    blockedBy: blockedByIds.map((id) => refMap.get(id)).filter((v): v is TaskDependencyRef => v != null),
    blocking: blockingIds.map((id) => refMap.get(id)).filter((v): v is TaskDependencyRef => v != null),
  };
}

export const QUANTITY_LABELS = {
  TARGETED: 'Targeted Quantity',
  DONE: 'Quantity Of Work Done',
  PENDING: 'Pending Quantity',
  EXCESS: 'Excess Quantity',
} as const;

function dayGap(fromISO: string, toISO: string): number {
  return Math.round((new Date(toISO).getTime() - new Date(fromISO).getTime()) / 86_400_000);
}

// Walks the FS-only task_dependencies graph backward from `taskId` to find
// every upstream ancestor, then picks whichever ancestor has the largest
// positive own-delay (actual_end_date vs due_date) as the "driving" cause —
// the same best-effort re-derivation admin-web's own findUpstreamDelayCause
// uses, since cascade_delay_days itself only stores a number, not which
// upstream task produced it.
async function findUpstreamDelayCause(
  taskId: string,
  projectId: string
): Promise<{ taskCode: string; taskName: string } | null> {
  // PostgREST caps a single response at 1000 rows by default — this table is
  // system-wide (243 rows today) and growing, so this pages through rather
  // than assuming one request captures every FS edge (see
  // lib/reports/weeklyReport.ts's own comment on the real truncation bug this
  // exact gap caused elsewhere in this feature).
  const PAGE_SIZE = 1000;
  const depRows: { task_id: string; depends_on_task_id: string }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: pageError } = await supabase
      .from('task_dependencies')
      .select('task_id, depends_on_task_id')
      .eq('type', 'FS')
      .range(from, from + PAGE_SIZE - 1);
    if (pageError) throw new Error(pageError.message);
    const rows = page ?? [];
    depRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const parentsOf = new Map<string, string[]>();
  for (const d of depRows) {
    const list = parentsOf.get(d.task_id) ?? [];
    list.push(d.depends_on_task_id);
    parentsOf.set(d.task_id, list);
  }

  const seen = new Set<string>();
  const queue = [...(parentsOf.get(taskId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(parentsOf.get(id) ?? []));
  }
  if (seen.size === 0) return null;

  // Defensive project guard — task_dependencies has no project_id column of
  // its own, so this can't be scoped at the query level; a stale/foreign
  // ancestor is excluded here instead. Currently a no-op (one real project
  // in the system) but kept for when a second project exists.
  const { data: ancestorRows, error: ancestorError } = await supabase
    .from('tasks')
    .select('id, task_id, task_name, due_date, actual_end_date, work:works!inner(project_id)')
    .in('id', [...seen])
    .eq('work.project_id', projectId);
  if (ancestorError) throw new Error(ancestorError.message);

  let best: { taskCode: string; taskName: string; ownDelayDays: number } | null = null;
  for (const t of (ancestorRows ?? []) as unknown as {
    task_id: string;
    task_name: string;
    due_date: string | null;
    actual_end_date: string | null;
  }[]) {
    if (!t.due_date || !t.actual_end_date) continue;
    const gap = dayGap(t.due_date, t.actual_end_date);
    if (gap > 0 && (!best || gap > best.ownDelayDays)) {
      best = { taskCode: t.task_id, taskName: t.task_name, ownDelayDays: gap };
    }
  }
  return best ? { taskCode: best.taskCode, taskName: best.taskName } : null;
}

// Returns null when the task doesn't exist, or belongs to a project other
// than `projectId` (a stale deep link, or a project switch mid-session) —
// callers render an EmptyState for both cases identically.
export async function fetchTaskReport(taskId: string, projectId: string): Promise<TaskReportData | null> {
  const { data, error } = await supabase.from('tasks').select(TASK_REPORT_SELECT).eq('id', taskId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const raw = data as unknown as RawTask;
  const work = normalizeToOne(raw.work);
  if (!work || work.project_id !== projectId) return null;

  const accountabilityType = raw.accountability_type ?? work.accountability_type ?? null;

  const items = (raw.dependency_items ?? []).map((i) => {
    const completion = normalizeToOne(i.completion);
    // Most recent real comment on this item, if anyone's ever left one —
    // created_at sorted here rather than relying on PostgREST's own embed
    // order, which isn't guaranteed.
    const sortedComments = [...(i.comments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return {
      category: i.category,
      itemLabel: i.item_label,
      quantityUnit: i.quantity_unit,
      quantityValue: i.quantity_value == null ? null : Number(i.quantity_value),
      status: (completion?.status ?? 'PENDING') as CompletionStatus,
      historyDates: (i.status_history ?? []).map((h) => h.changed_at),
      comment: sortedComments[0]?.body ?? null,
    };
  });

  const visibleItems = items.filter((i) => !isCategoryNotRequired(accountabilityType, i.category));

  // #1 — overall checklist completion
  const done = visibleItems.filter((i) => isItemDone(i.status)).length;
  const total = visibleItems.length;

  // #2 — status breakdown
  const statusCounts = new Map<CompletionStatus, number>();
  for (const i of visibleItems) statusCounts.set(i.status, (statusCounts.get(i.status) ?? 0) + 1);
  const statusBreakdown: StatusBreakdownEntry[] = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_CHIP[status].label,
    color: STATUS_CHIP[status].dot,
    count: statusCounts.get(status) ?? 0,
  }));
  const proceedCount = statusCounts.get('PROCEED') ?? 0;
  if (proceedCount > 0) {
    statusBreakdown.push({ status: 'PROCEED', label: STATUS_CHIP.PROCEED.label, color: STATUS_CHIP.PROCEED.dot, count: proceedCount });
  }

  // #3 — completion by department (AC/AV rule applied a second time, on the
  // bucket itself, so a hidden category doesn't render as an empty 0/0 row)
  // A category the AC/AV rule normally hides still appears when it has real
  // open items (Pending/On Hold/Revisions), by explicit correction — e.g. an
  // AC task's Procurement items that are On Hold are a real delay and must
  // show in the report, not silently disappear.
  const isOpen = (s: CompletionStatus) => !isItemDone(s) && s !== 'NO';
  const departmentCompletion: DepartmentCompletionEntry[] = CATEGORIES.filter(
    (cat) => !isCategoryNotRequired(accountabilityType, cat) || items.some((i) => i.category === cat && isOpen(i.status))
  ).map((cat) => {
    const catItems = items.filter((i) => i.category === cat);
    const catActivityDates = catItems.flatMap((i) => i.historyDates).sort();
    return {
      category: cat,
      label: CATEGORY_LABEL[cat],
      color: CATEGORY_COLORS[cat].dot,
      done: catItems.filter((i) => isItemDone(i.status)).length,
      total: catItems.length,
      pendingItems: catItems
        .filter((i) => isOpen(i.status))
        .map((i) => ({ label: i.itemLabel, comment: i.comment, statusLabel: STATUS_CHIP[i.status].label })),
      firstActivityAtISO: catActivityDates[0] ?? null,
      lastActivityAtISO: catActivityDates.length > 0 ? catActivityDates[catActivityDates.length - 1] : null,
    };
  });

  // #4 — delay: own actual-vs-planned gap wins if positive, else the
  // inherited cascade_delay_days (never both) plus a best-effort upstream cause
  const ownDelayDays = raw.due_date && raw.actual_end_date ? dayGap(raw.due_date, raw.actual_end_date) : null;

  let totalDelayDays = 0;
  let source: DelaySource = 'none';
  let causedByTaskCode: string | null = null;
  let causedByTaskName: string | null = null;

  if (ownDelayDays !== null && ownDelayDays > 0) {
    totalDelayDays = ownDelayDays;
    source = 'own';
  } else if (raw.cascade_delay_days && raw.cascade_delay_days > 0) {
    totalDelayDays = raw.cascade_delay_days;
    source = 'upstream';
    const cause = await findUpstreamDelayCause(raw.id, projectId);
    if (cause) {
      causedByTaskCode = cause.taskCode;
      causedByTaskName = cause.taskName;
    }
  }

  const delay: TaskDelayInfo = {
    plannedStart: raw.planned_start_date,
    plannedEnd: raw.due_date,
    actualOrProjectedStart: raw.actual_start_date ?? raw.current_planned_start_date ?? raw.planned_start_date,
    actualOrProjectedEnd: raw.actual_end_date ?? raw.current_due_date ?? raw.due_date,
    hasActualStart: raw.actual_start_date !== null,
    hasActualEnd: raw.actual_end_date !== null,
    totalDelayDays,
    source,
    causedByTaskCode,
    causedByTaskName,
  };

  // #5 — quantity of work (Pending/Excess are pre-computed server-side
  // whenever Targeted/Done are edited — not recomputed here, same as admin-web)
  const quantityItems = items.filter((i) => i.category === 'quantity');
  const targetedItem = quantityItems.find((i) => i.itemLabel === QUANTITY_LABELS.TARGETED);
  const doneItemQ = quantityItems.find((i) => i.itemLabel === QUANTITY_LABELS.DONE);
  const pendingItem = quantityItems.find((i) => i.itemLabel === QUANTITY_LABELS.PENDING);
  const excessItem = quantityItems.find((i) => i.itemLabel === QUANTITY_LABELS.EXCESS);
  const quantity: TaskQuantityInfo | null =
    targetedItem && targetedItem.quantityValue != null
      ? {
          unit: targetedItem.quantityUnit,
          targeted: targetedItem.quantityValue,
          done: doneItemQ?.quantityValue ?? 0,
          pending: pendingItem?.quantityValue ?? 0,
          excess: excessItem?.quantityValue ?? 0,
          hasDone: doneItemQ?.quantityValue != null,
          hasPending: pendingItem?.quantityValue != null,
          hasExcess: excessItem?.quantityValue != null,
        }
      : null;

  // #6 — status change activity, across ALL items (not just visibleItems —
  // a hidden-category item's own history still happened)
  const allHistoryDates = items.flatMap((i) => i.historyDates);
  const statusActivity = {
    changeCount: allHistoryDates.length,
    mostRecentChangeAtISO:
      allHistoryDates.length > 0 ? new Date(Math.max(...allHistoryDates.map((d) => new Date(d).getTime()))).toISOString() : null,
  };

  // #7/#8 — assigned engineer + dependencies, run together since neither
  // depends on the other. (Real DB check, 2026-08-17: 0/311 tasks have
  // assigned_to set anywhere in the system today — this will keep showing
  // "no data" on the debug panel for genuinely every task until someone
  // actually assigns one, which is a real data gap, not a bug in this fetch.)
  const [assignedEngineerName, dependencies] = await Promise.all([
    raw.assigned_to
      ? supabase.from('user_profiles').select('full_name').eq('id', raw.assigned_to).maybeSingle()
          .then(({ data }) => data?.full_name ?? null)
      : Promise.resolve(null),
    fetchTaskDependencyRefs(raw.id),
  ]);

  return {
    task: {
      id: raw.id,
      taskCode: raw.task_id,
      taskName: raw.task_name,
      description: raw.description,
      workName: work.name,
      accountabilityType,
      procurementTypeName: normalizeToOne(raw.task_type)?.name ?? null,
      procurementTypeDurationDays: normalizeToOne(raw.task_type)?.default_duration_days ?? null,
      referenceStartDateISO: raw.current_planned_start_date ?? raw.planned_start_date,
    },
    completion: total > 0 ? { done, total } : null,
    statusBreakdown,
    departmentCompletion,
    plannedStartDate: raw.planned_start_date,
    dueDate: raw.due_date,
    actualStartDate: raw.actual_start_date,
    actualEndDate: raw.actual_end_date,
    delay,
    quantity,
    statusActivity,
    assignedEngineerName,
    dependencies,
  };
}
