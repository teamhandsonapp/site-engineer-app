import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';
import { isCategoryNotRequired, isItemDone, type AccountabilityType, type CompletionStatus, type DependencyCategory, type QuantityUnit } from '../taskDetail/constants';
import { QUANTITY_LABELS } from './taskReport';
import type { DateRange } from './dateRange';

// The one shared engine behind Weekly, Monthly, and Custom Date-Range —
// each of those screens is just this same per-task fetch scoped to a
// different {from,to}, matching the same "one engine, three range-
// selection presets" shape admin-web's equivalent uses. Reuses the exact
// same 13 parameters (and the same real-vs-fallback distinction on
// quantity fields) as the single-task Task Report — this is NOT a
// separate data model, just the batched version of it.

export interface RangeDependencyRef {
  taskCode: string;
  taskName: string;
}

export interface RangeTaskRow {
  id: string;
  taskCode: string;
  taskName: string;
  workName: string; // "Department"
  dueDate: string | null;
  isOverdue: boolean;
  assignedEngineerName: string | null;
  unit: QuantityUnit | null;
  plannedQuantity: number | null;
  completedQuantity: number | null;
  remainingQuantity: number | null;
  percentCompleteByQuantity: number | null;
  checklistTotal: number;
  checklistDone: number;
  checklistPending: number;
  blockedBy: RangeDependencyRef[];
  blocking: RangeDependencyRef[];
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

// PostgREST caps a single response at 1000 rows by default — same
// pagination convention as weeklyReport.ts's own fetchAllPages.
const PAGE_SIZE = 1000;
async function fetchAllPages<T>(
  queryBuilder: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryBuilder(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

interface RawWork {
  name: string;
  code: string | null;
  accountability_type: AccountabilityType | null;
  project_id: string | null;
}

interface RawItem {
  category: DependencyCategory;
  item_label: string;
  quantity_unit: QuantityUnit | null;
  quantity_value: number | string | null;
  completion: { status: CompletionStatus } | { status: CompletionStatus }[] | null;
}

interface RawTaskRow {
  id: string;
  task_id: string;
  task_name: string;
  due_date: string | null;
  actual_end_date: string | null;
  assigned_to: string | null;
  accountability_type: AccountabilityType | null;
  work: RawWork | RawWork[] | null;
  dependency_items: RawItem[] | null;
}

const RANGE_TASK_SELECT = `
  id, task_id, task_name, due_date, actual_end_date, assigned_to, accountability_type,
  work:works!inner(name, code, accountability_type, project_id),
  dependency_items(
    category, item_label, quantity_unit, quantity_value,
    completion:dependency_completions(status)
  )
`;

export async function fetchRangeTaskReport(projectId: string, range: DateRange): Promise<RangeTaskRow[]> {
  const rows = await fetchAllPages<RawTaskRow>((from, to) =>
    supabase
      .from('tasks')
      .select(RANGE_TASK_SELECT)
      .eq('work.project_id', projectId)
      .is('deleted_at', null)
      .gte('due_date', range.from)
      .lte('due_date', range.to)
      .range(from, to) as unknown as PromiseLike<{ data: RawTaskRow[] | null; error: { message: string } | null }>
  );

  const tasks = rows
    .map((r) => ({ r, work: normalizeToOne(r.work) }))
    .filter(({ r, work }) => isPilotVisible(r.task_id, work?.code));

  // Batch-resolve assigned_to -> full_name (one query, not one per task —
  // same "0/311 tasks have this set today" real data gap as Task Report,
  // just checked once for the whole set here).
  const assignedIds = [...new Set(tasks.map(({ r }) => r.assigned_to).filter((id): id is string => id != null))];
  const userMap = new Map<string, string>();
  if (assignedIds.length > 0) {
    const { data: users, error } = await supabase.from('user_profiles').select('id, full_name').in('id', assignedIds);
    if (error) throw new Error(error.message);
    for (const u of users ?? []) userMap.set(u.id, u.full_name);
  }

  // Batch-resolve dependencies in both directions — two queries scoped to
  // just this report's own task set, plus one lookup for whichever tasks
  // those dependency rows reference (which may fall outside the date range
  // itself — a blocker due next month is still a real blocker today).
  const allTaskIds = tasks.map(({ r }) => r.id);
  const [{ data: blockedByRows, error: blockedByError }, { data: blockingRows, error: blockingError }] = await Promise.all([
    supabase.from('task_dependencies').select('task_id, depends_on_task_id').in('task_id', allTaskIds),
    supabase.from('task_dependencies').select('task_id, depends_on_task_id').in('depends_on_task_id', allTaskIds),
  ]);
  if (blockedByError) throw new Error(blockedByError.message);
  if (blockingError) throw new Error(blockingError.message);

  const referencedIds = new Set<string>();
  for (const d of blockedByRows ?? []) referencedIds.add(d.depends_on_task_id);
  for (const d of blockingRows ?? []) referencedIds.add(d.task_id);
  const refMap = new Map<string, RangeDependencyRef>();
  if (referencedIds.size > 0) {
    const { data: refTasks, error: refError } = await supabase.from('tasks').select('id, task_id, task_name').in('id', [...referencedIds]);
    if (refError) throw new Error(refError.message);
    for (const t of refTasks ?? []) refMap.set(t.id, { taskCode: t.task_id, taskName: t.task_name });
  }
  const blockedByOf = new Map<string, RangeDependencyRef[]>();
  for (const d of blockedByRows ?? []) {
    const ref = refMap.get(d.depends_on_task_id);
    if (!ref) continue;
    const list = blockedByOf.get(d.task_id) ?? [];
    list.push(ref);
    blockedByOf.set(d.task_id, list);
  }
  const blockingOf = new Map<string, RangeDependencyRef[]>();
  for (const d of blockingRows ?? []) {
    const ref = refMap.get(d.task_id);
    if (!ref) continue;
    const list = blockingOf.get(d.depends_on_task_id) ?? [];
    list.push(ref);
    blockingOf.set(d.depends_on_task_id, list);
  }

  const today = new Date().toISOString().slice(0, 10);

  const result: RangeTaskRow[] = tasks.map(({ r, work }) => {
    const accountabilityType = r.accountability_type ?? work?.accountability_type ?? null;
    const items = r.dependency_items ?? [];
    const visibleItems = items.filter((i) => !isCategoryNotRequired(accountabilityType, i.category));

    let checklistDone = 0;
    for (const item of visibleItems) {
      const completion = normalizeToOne(item.completion);
      if (isItemDone(completion?.status ?? 'PENDING')) checklistDone++;
    }
    const checklistTotal = visibleItems.length;

    const quantityItems = items.filter((i) => i.category === 'quantity');
    const targetedItem = quantityItems.find((i) => i.item_label === QUANTITY_LABELS.TARGETED);
    const doneItem = quantityItems.find((i) => i.item_label === QUANTITY_LABELS.DONE);
    const plannedQuantity = targetedItem?.quantity_value != null ? Number(targetedItem.quantity_value) : null;
    const completedQuantity = plannedQuantity != null && doneItem?.quantity_value != null ? Number(doneItem.quantity_value) : (plannedQuantity != null ? null : null);
    // Matches Task Report's own real-vs-fallback rule: completedQuantity is
    // only ever a real number when a "Quantity Of Work Done" row actually
    // exists — never silently defaulted to 0 here.
    const hasDone = plannedQuantity != null && doneItem?.quantity_value != null;
    const remainingQuantity = plannedQuantity != null && hasDone ? Math.round((plannedQuantity - (completedQuantity ?? 0)) * 100) / 100 : null;
    const percentCompleteByQuantity = plannedQuantity != null && plannedQuantity > 0 && hasDone
      ? Math.round(((completedQuantity ?? 0) / plannedQuantity) * 1000) / 10
      : null;

    // Same rule weeklyReport.ts's own overdueAsOf already uses elsewhere in
    // this app (dueDate before today AND not yet actually completed) —
    // reused here rather than the checklist-based proxy Task Report uses
    // for lack of actual_end_date in ITS OWN fetch (this fetch has it).
    const isOverdue = !!(r.due_date && r.due_date < today && (r.actual_end_date == null || r.actual_end_date > today));

    return {
      id: r.id,
      taskCode: r.task_id,
      taskName: r.task_name,
      workName: work?.name ?? 'Unassigned',
      dueDate: r.due_date,
      isOverdue,
      assignedEngineerName: r.assigned_to ? (userMap.get(r.assigned_to) ?? null) : null,
      unit: targetedItem?.quantity_unit ?? null,
      plannedQuantity,
      completedQuantity: hasDone ? completedQuantity : null,
      remainingQuantity,
      percentCompleteByQuantity,
      checklistTotal,
      checklistDone,
      checklistPending: checklistTotal - checklistDone,
      blockedBy: blockedByOf.get(r.id) ?? [],
      blocking: blockingOf.get(r.id) ?? [],
    };
  });

  return result.sort((a, b) => a.workName.localeCompare(b.workName) || a.taskCode.localeCompare(b.taskCode));
}

export function groupByDepartment(rows: RangeTaskRow[]): { workName: string; rows: RangeTaskRow[] }[] {
  const groups: { workName: string; rows: RangeTaskRow[] }[] = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    if (!index.has(row.workName)) {
      index.set(row.workName, groups.length);
      groups.push({ workName: row.workName, rows: [] });
    }
    groups[index.get(row.workName)!].rows.push(row);
  }
  return groups;
}
