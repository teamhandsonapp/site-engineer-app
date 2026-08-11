import { supabase } from './supabase';
import { isPilotVisible } from './pilot';

// Same "overdue" definition as admin-web's isOverdue() + every real call
// site's own status check (lib/utils/format.ts, combined inline wherever
// it's used) — dueDate in the past AND not yet completed. Also the same
// definition lib/projectStats.ts already uses for the dashboard's "Overdue
// Tasks" COUNT; this is the per-task detail behind that same number.
export interface OverdueTask {
  taskId: string; // uuid
  taskCode: string;
  taskName: string;
  workName: string;
  projectId: string;
  projectName: string;
  daysOverdue: number;
  // Whatever checklist items on this task are still not cleared (any
  // category, not just client) — "the pending [item] linked" alongside the
  // plain task name, so a behind-schedule task also shows what's actually
  // still blocking it.
  pendingItems: { itemId: string; itemLabel: string; category: string }[];
}

interface RawTaskRow {
  id: string;
  task_id: string;
  task_name: string;
  due_date: string;
  work: { name: string; code: string; project: { id: string; name: string } | null } | { name: string; code: string; project: { id: string; name: string } | null }[] | null;
  dependency_items: { id: string; item_label: string; category: string; completion: { status: string } | { status: string }[] | null }[] | null;
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

const CLEARED_STATUSES = new Set(['YES', 'PROCEED']);

const SELECT = `
  id, task_id, task_name, due_date,
  work:works!inner(name, code, project:projects!inner(id, name)),
  dependency_items(id, item_label, category, completion:dependency_completions(status))
`;

// Staff-wide, unscoped by project — same convention as fetchAllPendingClientAlerts()
// (filtered down to the selected project by the caller, same as that function).
export async function fetchOverdueTasks(): Promise<OverdueTask[]> {
  const today = new Date();
  const { data, error } = await supabase
    .from('tasks')
    .select(SELECT)
    .lt('due_date', today.toISOString().slice(0, 10))
    .neq('status', 'completed')
    .is('deleted_at', null);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as RawTaskRow[];
  const result: OverdueTask[] = [];

  for (const row of rows) {
    const work = normalizeToOne(row.work);
    if (!work || !work.project) continue;
    if (!isPilotVisible(row.task_id, work.code)) continue;

    const dueDate = new Date(row.due_date);
    const daysOverdue = Math.max(0, Math.round((today.getTime() - dueDate.getTime()) / 86_400_000));

    const pendingItems = (row.dependency_items ?? [])
      .map((i) => {
        const completion = normalizeToOne(i.completion);
        const status = completion?.status ?? 'PENDING';
        return { itemId: i.id, itemLabel: i.item_label, category: i.category, status };
      })
      .filter((i) => !CLEARED_STATUSES.has(i.status))
      .map(({ itemId, itemLabel, category }) => ({ itemId, itemLabel, category }));

    result.push({
      taskId: row.id,
      taskCode: row.task_id,
      taskName: row.task_name,
      workName: work.name,
      projectId: work.project.id,
      projectName: work.project.name,
      daysOverdue,
      pendingItems,
    });
  }

  return result.sort((a, b) => b.daysOverdue - a.daysOverdue);
}
