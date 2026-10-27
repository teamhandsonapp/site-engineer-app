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
  // "M01"/"M02"/... for a task that belongs to a flowchart milestone, by
  // explicit request — the picker shows this INSTEAD OF taskCode for those
  // tasks (e.g. "M01 — PCC works..." rather than "MILE-01 — PCC works..."),
  // since the raw per-task code read as a meaningful unique identifier when
  // it was really just internal sequential numbering; the milestone GROUP
  // is the real, meaningful thing to show. Null for a task with no
  // milestone (every other real task keeps showing its own taskCode as
  // before). Numbered by milestone creation order (Milestone 1 = M01,
  // Milestone 2 = M02, ...), not by parsing the milestone's own name
  // string, so a later rename doesn't break the numbering.
  milestoneLabel: string | null;
}

interface RawRow {
  id: string;
  task_id: string;
  task_name: string;
  hidden_from_flowchart: boolean;
  milestone_id: string | null;
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

// flowchartOnly restricts the list to whatever the mobile flowchart itself
// currently shows (hidden_from_flowchart = false) — by explicit request,
// for the Task Based Report's own task picker specifically: ROAST @
// Kokapet's picker should offer only its 15 milestone tasks, matching the
// flowchart, not all 314 hidden granular ones. Defaults to false (every
// other caller — e.g. Documents' own "Assign to Task" search — still sees
// every real task, which is what assigning a drawing to actual granular
// work needs).
export async function fetchProjectTaskOptions(projectId: string, flowchartOnly = false): Promise<ProjectTaskOption[]> {
  const all: RawRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('tasks')
      .select(`id, task_id, task_name, hidden_from_flowchart, milestone_id, work:works!inner(name, code, project_id)`)
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

  // Milestone creation order -> "M01"/"M02"/... — same ordering
  // lib/flowchart/milestones.ts's own fetchMilestones already uses, so this
  // numbering always agrees with the flowchart's own Milestone 1/2/...
  // labels regardless of what each milestone happens to be named.
  const { data: milestoneRows } = await supabase
    .from('milestones')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  const milestoneLabelById = new Map<string, string>();
  (milestoneRows ?? []).forEach((m: { id: string }, i: number) => {
    milestoneLabelById.set(m.id, `M${String(i + 1).padStart(2, '0')}`);
  });

  return all
    .map((row) => {
      const work = normalizeToOne(row.work);
      return { row, work };
    })
    .filter(({ row, work }) => isPilotVisible(row.task_id, work?.code))
    .filter(({ row }) => !flowchartOnly || !row.hidden_from_flowchart)
    .map(({ row, work }) => ({
      id: row.id,
      taskCode: row.task_id,
      taskName: row.task_name,
      workName: work?.name ?? 'Unassigned',
      milestoneLabel: row.milestone_id ? (milestoneLabelById.get(row.milestone_id) ?? null) : null,
    }));
}
