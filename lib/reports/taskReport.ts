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
}

export interface TaskReportData {
  task: {
    id: string;
    taskCode: string;
    taskName: string;
    workName: string;
    accountabilityType: AccountabilityType | null;
  };
  completion: { done: number; total: number } | null;
  statusBreakdown: StatusBreakdownEntry[];
  departmentCompletion: DepartmentCompletionEntry[];
  delay: TaskDelayInfo;
  quantity: TaskQuantityInfo | null;
  statusActivity: { changeCount: number; mostRecentChangeAtISO: string | null };
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

interface RawItem {
  id: string;
  category: DependencyCategory;
  item_label: string;
  quantity_unit: QuantityUnit | null;
  quantity_value: string | number | null;
  completion: RawCompletion | RawCompletion[] | null;
  status_history: RawHistoryEntry[] | null;
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
  due_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  planned_start_date: string | null;
  current_planned_start_date: string | null;
  current_due_date: string | null;
  cascade_delay_days: number | null;
  accountability_type: AccountabilityType | null;
  work: RawWork | RawWork[] | null;
  dependency_items: RawItem[] | null;
}

const TASK_REPORT_SELECT = `
  id, task_id, task_name, due_date, actual_start_date, actual_end_date,
  planned_start_date, current_planned_start_date, current_due_date,
  cascade_delay_days, accountability_type,
  work:works(name, accountability_type, project_id),
  dependency_items(
    id, category, item_label, quantity_unit, quantity_value,
    completion:dependency_completions(status),
    status_history:dependency_status_history(changed_at)
  )
`;

const QUANTITY_LABELS = {
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
    return {
      category: i.category,
      itemLabel: i.item_label,
      quantityUnit: i.quantity_unit,
      quantityValue: i.quantity_value == null ? null : Number(i.quantity_value),
      status: (completion?.status ?? 'PENDING') as CompletionStatus,
      historyDates: (i.status_history ?? []).map((h) => h.changed_at),
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
  const departmentCompletion: DepartmentCompletionEntry[] = CATEGORIES.filter(
    (cat) => !isCategoryNotRequired(accountabilityType, cat)
  ).map((cat) => {
    const catItems = visibleItems.filter((i) => i.category === cat);
    return {
      category: cat,
      label: CATEGORY_LABEL[cat],
      color: CATEGORY_COLORS[cat].dot,
      done: catItems.filter((i) => isItemDone(i.status)).length,
      total: catItems.length,
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

  return {
    task: {
      id: raw.id,
      taskCode: raw.task_id,
      taskName: raw.task_name,
      workName: work.name,
      accountabilityType,
    },
    completion: total > 0 ? { done, total } : null,
    statusBreakdown,
    departmentCompletion,
    delay,
    quantity,
    statusActivity,
  };
}
