import { supabase } from './supabase';
import { isPilotVisible } from './pilot';
import { worstChecklistStatus, type ChecklistItem, type CompletionStatus } from './checklistHealth';
import { computeGroundedIds, computeProjectDelays, type TaskDelayInfo } from './gantt/delayEngine';
import { getTaskTypeColors } from './flowchart/taskTypeColor';
import type { AccountabilityType, DependencyType } from './flowchart/types';
import type { TaskStatus } from './statusColors';

export interface TimelineTask {
  id: string;
  taskCode: string; // human-readable business code, e.g. "1a"
  taskName: string;
  status: TaskStatus;
  plannedStartDate: string | null; // 'YYYY-MM-DD'
  dueDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  taskTypeId: string | null;
  workAccountabilityType: AccountabilityType | null;
  // Full per-item checklist breakdown (every category/item, not just a
  // rollup) — powers the Gantt screen's checklist-health indicator + tap
  // panel, the same underlying data admin-web's Gantt tooltip shows.
  checklistItems: ChecklistItem[];
  worstChecklistStatus: CompletionStatus | null;
}

export interface TimelineWork {
  workId: string;
  workName: string;
  workCode: string;
  workColor: string;
  tasks: TimelineTask[];
}

export interface ProjectTimelineData {
  works: TimelineWork[];
  // Same shared CPM delay engine both the bars AND the tap-for-detail sheet
  // read from — computed ONCE here, not independently recalculated by the
  // detail sheet (unlike admin-web's own popup, which re-invokes the engine
  // fresh per tap; reading the already-computed map instead is simpler and,
  // if anything, more consistent — see gantt.tsx's own comment).
  delayById: Record<string, TaskDelayInfo>;
  groundedIds: Set<string>;
  taskTypeColors: Record<string, string>;
}

// A dependency_items row's own completion is created LAZILY (see
// lib/dependencyAlerts.ts's identical note) — "no row yet" is treated as
// PENDING below, not "nothing to show." PostgREST may represent the to-one
// completion embed as an object or a 1-element array depending on version,
// same normalizeCompletion() gotcha as dependencyAlerts.ts.
interface RawDependencyItem {
  category: string;
  item_label: string;
  completion: { status: string } | { status: string }[] | null;
}

interface RawTaskRow {
  id: string;
  task_id: string;
  task_name: string;
  status: string;
  planned_start_date: string | null;
  due_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  task_type_id: string | null;
  accountability_type: AccountabilityType | null;
  work: { id: string; name: string; code: string; color: string; accountability_type: AccountabilityType | null } | null;
  dependency_items: RawDependencyItem[] | null;
}

interface RawDependencyRow {
  task_id: string;
  depends_on_task_id: string;
  type: DependencyType;
}

function normalizeCompletionStatus(raw: RawDependencyItem['completion']): CompletionStatus {
  if (!raw) return 'PENDING';
  const row = Array.isArray(raw) ? raw[0] : raw;
  return (row?.status as CompletionStatus | undefined) ?? 'PENDING';
}

function parseDateKeyUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

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

