import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';

// Ported from admin-web's lib/data/monthly-report.ts getMonthlyReportData()
// — same delay-by-department/delay-by-person/targeted-quantity breakdown,
// scoped to the currently selected project (see lib/reports/weeklyReport.ts's
// own comment on why this port adds scoping admin-web's own version doesn't
// have).

export interface MonthRange {
  year: number;
  month: number; // 1-12
}

export interface DelayBreakdown {
  name: string;
  avgDelayDays: number;
  taskCount: number;
}

export interface QuantityByDepartment {
  workName: string;
  targeted: number;
  completed: number;
}

export interface MonthlyReportData {
  delayByDepartment: DelayBreakdown[];
  delayByPerson: DelayBreakdown[];
  quantity: {
    targetedTotal: number;
    completedTotal: number;
    percentage: number | null;
    byDepartment: QuantityByDepartment[];
  };
}

function utcMonthStartKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}
function utcMonthEndKey(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

export function defaultMonthRange(): MonthRange {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function shiftMonth(range: MonthRange, delta: number): MonthRange {
  const zeroBased = range.month - 1 + delta;
  const year = range.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  return { year, month };
}

export function monthLabel(range: MonthRange): string {
  return new Date(Date.UTC(range.year, range.month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function dayGap(fromDateKey: string, toDateKey: string): number {
  return Math.round((new Date(`${toDateKey}T00:00:00.000Z`).getTime() - new Date(`${fromDateKey}T00:00:00.000Z`).getTime()) / 86_400_000);
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

// Same PostgREST 1000-row-cap pagination as weeklyReport.ts — see that
// file's own comment for why an unbounded fetch here would silently
// undercount on a large project.
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
  project_id: string | null;
}

interface RawTaskRow {
  task_id: string;
  due_date: string | null;
  actual_end_date: string | null;
  cascade_delay_days: number | null;
  assigned_to: string | null;
  total_sft: number | string | null;
  work: RawWork | RawWork[] | null;
}

interface BaseTaskRow {
  dueDate: string | null;
  actualEndDate: string | null;
  cascadeDelayDays: number | null;
  assignedTo: string | null;
  totalSft: number;
  workName: string;
}

async function fetchTasksForProject(projectId: string): Promise<BaseTaskRow[]> {
  const rows = await fetchAllPages<RawTaskRow>((from, to) =>
    supabase
      .from('tasks')
      .select(`
        task_id, due_date, actual_end_date, cascade_delay_days, assigned_to, total_sft,
        work:works!inner(name, code, project_id)
      `)
      .eq('work.project_id', projectId)
      .is('deleted_at', null)
      .range(from, to)
  );

  return rows
    .map((r) => ({ r, work: normalizeToOne(r.work) }))
    .filter(({ r, work }) => isPilotVisible(r.task_id, work?.code))
    .map(({ r, work }) => ({
      dueDate: r.due_date,
      actualEndDate: r.actual_end_date,
      cascadeDelayDays: r.cascade_delay_days,
      assignedTo: r.assigned_to,
      totalSft: r.total_sft != null ? Number(r.total_sft) : 0,
      workName: work?.name ?? 'Unassigned',
    }));
}

interface RawSftEntryWork {
  name: string;
  project_id: string | null;
}

interface RawSftEntryRow {
  sft_completed: number | string;
  task: { work: RawSftEntryWork | RawSftEntryWork[] | null } | { work: RawSftEntryWork | RawSftEntryWork[] | null }[] | null;
}

async function fetchSftEntriesForMonth(projectId: string, from: string, to: string): Promise<{ sftCompleted: number; workName: string }[]> {
  const rows = await fetchAllPages<RawSftEntryRow>((rangeFrom, rangeTo) =>
    supabase
      .from('sft_progress_entries')
      .select(`sft_completed, task:tasks!inner(work:works!inner(name, project_id))`)
      .eq('task.work.project_id', projectId)
      .gte('entry_date', from)
      .lte('entry_date', to)
      .range(rangeFrom, rangeTo)
  );
  return rows.map((r) => {
    const task = normalizeToOne(r.task);
    const work = task ? normalizeToOne(task.work) : null;
    return { sftCompleted: Number(r.sft_completed), workName: work?.name ?? 'Unassigned' };
  });
}

// Effective delay per task = its own actual-vs-planned gap if positive,
// else its inherited cascade_delay_days — never both added together, same
// resolution rule as admin-web's and weeklyReport.ts's own delay math.
function effectiveDelay(t: { dueDate: string | null; actualEndDate: string | null; cascadeDelayDays: number | null }): number {
  const ownDelay = t.dueDate !== null && t.actualEndDate !== null ? dayGap(t.dueDate, t.actualEndDate) : null;
  return ownDelay !== null && ownDelay > 0 ? ownDelay : (t.cascadeDelayDays ?? 0);
}

function averageBy<T>(items: T[], keyOf: (item: T) => string, delayOf: (item: T) => number): DelayBreakdown[] {
  const buckets = new Map<string, { total: number; count: number }>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };
    bucket.total += delayOf(item);
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([name, { total, count }]) => ({ name, avgDelayDays: Math.round((total / count) * 10) / 10, taskCount: count }))
    .sort((a, b) => b.avgDelayDays - a.avgDelayDays);
}

// "Targeted for this month" = tasks whose due_date falls in the month (the
// commitment for that period); "completed this month" = actual
// sft_progress_entries rows logged with an entry_date in the month — two
// independent measures compared side by side, matching admin-web's own
// monthly-report.ts framing exactly.
export async function fetchMonthlyReportData(projectId: string, range: MonthRange): Promise<MonthlyReportData> {
  const from = utcMonthStartKey(range.year, range.month);
  const to = utcMonthEndKey(range.year, range.month);

  const [tasks, sftEntries, users] = await Promise.all([
    fetchTasksForProject(projectId),
    fetchSftEntriesForMonth(projectId, from, to),
    fetchAllPages<{ id: string; full_name: string }>((f, t) => supabase.from('user_profiles').select('id, full_name').range(f, t)),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u.full_name]));

  const dueInMonth = tasks.filter((t) => t.dueDate !== null && t.dueDate >= from && t.dueDate <= to);

  const delayByDepartment = averageBy(dueInMonth, (t) => t.workName, effectiveDelay);
  const delayByPerson = averageBy(
    dueInMonth,
    (t) => (t.assignedTo ? userMap.get(t.assignedTo) ?? 'Unknown' : 'Unassigned'),
    effectiveDelay
  );

  const targetedByWork = new Map<string, number>();
  for (const t of dueInMonth) {
    targetedByWork.set(t.workName, (targetedByWork.get(t.workName) ?? 0) + t.totalSft);
  }
  const completedByWork = new Map<string, number>();
  for (const e of sftEntries) {
    completedByWork.set(e.workName, (completedByWork.get(e.workName) ?? 0) + e.sftCompleted);
  }
  const allWorkNames = new Set([...targetedByWork.keys(), ...completedByWork.keys()]);
  const byDepartment: QuantityByDepartment[] = [...allWorkNames]
    .map((workName) => ({
      workName,
      targeted: Math.round((targetedByWork.get(workName) ?? 0) * 100) / 100,
      completed: Math.round((completedByWork.get(workName) ?? 0) * 100) / 100,
    }))
    .sort((a, b) => b.targeted - a.targeted);

  const targetedTotal = Math.round([...targetedByWork.values()].reduce((s, v) => s + v, 0) * 100) / 100;
  const completedTotal = Math.round([...completedByWork.values()].reduce((s, v) => s + v, 0) * 100) / 100;
  const percentage = targetedTotal > 0 ? Math.min(100, Math.round((completedTotal / targetedTotal) * 100)) : null;

  return {
    delayByDepartment,
    delayByPerson,
    quantity: { targetedTotal, completedTotal, percentage, byDepartment },
  };
}
