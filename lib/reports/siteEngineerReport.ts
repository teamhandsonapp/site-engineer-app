import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';
import { fetchEngineerDailyAttendance, type DailyAttendanceRecord } from '../attendanceReview';
import type { DprCommentPreset, DprDependencyCategory } from '../dprEntries';
import { fetchLeaveLog, leaveReasonLabelFor, type LeaveLogEntry, type LeaveReasonPresetValue } from '../leaveEvents';
import { type DateRange, addDaysUtc, daysBetweenInclusive, parseDateKeyUtc, toDateKeyUtc } from './dateRange';

// "Site Engineer Report" — by explicit request, one engineer's Delay
// Tracking + Attendance (working hours, check-in/out times) + Leave
// (how often they log a Leave — see fetchEngineerLeaveEvents below for what
// "Leave" means in this app) + DPR submission history, for a project over a
// date range. Combines FOUR data sources that already existed independently
// (lib/attendanceReview.ts's fetchEngineerDailyAttendance,
// dprActivityReport.ts's dpr_entries query, monthlyReport.ts's own
// assigned_to-based delay-by-person math, and lib/leaveEvents.ts's
// fetchLeaveLog) rather than new engines for any of them.

export interface SiteEngineerOption {
  userId: string;
  fullName: string;
  role: string; // 'site_engineer' | 'senior_site_engineer'
}

// Same project_users -> user_profiles(role in site_engineer/senior_site_engineer)
// scoping fetchTeamAttendanceSummary uses for its engineer list, minus the
// attendance-summary computation this screen's picker doesn't need yet.
export async function fetchProjectSiteEngineers(projectId: string): Promise<SiteEngineerOption[]> {
  const { data: assignments, error: assignError } = await supabase.from('project_users').select('user_id').eq('project_id', projectId);
  if (assignError) throw new Error(assignError.message);
  const engineerIds = (assignments ?? []).map((a) => a.user_id as string);
  if (engineerIds.length === 0) return [];

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, full_name, role')
    .in('role', ['site_engineer', 'senior_site_engineer'])
    .is('deleted_at', null)
    .in('id', engineerIds)
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ userId: r.id as string, fullName: r.full_name as string, role: r.role as string }));
}

export interface SiteEngineerDprRow {
  taskId: string;
  taskCode: string;
  taskName: string;
  workName: string;
  reportDate: string;
  submittedAtISO: string; // when this entry was actually logged, not just which day it's for
  percentComplete: number | null;
  dependencyCategories: DprDependencyCategory[];
  commentPreset: DprCommentPreset | null;
  commentText: string | null;
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
  submitted_by: string;
  created_at: string;
}

