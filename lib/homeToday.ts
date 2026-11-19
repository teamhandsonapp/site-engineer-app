// Home › today (2026-11-19): the live numbers on the staff Home screen
// (components/home/AppHome.tsx) for the selected project. Every number comes
// from real data; there is no placeholder data in this file.
//
// Each number loads on its own (Promise.allSettled), so one failing query
// shows "Couldn't load" on its own row instead of blanking the whole screen.

import { supabase } from './supabase';
import { fetchMyPendingCriticalAlerts } from './criticalAlertMessages';
import { fetchPendingEditRequests } from './dprEditRequests';
import {
  fetchTodayDprEntries,
  fetchUrgentTasksForEngineer,
  fetchWeekDprTasks,
  inPreconstruction,
  type DprTask,
} from './dprEntries';
import { fetchProgressStatuses } from './taskProgressStatus';
import { fetchAttendanceForDate, fetchWorkforceFolders, type AttendanceStatus } from './workforce';

export type Metric<T> = { ok: true; value: T } | { ok: false; error: string };

export interface DprToday {
  due: number; // today's tasks that can take a DPR now
  submitted: number; // of those, submitted today
}

export interface ChecklistToday {
  pendingItems: number; // mandatory pre-construction items not Issued / Not Required
  tasksWaiting: number; // tasks those items hold back
}

export interface WorkersToday {
  present: number;
  absent: number;
  total: number; // everyone in the project's worker folders
}

export interface HomeToday {
  dpr: Metric<DprToday> | null; // null: this role doesn't fill DPRs
  criticalAlerts: Metric<number>;
  checklist: Metric<ChecklistToday>;
  workers: Metric<WorkersToday>;
  delayed: Metric<number>;
  editRequests: Metric<number> | null; // null: not an admin
}

// ── Pure helpers (unit-tested in lib/__tests__/homeToday.test.ts) ─────────

/**
 * Today's DPR, counted the way the DPR screen's Today list picks tasks:
 * tasks pushed to this engineer as urgent, plus tasks already started or
 * whose planned start has arrived. Tasks still in pre-construction are left
 * out: their DPR can't open until the checklist is done (they show in the
 * checklist row instead).
 */
export function summarizeDprToday(
  tasks: DprTask[],
  urgent: DprTask[],
  entries: Record<string, { dprSubmittedAtISO: string | null } | undefined>
): DprToday {
  const byId = new Map<string, DprTask>();
  for (const t of urgent) byId.set(t.id, t);
  for (const t of tasks) if (t.scheduledToday && !byId.has(t.id)) byId.set(t.id, t);
  const open = [...byId.values()].filter((t) => t.status !== 'completed' && !inPreconstruction(t.status));
  return { due: open.length, submitted: open.filter((t) => !!entries[t.id]?.dprSubmittedAtISO).length };
}

export interface ChecklistItemRow {
  task_id: string;
  is_mandatory: boolean | null;
  completion: { status: string } | { status: string }[] | null;
}

/** Cleared = Issued (YES, legacy PROCEED) or Not Required (NO): the database's own rule. */
export function summarizeChecklist(rows: ChecklistItemRow[]): ChecklistToday {
  const waiting = new Set<string>();
  let pendingItems = 0;
  for (const r of rows) {
    if (r.is_mandatory === false) continue;
    const c = Array.isArray(r.completion) ? r.completion[0] : r.completion;
    const status = c?.status ?? 'PENDING';
    if (status === 'YES' || status === 'PROCEED' || status === 'NO') continue;
    pendingItems += 1;
    waiting.add(r.task_id);
  }
  return { pendingItems, tasksWaiting: waiting.size };
}

export function summarizeWorkers(memberIds: string[], marks: Record<string, AttendanceStatus | undefined>): WorkersToday {
  let present = 0;
  let absent = 0;
  for (const id of memberIds) {
    if (marks[id] === 'present') present += 1;
    else if (marks[id] === 'absent') absent += 1;
  }
  return { present, absent, total: memberIds.length };
}

// ── Loaders ───────────────────────────────────────────────────────────────

async function fetchChecklistRows(taskIds: string[]): Promise<ChecklistItemRow[]> {
  const rows: ChecklistItemRow[] = [];
  // Chunked so a long id list never makes an over-long request URL.
  for (let i = 0; i < taskIds.length; i += 100) {
    const { data, error } = await supabase
      .from('dependency_items')
      .select('task_id, is_mandatory, completion:dependency_completions(status)')
      .in('task_id', taskIds.slice(i, i + 100))
      .neq('category', 'quantity');
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as ChecklistItemRow[]));
  }
  return rows;
}

async function loadWorkers(projectId: string, todayKey: string): Promise<WorkersToday> {
  const folders = await fetchWorkforceFolders(projectId);
  const memberIds = folders.flatMap((f) => f.members.map((m) => m.id));
  if (memberIds.length === 0) return { present: 0, absent: 0, total: 0 };
  return summarizeWorkers(memberIds, await fetchAttendanceForDate(memberIds, todayKey));
}

function settle<T>(r: PromiseSettledResult<T>): Metric<T> {
  if (r.status === 'fulfilled') return { ok: true, value: r.value };
  return { ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
}

export async function fetchHomeToday(opts: {
  projectId: string;
  userId: string;
  todayKey: string;
  withDpr: boolean;
  withEditRequests: boolean;
}): Promise<HomeToday> {
  const { projectId, userId, todayKey } = opts;

  // Every not-completed task of the project (same fetch the DPR screen uses).
  const tasksP = fetchWeekDprTasks(projectId, todayKey, todayKey, todayKey);

  const dprP = opts.withDpr
    ? (async () => {
        const [tasks, urgent] = await Promise.all([tasksP, fetchUrgentTasksForEngineer(projectId, userId, todayKey)]);
        const ids = [...new Set([...urgent, ...tasks.filter((t) => t.scheduledToday)].map((t) => t.id))];
        return summarizeDprToday(tasks, urgent, await fetchTodayDprEntries(ids, todayKey));
      })()
    : null;

  const checklistP = (async () => {
    const ids = (await tasksP).filter((t) => inPreconstruction(t.status)).map((t) => t.id);
    return ids.length ? summarizeChecklist(await fetchChecklistRows(ids)) : { pendingItems: 0, tasksWaiting: 0 };
  })();

  const delayedP = (async () => {
    const statuses = await fetchProgressStatuses((await tasksP).map((t) => t.id));
    let n = 0;
    for (const s of statuses.values()) if (s.status === 'delayed') n += 1;
    return n;
  })();

  const [dpr, alerts, checklist, workers, delayed, edits] = await Promise.allSettled([
    dprP ?? Promise.resolve(null),
    // Alerts sent to this user in the last 24 hours that nobody has acknowledged.
    fetchMyPendingCriticalAlerts(userId, 24).then((a) => a.length),
    checklistP,
    loadWorkers(projectId, todayKey),
    delayedP,
    opts.withEditRequests ? fetchPendingEditRequests(projectId).then((r) => r.length) : Promise.resolve(null),
  ]);

  return {
    dpr: opts.withDpr ? (settle(dpr) as Metric<DprToday>) : null,
    criticalAlerts: settle(alerts),
    checklist: settle(checklist),
    workers: settle(workers),
    delayed: settle(delayed),
    editRequests: opts.withEditRequests ? (settle(edits) as Metric<number>) : null,
  };
}
