import { supabase } from './supabase';
import { isPilotVisible } from './pilot';
import { fetchAllPendingClientAlerts } from './dependencyAlerts';
import { fetchProcurementSchedule } from './tasks/procurementSchedule';

// Every formula here is ported from admin-web's real dashboard, not
// invented fresh for mobile — see app/(app)/projects/page.tsx (global) and
// app/(app)/projects/[projectId]/page.tsx (per-project) there:
//   - progressPct: % of TASKS (not checklist items) with status==='completed'
//     (admin-web's `completePct` / "Work Has Done" stat / arc gauge — NOT
//     the separate checklist-item-based "Deps Cleared %" also on that page).
//   - overdueTasks: dueDate < today AND status !== 'completed'
//     (admin-web's lib/utils/format.ts isOverdue(), combined with the
//     status check every real call site adds inline).
//   - pendingClientResponses: dependency_items(category='client') with no
//     completion row, or completion.status not in (YES, PROCEED) — exactly
//     fetchAllPendingClientAlerts()'s own NEEDS_ATTENTION_STATUSES set,
//     which is already kept in sync with admin-web's lib/data/notifications.ts.
//   - procurement "overdue" vs "due soon": fetchProcurementSchedule()'s own
//     urgency field ('overdue' vs 'overdue'+'imminent' combined) — same
//     working-day walk-back admin-web's lib/data/procurement.ts uses.
//
// All of it also respects isPilotVisible() the same way every other mobile
// screen (flowchart, Gantt, Upcoming Alerts) already does — admin-web's own
// dashboard applies the identical 12-task pilot filter (see lib/pilot.ts's
// own comment), so these numbers are directly comparable to admin-web's,
// not a different, unfiltered total that would never match.

interface RawTaskRow {
  id: string;
  task_id: string;
  status: string;
  due_date: string | null;
  work: { project_id: string | null; code: string | null } | { project_id: string | null; code: string | null }[] | null;
}

function normalizeWork(raw: RawTaskRow['work']): { project_id: string | null; code: string | null } | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export interface ProjectStat {
  projectId: string;
  projectName: string;
  totalTasks: number;
  completedTasks: number;
  progressPct: number;
  overdueTasks: number;
  pendingClientResponses: number;
  procurementOverdue: number;
  procurementDueSoon: number; // overdue + imminent (admin-web's getProcurementReminders())
}

export interface GlobalStats {
  totalProjects: number;
  totalPendingClientResponses: number;
  totalOverdueProcurement: number;
  totalCriticalAlerts: number; // the FLAGGED subset (ON_HOLD/NO) of pending client responses
}

// One shared fetch — both the global-stats cards and the per-project
// "Your Projects" list / Project Dashboard are just different slices of
// the same three underlying datasets, so this loads them once and derives
// every card from it rather than re-querying per project.
export async function fetchAllProjectStats(): Promise<{ projects: ProjectStat[]; global: GlobalStats }> {
  const [projectsRes, tasksRes, pendingAlerts, procurement] = await Promise.all([
    supabase.from('projects').select('id, name').order('name', { ascending: true }),
    supabase
      .from('tasks')
      .select('id, task_id, status, due_date, work:works(project_id, code)')
      .is('deleted_at', null),
    fetchAllPendingClientAlerts(),
    fetchProcurementSchedule(),
  ]);

  if (projectsRes.error) throw new Error(projectsRes.error.message);
  if (tasksRes.error) throw new Error(tasksRes.error.message);

  const now = new Date();

  const byProject = new Map<string, { total: number; completed: number; overdue: number }>();
  for (const row of (tasksRes.data ?? []) as unknown as RawTaskRow[]) {
    const work = normalizeWork(row.work);
    const projectId = work?.project_id;
    if (!projectId) continue;
    if (!isPilotVisible(row.task_id, work?.code)) continue;
    if (!byProject.has(projectId)) byProject.set(projectId, { total: 0, completed: 0, overdue: 0 });
    const bucket = byProject.get(projectId)!;
    bucket.total += 1;
    if (row.status === 'completed') bucket.completed += 1;
    if (row.due_date && new Date(row.due_date) < now && row.status !== 'completed') bucket.overdue += 1;
  }

  const pendingByProject = new Map<string, number>();
  const flaggedByProject = new Map<string, number>();
  for (const alert of pendingAlerts) {
    pendingByProject.set(alert.projectId, (pendingByProject.get(alert.projectId) ?? 0) + 1);
    if (alert.isFlagged) flaggedByProject.set(alert.projectId, (flaggedByProject.get(alert.projectId) ?? 0) + 1);
  }

  const procurementOverdueByProject = new Map<string, number>();
  const procurementDueSoonByProject = new Map<string, number>();
  for (const item of procurement.tasks) {
    if (!item.projectId) continue;
    if (item.urgency === 'overdue') {
      procurementOverdueByProject.set(item.projectId, (procurementOverdueByProject.get(item.projectId) ?? 0) + 1);
    }
    if (item.urgency !== 'normal') {
      procurementDueSoonByProject.set(item.projectId, (procurementDueSoonByProject.get(item.projectId) ?? 0) + 1);
    }
  }

  const projects: ProjectStat[] = ((projectsRes.data ?? []) as { id: string; name: string }[]).map((p) => {
    const taskBucket = byProject.get(p.id) ?? { total: 0, completed: 0, overdue: 0 };
    return {
      projectId: p.id,
      projectName: p.name,
      totalTasks: taskBucket.total,
      completedTasks: taskBucket.completed,
      progressPct: taskBucket.total > 0 ? Math.round((taskBucket.completed / taskBucket.total) * 100) : 0,
      overdueTasks: taskBucket.overdue,
      pendingClientResponses: pendingByProject.get(p.id) ?? 0,
      procurementOverdue: procurementOverdueByProject.get(p.id) ?? 0,
      procurementDueSoon: procurementDueSoonByProject.get(p.id) ?? 0,
    };
  });

  const global: GlobalStats = {
    totalProjects: projects.length,
    totalPendingClientResponses: pendingAlerts.length,
    totalOverdueProcurement: procurement.tasks.filter((t) => t.urgency === 'overdue').length,
    totalCriticalAlerts: pendingAlerts.filter((a) => a.isFlagged).length,
  };

  return { projects, global };
}

export function findProjectStat(stats: ProjectStat[], projectId: string): ProjectStat | null {
  return stats.find((p) => p.projectId === projectId) ?? null;
}
