import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';
import { subtractWorkingDaysSync } from '../workingDays';
import type { TaskTypeOption } from '../flowchart/types';

// Mirrors admin-web's lib/data/procurement.ts getProcurementTimeData() — same
// "must start by" definition (plannedStartDate minus the Task Type's own
// duration, in working days) and the same 7-day imminent window. Returns
// EVERY pilot-visible task that has a Task Type set, same as the admin
// Procurement Time page's "Tasks with a Task Type" list — not just an
// urgency-filtered subset — since that full list is what this mobile screen
// is meant to mirror. Also returns the "not set" list (tasks with no Task
// Type at all), same as admin-web's collapsible section for those.
export const PROCUREMENT_IMMINENT_WINDOW_DAYS = 7;

export type ProcurementUrgency = 'overdue' | 'imminent' | 'normal';

export interface ProcurementScheduleItem {
  id: string;
  taskId: string;
  taskName: string;
  workName: string;
  projectId: string | null;
  taskTypeId: string;
  taskTypeName: string;
  durationDays: number;
  plannedStartDate: string; // 'YYYY-MM-DD'
  mustStartByDate: string; // 'YYYY-MM-DD'
  daysUntilMustStartBy: number; // negative = already overdue
  urgency: ProcurementUrgency;
}

export interface ProcurementNotSetItem {
  id: string;
  taskId: string;
  taskName: string;
  workName: string;
  projectId: string | null;
}

export interface ProcurementScheduleData {
  tasks: ProcurementScheduleItem[];
  notSet: ProcurementNotSetItem[];
  taskTypes: TaskTypeOption[];
}

interface RawRow {
  id: string;
  task_id: string;
  task_name: string;
  planned_start_date: string | null;
  task_type_id: string | null;
  task_type: { name: string; default_duration_days: number } | null;
  work: { name: string; code: string; project_id: string | null } | null;
}

function parseDateKeyUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// No `holidays` table access needed beyond a plain read — same pre-existing
// gap admin-web's own live DB already has (RLS disabled, open SELECT to
// anon/authenticated), not something this feature introduces.
async function fetchBlockedDates(years: Set<number>): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (years.size === 0) return blocked;
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const { data, error } = await supabase
    .from('holidays')
    .select('date')
    .gte('date', `${minYear}-01-01`)
    .lte('date', `${maxYear}-12-31`);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { date: string }[]) blocked.add(row.date);
  return blocked;
}

export async function fetchProcurementSchedule(): Promise<ProcurementScheduleData> {
  const [tasksRes, typesRes] = await Promise.all([
    supabase
      .from('tasks')
      .select(`
        id, task_id, task_name, planned_start_date, task_type_id,
        task_type:task_types(name, default_duration_days),
        work:works(name, code, project_id)
      `)
      .is('deleted_at', null),
    supabase.from('task_types').select('id, name, default_duration_days').order('default_duration_days', { ascending: true }),
  ]);

  const { data, error } = tasksRes;
  if (error) throw new Error(error.message);
  if (typesRes.error) throw new Error(typesRes.error.message);
  const taskTypes: TaskTypeOption[] = ((typesRes.data ?? []) as { id: string; name: string; default_duration_days: number }[])
    .map((t) => ({ id: t.id, name: t.name, defaultDurationDays: t.default_duration_days }));

  const visible = ((data ?? []) as unknown as RawRow[]).filter((r) => isPilotVisible(r.task_id, r.work?.code));
  const withType = visible.filter((r) => r.task_type && r.planned_start_date && r.task_type_id);
  const notSet = visible.filter((r) => !r.task_type_id);

  // A working-day walk backward from plannedStartDate can cross into the
  // previous calendar year (a long-lead task type's duration can span
  // several months) — fetching both that year and the one before covers
  // every task here, same reasoning as admin-web's own version.
  const years = new Set<number>();
  for (const r of withType) {
    const y = parseDateKeyUtc(r.planned_start_date!).getUTCFullYear();
    years.add(y);
    years.add(y - 1);
  }
  const blockedDates = await fetchBlockedDates(years);

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const tasks: ProcurementScheduleItem[] = withType.map((r) => {
    const plannedStart = parseDateKeyUtc(r.planned_start_date!);
    const mustStartBy = subtractWorkingDaysSync(plannedStart, r.task_type!.default_duration_days, blockedDates);
    const daysUntilMustStartBy = Math.round((mustStartBy.getTime() - today.getTime()) / 86_400_000);
    const urgency: ProcurementUrgency =
      daysUntilMustStartBy < 0 ? 'overdue' : daysUntilMustStartBy <= PROCUREMENT_IMMINENT_WINDOW_DAYS ? 'imminent' : 'normal';

    return {
      id: r.id,
      taskId: r.task_id,
      taskName: r.task_name,
      workName: r.work?.name ?? 'Unassigned',
      projectId: r.work?.project_id ?? null,
      taskTypeId: r.task_type_id!,
      taskTypeName: r.task_type!.name,
      durationDays: r.task_type!.default_duration_days,
      plannedStartDate: r.planned_start_date!,
      mustStartByDate: toDateKeyUtc(mustStartBy),
      daysUntilMustStartBy,
      urgency,
    };
  });

  return {
    tasks,
    notSet: notSet.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      taskName: r.task_name,
      workName: r.work?.name ?? 'Unassigned',
      projectId: r.work?.project_id ?? null,
    })),
    taskTypes,
  };
}
