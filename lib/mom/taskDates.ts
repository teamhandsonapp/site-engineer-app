import { supabase } from '../supabase';

// Live dates/status for the tasks on a meeting's discussion list (one query).
export interface TaskDates {
  status: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  deleted: boolean;
}

export async function fetchTaskDates(taskIds: string[]): Promise<Map<string, TaskDates>> {
  const out = new Map<string, TaskDates>();
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from('tasks')
    .select('id, status, planned_start_date, current_planned_start_date, due_date, current_due_date, actual_start_date, actual_end_date, deleted_at')
    .in('id', ids);
  if (error) throw new Error(error.message);
  type Row = {
    id: string; status: string; planned_start_date: string | null; current_planned_start_date: string | null;
    due_date: string | null; current_due_date: string | null; actual_start_date: string | null; actual_end_date: string | null; deleted_at: string | null;
  };
  for (const r of (data ?? []) as Row[]) {
    out.set(r.id, {
      status: r.status,
      plannedStart: r.current_planned_start_date ?? r.planned_start_date,
      plannedEnd: r.current_due_date ?? r.due_date,
      actualStart: r.actual_start_date,
      actualEnd: r.actual_end_date,
      deleted: !!r.deleted_at,
    });
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2026-11-12' or a timestamp -> '12 Nov' (IST calendar day).
export function shortDay(iso: string | null): string {
  if (!iso) return '—';
  const key = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
