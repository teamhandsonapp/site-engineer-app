import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';
import type { DprCommentPreset, DprDependencyCategory } from '../dprEntries';
import { addDaysUtc, daysBetweenInclusive, type DateRange } from './dateRange';

// The Day/Week/Month/Custom "Report by time" reports (drawer's Reports
// submenu) — unlike rangeTaskReport.ts's old Weekly/Monthly/Custom (which
// listed tasks by due_date, whether or not any work was actually logged),
// this lists real dpr_entries rows within a window: one row per (task,
// day) a site engineer actually submitted a DPR for, plus a cumulative %
// rollup across them. Nothing analogous existed before this — see
// lib/dprEntries.ts's own fetchTodayDprEntries, which is single-day and
// requires an explicit taskIds[] rather than querying a project-wide date
// range. (The Architect/Client/Vendor/Dept/Contractor reports used to
// filter this same engine by category/department — moved to
// lib/reports/stakeholderReport.ts instead, a genuinely different report
// shape: pending checklist inputs + downstream delay impact, not a
// date-range activity list.)

export interface DprActivityRow {
  taskId: string;
  taskCode: string;
  taskName: string;
  workName: string; // "Department"
  reportDate: string;
  percentComplete: number | null;
  dependencyCategories: DprDependencyCategory[];
  commentPreset: DprCommentPreset | null;
  commentText: string | null;
}

// "X% done in N days · remaining Y% needs M more days (till date) · Z days
// behind/ahead of schedule" — a straight-line projection from the average
// daily progress rate since the task (or project) started.
export interface ProgressForecast {
  percentDone: number;
  asOfDate: string; // latest DPR date the percent comes from
  startDate: string;
  daysElapsed: number;
  remainingPercent: number;
  daysRemaining: number | null; // null when no progress yet (rate 0)
  forecastEndDate: string | null;
  scheduledEndDate: string | null;
  // forecastEndDate - scheduledEndDate: positive = delayed, <= 0 = on track.
  varianceDays: number | null;
}

export interface DprActivityTask {
  taskId: string;
  taskCode: string;
  taskName: string;
  workName: string;
  entries: DprActivityRow[]; // newest first
  forecast: ProgressForecast | null;
}

export interface DprActivityReport {
  rows: DprActivityRow[];
  tasks: DprActivityTask[];
  overallForecast: ProgressForecast | null;
  taskCount: number; // distinct tasks across all rows
  // Average of each task's LATEST percentComplete in the window — "for total
  // 3 tasks it will show in last like cumulative percent", by explicit
  // request. Null when nothing in the window logged a percent at all.
  cumulativePercent: number | null;
}

interface RawWork {
  name: string;
  code: string | null;
  project_id: string;
}

interface RawEntry {
  task_id: string;
  report_date: string;
  percent_complete: number | null;
  dependency_categories: DprDependencyCategory[] | null;
  comment_preset: DprCommentPreset | null;
  comment_text: string | null;
}

