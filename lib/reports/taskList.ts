import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';

// Task Report's task picker — unlike admin-web's own listTaskReportOptions()
// (a global, unscoped list across every project), this is scoped to the
// current project via the proven work:works!inner(project_id) + .eq('work.
// project_id', ...) pattern already used by lib/flowchart/data.ts and
// lib/projectTimeline.ts, matching this app's whole "current project" nav
// paradigm rather than admin-web's own gap.

export interface ProjectTaskOption {
  id: string;
  taskCode: string;
  taskName: string;
  workName: string;
}

interface RawRow {
  id: string;
  task_id: string;
  task_name: string;
  work: { name: string; code: string | null } | { name: string; code: string | null }[] | null;
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

// PostgREST caps a single response at 1000 rows by default — this project's
// task count (311) is well under that today, but a raw single-request fetch
// would silently truncate once it isn't (see lib/reports/weeklyReport.ts's
// own comment on the bug this exact gap caused for pending-client-response
// counts), so this pages through from the start rather than assuming one
// request is enough.
const PAGE_SIZE = 1000;

export async function fetchProjectTaskOptions(projectId: string): Promise<ProjectTaskOption[]> {
  const all: RawRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('tasks')
      .select(`id, task_id, task_name, work:works!inner(name, code, project_id)`)
      .eq('work.project_id', projectId)
      .is('deleted_at', null)
      .order('task_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RawRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all
    .map((row) => {
      const work = normalizeToOne(row.work);
      return { row, work };
    })
    .filter(({ row, work }) => isPilotVisible(row.task_id, work?.code))
    .map(({ row, work }) => ({
      id: row.id,
      taskCode: row.task_id,
      taskName: row.task_name,
      workName: work?.name ?? 'Unassigned',
    }));
}