// Real Gantt parity with admin-web: fetches the same task/work/dependency
// data, runs the same CPM delay engine (lib/gantt/delayEngine.ts, ported
// from admin-web's lib/utils/delay-engine.ts) to get real projected-start/
// projected-finish/delay figures per task, and returns the taskTypeColors
// map GanttTaskBars needs for the rare ACC/AV-tinted planned-bar case.
export async function fetchProjectTimeline(projectId: string): Promise<ProjectTimelineData> {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      id, task_id, task_name, status, planned_start_date, due_date,
      actual_start_date, actual_end_date, task_type_id, accountability_type,
      work:works!inner(id, name, code, color, accountability_type, project_id),
      dependency_items(category, item_label, completion:dependency_completions(status))
    `)
    .eq('work.project_id', projectId)
    .is('deleted_at', null)
    .order('planned_start_date', { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);

  // Pilot mode (lib/pilot.ts, mirrors admin-web's lib/config/pilot.ts):
  // client asked to scope every display surface down to only 12 Civil-work
  // tasks for now, everything else stays in the DB untouched but hidden.
  const rows = ((data ?? []) as unknown as RawTaskRow[]).filter((r) => isPilotVisible(r.task_id, r.work?.code));
  const taskIds = new Set(rows.map((r) => r.id));

  const [depsRes, typesRes] = await Promise.all([
    supabase.from('task_dependencies').select('task_id, depends_on_task_id, type'),
    supabase.from('task_types').select('id, name, default_duration_days').order('default_duration_days', { ascending: true }),
  ]);
  if (depsRes.error) throw new Error(depsRes.error.message);
  if (typesRes.error) throw new Error(typesRes.error.message);

  const dependencies = ((depsRes.data ?? []) as unknown as RawDependencyRow[]).filter(
    (d) => taskIds.has(d.task_id) && taskIds.has(d.depends_on_task_id)
  );

  const years = new Set<number>();
  for (const r of rows) {
    for (const key of [r.planned_start_date, r.due_date, r.actual_start_date, r.actual_end_date]) {
      if (key) years.add(parseDateKeyUtc(key).getUTCFullYear());
    }
  }
  const blockedDates = await fetchBlockedDates(years);

  const engineTasks = rows.map((r) => ({
    taskId: r.id,
    plannedStartDate: r.planned_start_date ? parseDateKeyUtc(r.planned_start_date) : null,
    dueDate: r.due_date ? parseDateKeyUtc(r.due_date) : null,
    actualStartDate: r.actual_start_date ? parseDateKeyUtc(r.actual_start_date) : null,
    actualEndDate: r.actual_end_date ? parseDateKeyUtc(r.actual_end_date) : null,
    status: r.status as TaskStatus,
  }));
  const engineDeps = dependencies.map((d) => ({
    taskId: d.task_id,
    dependsOnTaskId: d.depends_on_task_id,
    type: d.type,
  }));

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const delays = computeProjectDelays(engineTasks, engineDeps, blockedDates, today);
  const groundedIds = computeGroundedIds(engineTasks, engineDeps);

  const delayById: Record<string, TaskDelayInfo> = {};
  for (const [id, info] of delays) delayById[id] = info;

  const taskTypeColors = getTaskTypeColors(
    ((typesRes.data ?? []) as { id: string; name: string; default_duration_days: number }[]).map((t) => ({
      id: t.id,
      defaultDurationDays: t.default_duration_days,
    }))
  );

  const byWork = new Map<string, TimelineWork>();
  for (const r of rows) {
    if (!r.work) continue;
    if (!byWork.has(r.work.id)) {
      byWork.set(r.work.id, {
        workId: r.work.id,
        workName: r.work.name,
        workCode: r.work.code,
        workColor: r.work.color,
        tasks: [],
      });
    }
    const checklistItems: ChecklistItem[] = (r.dependency_items ?? []).map((i) => ({
      category: i.category as ChecklistItem['category'],
      itemLabel: i.item_label,
      status: normalizeCompletionStatus(i.completion),
    }));
    byWork.get(r.work.id)!.tasks.push({
      id: r.id,
      taskCode: r.task_id,
      taskName: r.task_name,
      status: r.status as TaskStatus,
      plannedStartDate: r.planned_start_date,
      dueDate: r.due_date,
      actualStartDate: r.actual_start_date,
      actualEndDate: r.actual_end_date,
      taskTypeId: r.task_type_id,
      // Same resolution as admin-web's lib/data/works.ts: task's own
      // override wins over the Work's default.
      workAccountabilityType: r.accountability_type ?? r.work.accountability_type ?? null,
      checklistItems,
      worstChecklistStatus: worstChecklistStatus(checklistItems.map((i) => i.status)),
    });
  }

  return { works: [...byWork.values()], delayById, groundedIds, taskTypeColors };
}
