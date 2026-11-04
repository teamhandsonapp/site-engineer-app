import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';
import { fetchProcurementSchedule } from '../tasks/procurementSchedule';
import { type DateRange, enumerateDaysUtc, formatDayLabel, previousRange } from './dateRange';

// Ported from admin-web's lib/data/weekly-report.ts getWeeklyReportData() —
// same 6 parameters, same UTC day-key math, scoped to the current project
// (see lib/reports/taskList.ts's comment on why this port adds scoping
// admin-web's own version doesn't have).

export interface DailyActivityEntry {
  date: string;
  label: string;
  started: number;
  completed: number;
}

export interface ProcurementAlertBucket {
  label: string;
  count: number;
  isOverdue: boolean;
}

export interface WorkDelayEntry {
  workName: string;
  avgDelayDays: number;
  taskCount: number;
}

export interface WeeklyReportData {
  overallProgress: { completed: number; total: number } | null;
  dailyActivity: DailyActivityEntry[];
  overdueTasks: { current: number; previous: number };
  procurementAlerts: ProcurementAlertBucket[];
  avgDelayByWork: WorkDelayEntry[];
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function dayGap(fromDateKey: string, toDateKey: string): number {
  return Math.round((new Date(`${toDateKey}T00:00:00.000Z`).getTime() - new Date(`${fromDateKey}T00:00:00.000Z`).getTime()) / 86_400_000);
}

interface BaseTaskRow {
  id: string;
  taskCode: string;
  dueDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  cascadeDelayDays: number | null;
  workName: string;
}

interface RawWork {
  name: string;
  code: string | null;
  project_id: string | null;
}

interface RawTaskRow {
  id: string;
  task_id: string;
  due_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  cascade_delay_days: number | null;
  work: RawWork | RawWork[] | null;
}

async function fetchBaseTasks(projectId: string): Promise<BaseTaskRow[]> {
  const rows = await fetchAllPages<RawTaskRow>((from, to) =>
    supabase
      .from('tasks')
      .select(`
        id, task_id, due_date, actual_start_date, actual_end_date, cascade_delay_days,
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
      id: r.id,
      taskCode: r.task_id,
      dueDate: r.due_date,
      actualStartDate: r.actual_start_date,
      actualEndDate: r.actual_end_date,
      cascadeDelayDays: r.cascade_delay_days,
      workName: work?.name ?? 'Unassigned',
    }));
}

// PostgREST caps a single response at 1000 rows by default — a large
// project's task list alone can exceed that, so an unpaginated fetch here
// would silently truncate. Every unbounded-growth query in this file pages
// through with .range() until a page comes back short, rather than
// assuming a single request captures everything.
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

export async function fetchWeeklyReportData(projectId: string, range: DateRange): Promise<WeeklyReportData> {
  const prevRange = previousRange(range);

  const [tasks, procurementResult] = await Promise.all([
    fetchBaseTasks(projectId),
    fetchProcurementSchedule(),
  ]);

  // #1 — overall progress as of the end of the range: a task counts as done
  // once its actual_end_date is on/before range.to, regardless of its
  // current live status.
  const completed = tasks.filter((t) => t.actualEndDate !== null && t.actualEndDate <= range.to).length;
  const overallProgress = tasks.length > 0 ? { completed, total: tasks.length } : null;

  // #2 — tasks started/completed per day
  const dailyActivity: DailyActivityEntry[] = enumerateDaysUtc(range).map((day) => ({
    date: day,
    label: formatDayLabel(day),
    started: tasks.filter((t) => t.actualStartDate === day).length,
    completed: tasks.filter((t) => t.actualEndDate === day).length,
  }));

  // #3 — overdue as of a date: due before that date AND (never completed, or
  // completed after it)
  function overdueAsOf(asOf: string): number {
    return tasks.filter((t) => t.dueDate !== null && t.dueDate < asOf && (t.actualEndDate === null || t.actualEndDate > asOf)).length;
  }
  const overdueTasks = { current: overdueAsOf(range.to), previous: overdueAsOf(prevRange.to) };

  // #5 — procurement alerts due/overdue within the range
  const projectProcurementTasks = procurementResult.tasks.filter((t) => t.projectId === projectId);
  let overdueBeforeRange = 0;
  const dueByDay = new Map<string, number>();
  for (const day of enumerateDaysUtc(range)) dueByDay.set(day, 0);
  for (const p of projectProcurementTasks) {
    if (p.mustStartByDate < range.from) overdueBeforeRange++;
    else if (p.mustStartByDate <= range.to) dueByDay.set(p.mustStartByDate, (dueByDay.get(p.mustStartByDate) ?? 0) + 1);
  }
  const procurementAlerts: ProcurementAlertBucket[] = [
    { label: 'Overdue', count: overdueBeforeRange, isOverdue: true },
    ...enumerateDaysUtc(range).map((day) => ({ label: formatDayLabel(day), count: dueByDay.get(day) ?? 0, isOverdue: false })),
  ];

  // #6 — average delay by Work, scoped to tasks due within the range.
  // Effective delay per task = its own actual-vs-planned gap if positive,
  // else its inherited cascade_delay_days — never both added together.
  const dueInRange = tasks.filter((t) => t.dueDate !== null && t.dueDate >= range.from && t.dueDate <= range.to);
  const byWork = new Map<string, { total: number; count: number }>();
  for (const t of dueInRange) {
    const ownDelay = t.dueDate !== null && t.actualEndDate !== null ? dayGap(t.dueDate, t.actualEndDate) : null;
    const effectiveDelay = ownDelay !== null && ownDelay > 0 ? ownDelay : (t.cascadeDelayDays ?? 0);
    const bucket = byWork.get(t.workName) ?? { total: 0, count: 0 };
    bucket.total += effectiveDelay;
    bucket.count += 1;
    byWork.set(t.workName, bucket);
  }
  const avgDelayByWork: WorkDelayEntry[] = [...byWork.entries()]
    .map(([workName, { total, count }]) => ({ workName, avgDelayDays: Math.round((total / count) * 10) / 10, taskCount: count }))
    .sort((a, b) => b.avgDelayDays - a.avgDelayDays);

  return { overallProgress, dailyActivity, overdueTasks, procurementAlerts, avgDelayByWork };
}
