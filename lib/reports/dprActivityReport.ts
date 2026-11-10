import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';
import type { DprCommentPreset, DprDependencyCategory } from '../dprEntries';
import { addDaysUtc, daysBetweenInclusive, type DateRange } from './dateRange';
import { countWorkingDaysBetween, workingDaysBetween } from '../workingDays';
import { fetchBlockedDates } from './generalParameterReport';

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
  // The comment typed for each ticked reason (DPR's Reasons for Delay).
  reasonComments: Partial<Record<DprDependencyCategory, string>>;
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
  // The task's own dates + total delay (Pre + Construction — the same figure
  // the task report shows under Post Construction).
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  totalDelayDays: number | null;
  // Every DPR row with a reason for delay, from ANY date (newest first) —
  // Monthly Status shows these, since a reason is often typed in later than
  // the month the work happened in. Weekly/Daily leave this empty.
  reasonEntries: DprActivityRow[];
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
  delay_reason_comments: Partial<Record<DprDependencyCategory, string>> | null;
}

interface RawTaskRow {
  id: string;
  task_id: string;
  task_name: string;
  planned_start_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  due_date: string | null;
  current_due_date: string | null;
  work: RawWork | RawWork[] | null;
  dpr_entries?: RawEntry[] | null;
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

const ACTIVITY_SELECT = `
  id, task_id, task_name, planned_start_date, actual_start_date, actual_end_date, due_date, current_due_date,
  work:works!inner(name, code, project_id),
  dpr_entries!inner(task_id, report_date, percent_complete, dependency_categories, comment_preset, comment_text, delay_reason_comments)
`;

// Same columns without the DPR join — tasks picked by their own actual dates.
const DATED_TASK_SELECT = `
  id, task_id, task_name, planned_start_date, actual_start_date, actual_end_date, due_date, current_due_date,
  work:works!inner(name, code, project_id)
`;

function parseKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

// Pre + Construction, the same formulas as the task report
// (generalParameterReport.ts): Pre = working days Planned Start -> Actual
// Start (0 if it started early); Construction = actual working days -
// planned working days (never below 0). Only `holidays` rows are skipped.
function totalDelayFor(r: RawTaskRow, blocked: Set<string>, todayKey: string): number | null {
  if (!r.planned_start_date || !r.due_date || !r.actual_start_date) return null;
  const plannedStart = parseKey(r.planned_start_date);
  const actualStart = parseKey(r.actual_start_date);
  const pre = actualStart > plannedStart ? Math.max(0, workingDaysBetween(plannedStart, actualStart, blocked)) : 0;
  const planned = countWorkingDaysBetween(plannedStart, parseKey(r.due_date), blocked);
  const actual = countWorkingDaysBetween(actualStart, parseKey(r.actual_end_date ?? todayKey), blocked);
  return pre + Math.max(0, actual - planned);
}

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

// includeByActualDates (Monthly Status, by request 2026-11-10): also lists
// every task whose Actual Start -> Actual End (or today, if still running)
// overlaps the window, even with no DPR in it.
export async function fetchDprActivityReport(
  projectId: string,
  range: DateRange,
  options: { includeByActualDates?: boolean } = {}
): Promise<DprActivityReport> {
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
        reasonComments: entry.delay_reason_comments ?? {},
      });
    }
  }
  rows.sort((a, b) => b.reportDate.localeCompare(a.reportDate) || a.taskCode.localeCompare(b.taskCode));

  const todayKey = new Date().toISOString().slice(0, 10);
  const dated: RawTaskRow[] = [];
  if (options.includeByActualDates) {
    const { data, error } = await supabase
      .from('tasks')
      .select(DATED_TASK_SELECT)
      .eq('work.project_id', projectId)
      .is('deleted_at', null)
      .not('actual_start_date', 'is', null)
      .lte('actual_start_date', range.to)
      .or(`actual_end_date.gte.${range.from},actual_end_date.is.null`);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as RawTaskRow[]) {
      if (isPilotVisible(r.task_id, normalizeToOne(r.work)?.code)) dated.push(r);
    }
  }

  const rawById = new Map<string, RawTaskRow>([...dated, ...all].map((r) => [r.id, r]));
  const keys = [...rawById.values()].flatMap((r) => [r.planned_start_date, r.due_date, r.actual_start_date, r.actual_end_date]);
  const years = new Set([todayKey, ...keys].filter((k): k is string => k != null).map((k) => Number(k.slice(0, 4))));
  const blocked = await fetchBlockedDates(years);

  const taskMap = new Map<string, DprActivityTask>();
  function ensureTask(raw: RawTaskRow): DprActivityTask {
    let t = taskMap.get(raw.id);
    if (!t) {
      t = {
        taskId: raw.id,
        taskCode: raw.task_id,
        taskName: raw.task_name,
        workName: normalizeToOne(raw.work)?.name ?? 'Unassigned',
        entries: [],
        forecast: null,
        plannedStartDate: raw.planned_start_date,
        plannedEndDate: raw.current_due_date ?? raw.due_date,
        actualStartDate: raw.actual_start_date,
        actualEndDate: raw.actual_end_date,
        totalDelayDays: totalDelayFor(raw, blocked, todayKey),
        reasonEntries: [],
      };
      taskMap.set(raw.id, t);
    }
    return t;
  }
  for (const row of rows) {
    const raw = rawById.get(row.taskId);
    if (raw) ensureTask(raw).entries.push(row);
  }
  for (const raw of dated) ensureTask(raw);

  // Monthly: every reason for delay ever entered for the listed tasks, from
  // any date (a reason typed in today still belongs to September's work).
  if (options.includeByActualDates && taskMap.size > 0) {
    const { data: reasonData, error: reasonErr } = await supabase
      .from('dpr_entries')
      .select('task_id, report_date, percent_complete, dependency_categories, comment_preset, comment_text, delay_reason_comments')
      .in('task_id', [...taskMap.keys()])
      .order('report_date', { ascending: false });
    if (reasonErr) throw new Error(reasonErr.message);
    for (const e of (reasonData ?? []) as RawEntry[]) {
      const t = taskMap.get(e.task_id);
      const hasReason = (e.dependency_categories ?? []).length > 0 || e.comment_preset != null;
      if (!t || !hasReason) continue;
      t.reasonEntries.push({
        taskId: t.taskId,
        taskCode: t.taskCode,
        taskName: t.taskName,
        workName: t.workName,
        reportDate: e.report_date,
        percentComplete: e.percent_complete,
        dependencyCategories: e.dependency_categories ?? [],
        commentPreset: e.comment_preset,
        commentText: e.comment_text,
        reasonComments: e.delay_reason_comments ?? {},
      });
    }
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
  // By Actual Start (no date last), same order as the flowchart.
  const tasks = [...taskMap.values()].sort((a, b) => {
    if (a.actualStartDate !== b.actualStartDate) {
      if (!a.actualStartDate) return 1;
      if (!b.actualStartDate) return -1;
      return a.actualStartDate.localeCompare(b.actualStartDate);
    }
    return a.taskName.localeCompare(b.taskName, undefined, { numeric: true });
  });

  // Monthly: tasks with no DPR still count — finished (Actual End set) = 100%,
  // otherwise 0% — so the total covers every task listed, not just DPR ones.
  const percents = [
    ...latest.map((l) => l.percent),
    ...(options.includeByActualDates ? tasks.filter((t) => !t.forecast).map((t) => (t.actualEndDate ? 100 : 0)) : []),
  ];
  const cumulativePercent = percents.length > 0 ? Math.round((percents.reduce((sum, p) => sum + p, 0) / percents.length) * 10) / 10 : null;
  let overallForecast: ProgressForecast | null = null;
  // The projection needs at least one DPR-based task (a month can now list
  // tasks with no DPR at all — then there's just the cumulative %).
  if (cumulativePercent != null && latest.length > 0) {
    const asOf = latest.reduce((m, l) => (l.asOf > m ? l.asOf : m), latest[0].asOf);
    const start = latest.reduce((m, l) => (l.start < m ? l.start : m), latest[0].start);
    const dues = latest.map((l) => l.due).filter((d): d is string => d != null);
    const due = dues.length > 0 ? dues.reduce((m, d) => (d > m ? d : m)) : null;
    overallForecast = computeForecast(cumulativePercent, asOf, start, due);
  }

  return { rows, tasks, overallForecast, taskCount: tasks.length, cumulativePercent };
}