interface RawTaskRow {
  id: string;
  task_id: string;
  task_name: string;
  work: RawWork | RawWork[] | null;
  dpr_entries: RawEntry[] | null;
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

// PostgREST caps a single response at 1000 rows — same pagination
// convention as every other report fetch in this app.
const PAGE_SIZE = 1000;

const DPR_SELECT = `
  id, task_id, task_name,
  work:works!inner(name, code, project_id),
  dpr_entries!inner(task_id, report_date, percent_complete, dependency_categories, comment_preset, comment_text, submitted_by, created_at)
`;

// Same dpr_entries-joined-to-tasks query as fetchDprActivityReport, plus a
// filter on the entry's own submitted_by — one more .eq() on the same
// !inner-joined embed the project/date filters already use there.
async function fetchEngineerDprRows(projectId: string, userId: string, range: DateRange): Promise<SiteEngineerDprRow[]> {
  const all: RawTaskRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('tasks')
      .select(DPR_SELECT)
      .eq('work.project_id', projectId)
      .eq('dpr_entries.submitted_by', userId)
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

  const rows: SiteEngineerDprRow[] = [];
  for (const r of all) {
    const work = normalizeToOne(r.work);
    if (!isPilotVisible(r.task_id, work?.code)) continue;
    for (const entry of r.dpr_entries ?? []) {
      rows.push({
        taskId: r.id,
        taskCode: r.task_id,
        taskName: r.task_name,
        workName: work?.name ?? 'Unassigned',
        reportDate: entry.report_date,
        submittedAtISO: entry.created_at,
        percentComplete: entry.percent_complete,
        dependencyCategories: entry.dependency_categories ?? [],
        commentPreset: entry.comment_preset,
        commentText: entry.comment_text,
      });
    }
  }
  rows.sort((a, b) => b.reportDate.localeCompare(a.reportDate) || a.submittedAtISO.localeCompare(b.submittedAtISO));
  return rows;
}

// --- Quality Checklist -----------------------------------------------
// The print → sign (by the contractor) → photograph → upload loop from
// app/dpr-checklist/[taskId].tsx: a signed copy lands in dpr_entry_photos
// with photo_type 'signed_checklist' and uploaded_by set to whoever
// uploaded it (lib/dprChecklist.ts's uploadSignedChecklistPhoto) — the one
// piece of the quality-checklist flow that's actually attributable to a
// specific engineer, so that's what this section reports on, rather than
// checklist-item completion (dependency_completions.completed_by exists
// too, but isn't tied to "this engineer's own quality-checklist work" as
// directly as the signed upload itself is).

export interface SiteEngineerQualityChecklistRow {
  id: string;
  taskId: string;
  taskCode: string;
  taskName: string;
  workName: string;
  uploadedAtISO: string;
}

export interface SiteEngineerQualityChecklistSummary {
  uploadCount: number;
  taskCount: number; // distinct tasks with a signed checklist uploaded by this engineer
}

interface RawQualityTaskEmbed {
  id: string;
  task_id: string;
  task_name: string;
  work: RawWork | RawWork[] | null;
}

interface RawQualityPhotoRow {
  id: string;
  created_at: string;
  task: RawQualityTaskEmbed | RawQualityTaskEmbed[] | null;
}

const QUALITY_CHECKLIST_SELECT = `
  id, created_at,
  task:tasks!inner(id, task_id, task_name, work:works!inner(name, code, project_id))
`;

async function fetchEngineerQualityChecklistUploads(projectId: string, userId: string, range: DateRange): Promise<SiteEngineerQualityChecklistRow[]> {
  const fromISO = parseDateKeyUtc(range.from).toISOString();
  const toISO = parseDateKeyUtc(addDaysUtc(range.to, 1)).toISOString(); // exclusive — covers all of range.to's own day

  const all: RawQualityPhotoRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('dpr_entry_photos')
      .select(QUALITY_CHECKLIST_SELECT)
      .eq('photo_type', 'signed_checklist')
      .eq('uploaded_by', userId)
      .eq('task.work.project_id', projectId)
      .gte('created_at', fromISO)
      .lt('created_at', toISO)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RawQualityPhotoRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const rows: SiteEngineerQualityChecklistRow[] = [];
  for (const r of all) {
    const task = normalizeToOne(r.task);
    if (!task) continue;
    const work = normalizeToOne(task.work);
    if (!isPilotVisible(task.task_id, work?.code)) continue;
    rows.push({
      id: r.id,
      taskId: task.id,
      taskCode: task.task_id,
      taskName: task.task_name,
      workName: work?.name ?? 'Unassigned',
      uploadedAtISO: r.created_at,
    });
  }
  rows.sort((a, b) => b.uploadedAtISO.localeCompare(a.uploadedAtISO));
  return rows;
}

// --- Delay Tracking ---------------------------------------------------
// Same tasks.assigned_to attribution as monthlyReport.ts's own
// delayByPerson (assigned_to is a user_profiles.id FK, confirmed by that
// file's userMap.get(t.assignedTo) lookup) — tasks assigned to THIS
// engineer whose due_date falls in the picked range, so it uses the same
// shared range as Attendance/DPR below rather than a separate "currently
// overdue" concept.

export interface SiteEngineerDelayRow {
  taskId: string;
  taskCode: string;
  taskName: string;
  workName: string;
  dueDate: string | null;
  actualEndDate: string | null;
  isComplete: boolean;
  isOverdue: boolean; // still open, due date has already passed
  delayDays: number; // 0 = on time; own actual-vs-due gap once complete, else how many days overdue right now
}

interface RawDelayTaskRow {
  id: string;
  task_id: string;
  task_name: string;
  due_date: string | null;
  actual_end_date: string | null;
  cascade_delay_days: number | null;
  work: RawWork | RawWork[] | null;
}

const DELAY_SELECT = `
  id, task_id, task_name, due_date, actual_end_date, cascade_delay_days,
  work:works!inner(name, code, project_id)
`;

function dayGap(fromDateKey: string, toDateKey: string): number {
  return Math.round((parseDateKeyUtc(toDateKey).getTime() - parseDateKeyUtc(fromDateKey).getTime()) / 86_400_000);
}

// Effective delay for one task — same "own actual-vs-due gap if positive,
// else the inherited cascade_delay_days" priority rule as monthlyReport.ts's
// effectiveDelay, extended with a live "how many days overdue as of today"
// fallback for a still-open task neither of those two already cover (same
// concept as rangeTaskReport.ts's boolean isOverdue, generalized to a day
// count here since this report shows delayDays, not just a flag).
function resolveTaskDelay(
  t: { dueDate: string | null; actualEndDate: string | null; cascadeDelayDays: number | null },
  todayKey: string
): { isComplete: boolean; isOverdue: boolean; delayDays: number } {
  const isComplete = t.actualEndDate != null;
  if (isComplete) {
    const ownGap = t.dueDate ? dayGap(t.dueDate, t.actualEndDate!) : null;
    const delayDays = ownGap !== null && ownGap > 0 ? ownGap : Math.max(t.cascadeDelayDays ?? 0, 0);
    return { isComplete, isOverdue: false, delayDays };
  }
  const liveOverdueDays = t.dueDate && t.dueDate < todayKey ? dayGap(t.dueDate, todayKey) : 0;
  const delayDays = Math.max(liveOverdueDays, t.cascadeDelayDays ?? 0);
  return { isComplete, isOverdue: delayDays > 0, delayDays };
}

async function fetchEngineerDelayRows(projectId: string, userId: string, range: DateRange): Promise<SiteEngineerDelayRow[]> {
  const all: RawDelayTaskRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('tasks')
      .select(DELAY_SELECT)
      .eq('work.project_id', projectId)
      .eq('assigned_to', userId)
      .gte('due_date', range.from)
      .lte('due_date', range.to)
      .is('deleted_at', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RawDelayTaskRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const todayKey = toDateKeyUtc(new Date());
  const rows: SiteEngineerDelayRow[] = [];
  for (const r of all) {
    const work = normalizeToOne(r.work);
    if (!isPilotVisible(r.task_id, work?.code)) continue;
    const resolved = resolveTaskDelay({ dueDate: r.due_date, actualEndDate: r.actual_end_date, cascadeDelayDays: r.cascade_delay_days }, todayKey);
    rows.push({
      taskId: r.id,
      taskCode: r.task_id,
      taskName: r.task_name,
      workName: work?.name ?? 'Unassigned',
      dueDate: r.due_date,
      actualEndDate: r.actual_end_date,
      ...resolved,
    });
  }
  rows.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return rows;
}

// --- Leave ---------------------------------------------------------------
// "Leave" in this app (lib/leaveEvents.ts) is a mid-shift "stepping off
// site, here's why" announcement (material pickup/client visit/site
// inspection/supply run) — NOT a day-off/PTO request, which this app has no
// separate concept of. Reuses the same leave_events table/fetchLeaveLog the
// admin Leave Log tab (app/(authenticated)/leave-log.tsx) already reads,
// just scoped to one engineer + this report's own project/range instead of
// the whole team.

export interface SiteEngineerLeaveSummary {
  totalCount: number;
  byReason: { reasonPreset: LeaveReasonPresetValue; label: string; count: number }[];
}

async function fetchEngineerLeaveEvents(projectId: string, userId: string, range: DateRange): Promise<LeaveLogEntry[]> {
  const fromISO = parseDateKeyUtc(range.from).toISOString();
  const toISO = parseDateKeyUtc(addDaysUtc(range.to, 1)).toISOString(); // exclusive — covers all of range.to's own day
  return fetchLeaveLog({ userId, projectId, fromISO, toISO });
}

export interface SiteEngineerAttendanceSummary {
  presentDays: number;
  absentDays: number;
  lateDays: number;
  earlyDepartureDays: number;
  totalHoursOnSite: number;
  averageScore: number;
}

export interface SiteEngineerDprSummary {
  entryCount: number;
  taskCount: number; // distinct tasks across all rows
  cumulativePercent: number | null;
  // Regularity, not just a raw count — distinct calendar days with at least
  // one DPR entry, and what share of days this engineer was actually
  // PRESENT (attendanceSummary.presentDays) that covers. Present days is
  // the honest denominator — expecting a DPR on a day they weren't even on
  // site would just be wrong, so this can't be computed from dprRows alone.
  submissionDays: number;
  consistencyPercent: number | null; // null when presentDays is 0 — nothing to measure against
}

export interface SiteEngineerDelaySummary {
  tasksDueCount: number;
  delayedTaskCount: number; // completed late OR still open past due
  overdueOpenCount: number; // still open, past due, right now
  avgDelayDays: number; // averaged across every task due in range, including on-time (0d) ones
}

export interface SiteEngineerReport {
  engineer: SiteEngineerOption;
  range: DateRange;
  delayRows: SiteEngineerDelayRow[];
  delaySummary: SiteEngineerDelaySummary;
  attendance: DailyAttendanceRecord[];
  attendanceSummary: SiteEngineerAttendanceSummary;
  leaveEntries: LeaveLogEntry[];
  leaveSummary: SiteEngineerLeaveSummary;
  dprRows: SiteEngineerDprRow[];
  dprSummary: SiteEngineerDprSummary;
  qualityRows: SiteEngineerQualityChecklistRow[];
  qualitySummary: SiteEngineerQualityChecklistSummary;
}

export async function fetchSiteEngineerReport(projectId: string, engineer: SiteEngineerOption, range: DateRange): Promise<SiteEngineerReport> {
  const days = daysBetweenInclusive(range);
  // fetchEngineerDailyAttendance buckets by LOCAL calendar day (device
  // timezone), unlike dpr_entries.report_date which is UTC — anchoring
  // "now" at the end of the picked day's local date, then filtering the
  // result down to exactly [range.from, range.to] below, keeps the picked
  // range's own last day included regardless of that mismatch.
  const now = new Date(`${range.to}T23:59:59`);

  const [dailyAll, dprRows, delayRows, leaveEntries, qualityRows] = await Promise.all([
    fetchEngineerDailyAttendance(engineer.userId, { projectId, days, now }),
    fetchEngineerDprRows(projectId, engineer.userId, range),
    fetchEngineerDelayRows(projectId, engineer.userId, range),
    fetchEngineerLeaveEvents(projectId, engineer.userId, range),
    fetchEngineerQualityChecklistUploads(projectId, engineer.userId, range),
  ]);

  const attendance = dailyAll.filter((d) => d.date >= range.from && d.date <= range.to);

  const presentDays = attendance.filter((d) => !d.isAbsent).length;
  const absentDays = attendance.filter((d) => d.isAbsent).length;
  const lateDays = attendance.filter((d) => d.wasLate).length;
  const earlyDepartureDays = attendance.filter((d) => d.leftEarly).length;
  const totalHoursOnSite = Math.round(attendance.reduce((sum, d) => sum + (d.totalHoursOnSite ?? 0), 0) * 10) / 10;
  const averageScore = attendance.length > 0 ? Math.round(attendance.reduce((sum, d) => sum + d.score, 0) / attendance.length) : 0;

  const withPercent = dprRows.filter((r) => r.percentComplete != null);
  const cumulativePercent =
    withPercent.length > 0 ? Math.round((withPercent.reduce((sum, r) => sum + (r.percentComplete ?? 0), 0) / withPercent.length) * 10) / 10 : null;
  const submissionDays = new Set(dprRows.map((r) => r.reportDate)).size;
  const consistencyPercent = presentDays > 0 ? Math.round((submissionDays / presentDays) * 100) : null;

  const delayedTaskCount = delayRows.filter((r) => r.delayDays > 0).length;
  const overdueOpenCount = delayRows.filter((r) => r.isOverdue).length;
  const avgDelayDays = delayRows.length > 0 ? Math.round((delayRows.reduce((sum, r) => sum + r.delayDays, 0) / delayRows.length) * 10) / 10 : 0;

  const reasonCounts = new Map<LeaveReasonPresetValue, number>();
  for (const e of leaveEntries) reasonCounts.set(e.reasonPreset, (reasonCounts.get(e.reasonPreset) ?? 0) + 1);
  const byReason = [...reasonCounts.entries()]
    .map(([reasonPreset, count]) => ({ reasonPreset, label: leaveReasonLabelFor(reasonPreset, null), count }))
    .sort((a, b) => b.count - a.count);

  return {
    engineer,
    range,
    delayRows,
    delaySummary: { tasksDueCount: delayRows.length, delayedTaskCount, overdueOpenCount, avgDelayDays },
    attendance,
    attendanceSummary: { presentDays, absentDays, lateDays, earlyDepartureDays, totalHoursOnSite, averageScore },
    leaveEntries,
    leaveSummary: { totalCount: leaveEntries.length, byReason },
    dprRows,
    dprSummary: {
      entryCount: dprRows.length,
      taskCount: new Set(dprRows.map((r) => r.taskId)).size,
      cumulativePercent,
      submissionDays,
      consistencyPercent,
    },
    qualityRows,
    qualitySummary: { uploadCount: qualityRows.length, taskCount: new Set(qualityRows.map((r) => r.taskId)).size },
  };
}