interface RawTaskRow {
  id: string;
  task_id: string;
  task_name: string;
  planned_start_date: string | null;
  actual_start_date: string | null;
  due_date: string | null;
  current_due_date: string | null;
  work: RawWork | RawWork[] | null;
  dpr_entries: RawEntry[] | null;
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

const ACTIVITY_SELECT = `
  id, task_id, task_name, planned_start_date, actual_start_date, due_date, current_due_date,
  work:works!inner(name, code, project_id),
  dpr_entries!inner(task_id, report_date, percent_complete, dependency_categories, comment_preset, comment_text)
`;

function daysFromTo(from: string, to: string): number {
  return daysBetweenInclusive({ from, to }) - 1;
}

export function computeForecast(percentDone: number, asOfDate: string, startDate: string, scheduledEndDate: string | null): ProgressForecast {
  const daysElapsed = Math.max(1, daysBetweenInclusive({ from: startDate, to: asOfDate }));
  const remainingPercent = Math.max(0, Math.round((100 - percentDone) * 10) / 10);
  const rate = percentDone / daysElapsed;
  const daysRemaining = remainingPercent === 0 ? 0 : rate > 0 ? Math.ceil(remainingPercent / rate) : null;
  const forecastEndDate = daysRemaining == null ? null : addDaysUtc(asOfDate, daysRemaining);
  const varianceDays = forecastEndDate && scheduledEndDate ? daysFromTo(scheduledEndDate, forecastEndDate) : null;
  return { percentDone, asOfDate, startDate, daysElapsed, remainingPercent, daysRemaining, forecastEndDate, scheduledEndDate, varianceDays };
}

// PostgREST caps a single response at 1000 rows — same pagination
// convention as every other report fetch in this app.
const PAGE_SIZE = 1000;

export async function fetchDprActivityReport(projectId: string, range: DateRange): Promise<DprActivityReport> {
  const all: RawTaskRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('tasks')
      .select(ACTIVITY_SELECT)
      .eq('work.project_id', projectId)
      .gte('dpr_entries.report_date', range.from)
      .lte('dpr_entries.report_date', range.to)
      .is('deleted_at', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RawTaskRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const rows: DprActivityRow[] = [];
  for (const r of all) {
    const work = normalizeToOne(r.work);
    if (!isPilotVisible(r.task_id, work?.code)) continue;
    for (const entry of r.dpr_entries ?? []) {
      const categories = entry.dependency_categories ?? [];
      rows.push({
        taskId: r.id,
        taskCode: r.task_id,
        taskName: r.task_name,
        workName: work?.name ?? 'Unassigned',
        reportDate: entry.report_date,
        percentComplete: entry.percent_complete,
        dependencyCategories: categories,
        commentPreset: entry.comment_preset,
        commentText: entry.comment_text,
      });
    }
  }
  rows.sort((a, b) => b.reportDate.localeCompare(a.reportDate) || a.taskCode.localeCompare(b.taskCode));

  const rawById = new Map(all.map((r) => [r.id, r]));
  const taskMap = new Map<string, DprActivityTask>();
  for (const row of rows) {
    let t = taskMap.get(row.taskId);
    if (!t) {
      t = { taskId: row.taskId, taskCode: row.taskCode, taskName: row.taskName, workName: row.workName, entries: [], forecast: null };
      taskMap.set(row.taskId, t);
    }
    t.entries.push(row);
  }

  // Per task: the latest DPR's percent is the task's progress as of that day.
  const latest: { percent: number; asOf: string; start: string; due: string | null }[] = [];
  for (const t of taskMap.values()) {
    const withPct = t.entries.filter((e) => e.percentComplete != null);
    if (withPct.length === 0) continue;
    const raw = rawById.get(t.taskId);
    const asOf = withPct[0].reportDate;
    const start = raw?.actual_start_date ?? raw?.planned_start_date ?? withPct[withPct.length - 1].reportDate;
    const due = raw?.current_due_date ?? raw?.due_date ?? null;
    const percent = withPct[0].percentComplete ?? 0;
    t.forecast = computeForecast(percent, asOf, start <= asOf ? start : asOf, due);
    latest.push({ percent, asOf, start: t.forecast.startDate, due });
  }
  const tasks = [...taskMap.values()].sort((a, b) => a.taskCode.localeCompare(b.taskCode));

  const cumulativePercent = latest.length > 0 ? Math.round((latest.reduce((sum, l) => sum + l.percent, 0) / latest.length) * 10) / 10 : null;
  let overallForecast: ProgressForecast | null = null;
  if (cumulativePercent != null) {
    const asOf = latest.reduce((m, l) => (l.asOf > m ? l.asOf : m), latest[0].asOf);
    const start = latest.reduce((m, l) => (l.start < m ? l.start : m), latest[0].start);
    const dues = latest.map((l) => l.due).filter((d): d is string => d != null);
    const due = dues.length > 0 ? dues.reduce((m, d) => (d > m ? d : m)) : null;
    overallForecast = computeForecast(cumulativePercent, asOf, start, due);
  }

  return { rows, tasks, overallForecast, taskCount: tasks.length, cumulativePercent };
}
