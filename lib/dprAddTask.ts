import { supabase } from './supabase';
import type { DprDependencyCategory, TaskStatus } from './dprEntries';

// DPR "+ Add task" — report progress on a task that started on site before
// it reached today's DPR list (supabase/migrations/20261113100000_dpr_add_task_from_site.sql).

export interface AddableTask {
  id: string;
  code: string;
  name: string;
  status: TaskStatus;
  plannedStart: string | null;
  plannedEnd: string | null;
}

/** The department's not-completed tasks in this project that aren't in today's DPR list. */
export async function fetchAddableTasks(projectId: string, workId: string, excludeIds: Set<string>): Promise<AddableTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, task_id, task_name, status, planned_start_date, current_planned_start_date, due_date, current_due_date, works!inner(project_id)')
    .eq('work_id', workId)
    .eq('works.project_id', projectId)
    .is('deleted_at', null)
    .neq('status', 'completed')
    .order('planned_start_date', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  type Row = {
    id: string; task_id: string; task_name: string; status: TaskStatus; planned_start_date: string | null;
    current_planned_start_date: string | null; due_date: string | null; current_due_date: string | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => !excludeIds.has(r.id))
    .map((r) => ({
      id: r.id,
      code: r.task_id,
      name: r.task_name,
      status: r.status,
      plannedStart: r.current_planned_start_date ?? r.planned_start_date,
      plannedEnd: r.current_due_date ?? r.due_date,
    }));
}

/** Per department (works.id): how many tasks "+ Add task" would list. One query for the project. */
export async function fetchAddableCounts(projectId: string, excludeIds: Set<string>): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, work_id, works!inner(project_id)')
    .eq('works.project_id', projectId)
    .is('deleted_at', null)
    .neq('status', 'completed');
  if (error) throw new Error(error.message);
  const out = new Map<string, number>();
  for (const r of (data ?? []) as unknown as { id: string; work_id: string | null }[]) {
    if (!r.work_id || excludeIds.has(r.id)) continue;
    out.set(r.work_id, (out.get(r.work_id) ?? 0) + 1);
  }
  return out;
}

/** Cumulative % already reported for the task (sum of its DPR rows, max 100). */
export async function fetchReportedPercent(taskId: string): Promise<number> {
  const { data, error } = await supabase.from('dpr_entries').select('percent_complete').eq('task_id', taskId);
  if (error) throw new Error(error.message);
  return Math.min(100, ((data ?? []) as { percent_complete: number | null }[]).reduce((s, r) => s + (r.percent_complete ?? 0), 0));
}

/** Names of FS predecessors that aren't finished yet (a warning only, never a block). */
export async function fetchUnfinishedPredecessors(taskId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('task_dependencies')
    .select('type, pred:tasks!task_dependencies_depends_on_task_id_fkey(task_name, status, deleted_at)')
    .eq('task_id', taskId)
    .eq('type', 'FS');
  if (error) return [];
  type P = { task_name: string; status: string; deleted_at: string | null };
  return ((data ?? []) as unknown as { pred: P | P[] | null }[])
    .map((r) => (Array.isArray(r.pred) ? r.pred[0] : r.pred))
    .filter((p): p is P => !!p && !p.deleted_at && p.status !== 'completed')
    .map((p) => p.task_name);
}

export async function submitTaskFromSite(input: {
  taskId: string;
  actualStart: string;
  actualEnd: string | null;
  percent: number;
  reasons: DprDependencyCategory[];
  note: string;
  userId: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('dpr_add_task_from_site', {
    p_task_id: input.taskId,
    p_actual_start: input.actualStart,
    p_actual_end: input.actualEnd,
    p_percent: Math.round(input.percent),
    p_reasons: input.reasons,
    p_note: input.note,
    p_submitted_by: input.userId,
  });
  if (error) {
    if (/function .*dpr_add_task_from_site.* does not exist|Could not find the function/i.test(error.message)) {
      throw new Error('The "+ Add task" database update has not been installed yet (supabase/migrations/20261113100000_dpr_add_task_from_site.sql).');
    }
    throw new Error(error.message);
  }
}

// ── Timing helpers (dates are 'YYYY-MM-DD', compared as calendar days) ──

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export type Timing = { tag: 'early' | 'on_time' | 'delayed'; label: string; delayDays: number };

export function timingOf(plannedStart: string | null, actualStart: string | null): Timing | null {
  if (!plannedStart || !actualStart) return null;
  const d = daysBetween(plannedStart, actualStart);
  if (d < 0) return { tag: 'early', label: `Started early (${-d} day${d === -1 ? '' : 's'})`, delayDays: 0 };
  if (d === 0) return { tag: 'on_time', label: 'On time', delayDays: 0 };
  return { tag: 'delayed', label: `Delayed by ${d} day${d === 1 ? '' : 's'}`, delayDays: d };
}

/** Why a reason for delay is required, or null when it's optional. */
export function delayReasonNeeded(
  t: { plannedStart: string | null; plannedEnd: string | null },
  actualStart: string | null,
  actualEnd: string | null,
  percent: number,
  todayKey: string
): string | null {
  if (t.plannedStart && actualStart && actualStart > t.plannedStart) {
    const d = daysBetween(t.plannedStart, actualStart);
    return `Started ${d} day${d === 1 ? '' : 's'} after planned`;
  }
  if (t.plannedEnd && actualEnd && actualEnd > t.plannedEnd) {
    const d = daysBetween(t.plannedEnd, actualEnd);
    return `Finished ${d} day${d === 1 ? '' : 's'} after planned`;
  }
  if (t.plannedEnd && todayKey > t.plannedEnd && percent < 100) {
    const d = daysBetween(t.plannedEnd, todayKey);
    return `Planned to finish ${d} day${d === 1 ? '' : 's'} ago and not 100% yet`;
  }
  return null;
}
