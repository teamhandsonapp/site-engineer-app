// Project-scoped task data for the MoM Reports + Custom Alerts tabs:
// pending / upcoming lists, the task-based report, project health numbers,
// and which engineers work in a department. Read-only — all from the same
// tasks/works tables the rest of the app already uses.

import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';
import { fetchProjectEngineers, type ProjectEngineer } from '../criticalAlertMessages';

export type TaskStatus = 'draft' | 'ready' | 'in_progress' | 'on_hold' | 'blocked' | 'completed';

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  draft: 'Not started',
  ready: 'Ready',
  in_progress: 'In progress',
  on_hold: 'On hold',
  blocked: 'Blocked',
  completed: 'Completed',
};

export interface ProjectTask {
  id: string;
  code: string;
  name: string;
  status: TaskStatus;
  workId: string | null;
  workName: string;
  plannedStart: string | null; // 'YYYY-MM-DD'
  due: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  assignedTo: string | null;
}

interface RawTask {
  id: string;
  task_id: string;
  task_name: string;
  status: TaskStatus;
  work_id: string | null;
  planned_start_date: string | null;
  current_planned_start_date: string | null;
  due_date: string | null;
  current_due_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  assigned_to: string | null;
  work: { name: string; code: string; project_id: string } | null;
}

export async function fetchProjectTasks(projectId: string): Promise<ProjectTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(
      'id, task_id, task_name, status, work_id, planned_start_date, current_planned_start_date, due_date, current_due_date, actual_start_date, actual_end_date, assigned_to, work:works!inner(name, code, project_id)'
    )
    .eq('work.project_id', projectId)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as RawTask[])
    .filter((r) => isPilotVisible(r.task_id, r.work?.code))
    .map((r) => ({
      id: r.id,
      code: r.task_id,
      name: r.task_name,
      status: r.status,
      workId: r.work_id,
      workName: r.work?.name ?? 'Other',
      plannedStart: r.current_planned_start_date ?? r.planned_start_date,
      due: r.current_due_date ?? r.due_date,
      actualStart: r.actual_start_date,
      actualEnd: r.actual_end_date,
      assignedTo: r.assigned_to,
    }))
    .sort((a, b) => (a.plannedStart ?? '9999').localeCompare(b.plannedStart ?? '9999'));
}

// IST calendar date, same reasoning as lib/attendance.ts's istStartOfToday.
export function todayIST(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const UPCOMING_WINDOW_DAYS = 30;

// Pending = not completed and already due to have started (planned start
// on or before today). Overdue = pending and past its due date.
export function pendingTasks(tasks: ProjectTask[], today = todayIST()): ProjectTask[] {
  return tasks.filter((t) => t.status !== 'completed' && t.plannedStart != null && t.plannedStart <= today);
}

// Upcoming = not started yet, planned to start within the next 30 days.
export function upcomingTasks(tasks: ProjectTask[], today = todayIST()): ProjectTask[] {
  const end = addDays(today, UPCOMING_WINDOW_DAYS);
  return tasks.filter(
    (t) => (t.status === 'draft' || t.status === 'ready') && t.plannedStart != null && t.plannedStart > today && t.plannedStart <= end
  );
}

export function isOverdue(t: ProjectTask, today = todayIST()): boolean {
  return t.status !== 'completed' && t.due != null && t.due < today;
}

export function daysLate(t: ProjectTask, today = todayIST()): number {
  if (!t.due || !isOverdue(t, today)) return 0;
  return Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${t.due}T00:00:00Z`).getTime()) / 86_400_000);
}

export interface ProjectHealth {
  total: number;
  byStatus: Record<TaskStatus, number>;
  completedPercent: number;
  overdue: ProjectTask[];
  pending: ProjectTask[];
  upcoming: ProjectTask[];
  byDepartment: { workName: string; total: number; completed: number; overdue: number }[];
}

export function computeProjectHealth(tasks: ProjectTask[], today = todayIST()): ProjectHealth {
  const byStatus = { draft: 0, ready: 0, in_progress: 0, on_hold: 0, blocked: 0, completed: 0 } as Record<TaskStatus, number>;
  const dept = new Map<string, { total: number; completed: number; overdue: number }>();
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const d = dept.get(t.workName) ?? { total: 0, completed: 0, overdue: 0 };
    d.total += 1;
    if (t.status === 'completed') d.completed += 1;
    if (isOverdue(t, today)) d.overdue += 1;
    dept.set(t.workName, d);
  }
  return {
    total: tasks.length,
    byStatus,
    completedPercent: tasks.length ? Math.round((byStatus.completed / tasks.length) * 100) : 0,
    overdue: tasks.filter((t) => isOverdue(t, today)),
    pending: pendingTasks(tasks, today),
    upcoming: upcomingTasks(tasks, today),
    byDepartment: Array.from(dept.entries())
      .map(([workName, v]) => ({ workName, ...v }))
      .sort((a, b) => a.workName.localeCompare(b.workName)),
  };
}

// Engineers who have at least one task in this department, out of the
// engineers assigned to the project. Empty when nobody is assigned yet —
// the Custom Alerts tab then lets the admin pick recipients by hand.
export async function fetchDepartmentEngineers(
  projectId: string,
  workId: string,
  tasks: ProjectTask[]
): Promise<{ inDepartment: ProjectEngineer[]; all: ProjectEngineer[] }> {
  const all = await fetchProjectEngineers(projectId);
  const assigned = new Set(tasks.filter((t) => t.workId === workId && t.assignedTo).map((t) => t.assignedTo as string));
  return { inDepartment: all.filter((e) => assigned.has(e.id)), all };
}
