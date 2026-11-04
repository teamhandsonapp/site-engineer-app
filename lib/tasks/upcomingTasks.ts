import { supabase } from '../supabase';
import { isPilotVisible } from '../pilot';

// How far ahead "upcoming" looks. Named so it's one place to change, not a
// magic number repeated across the query and the UI copy.
export const UPCOMING_TASK_WINDOW_DAYS = 30;

// Boundaries for the three urgency buckets used for styling — chosen to
// roughly mirror a typical work week / two weeks / rest-of-window split,
// since this app has no existing urgency convention to match (see
// tailwind.config.js — only brand navy/amber are defined, no status colors).
const URGENT_WITHIN_DAYS = 7;
const SOON_WITHIN_DAYS = 14;

export type UrgencyBucket = 'urgent' | 'soon' | 'upcoming';

export interface UpcomingTask {
  id: string;
  taskId: string;
  taskName: string;
  workName: string;
  workCode: string;
  projectName: string | null;
  plannedStartDate: string; // 'YYYY-MM-DD', as stored
  daysRemaining: number;
  urgency: UrgencyBucket;
  countdownLabel: string;
}

// Parses a 'YYYY-MM-DD' string as a *local* calendar day, not UTC — a plain
// `new Date('YYYY-MM-DD')` parses as UTC midnight, which reads as the
// previous day everywhere west of UTC. Matches the same parsing convention
// admin-web's WorkingDayPicker uses for the identical reason.
function parseDateKey(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayDateOnly(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function calendarDaysBetween(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

function countdownLabel(daysRemaining: number): string {
  if (daysRemaining <= 0) return 'Starts today';
  if (daysRemaining === 1) return 'Starts tomorrow';
  return `Starts in ${daysRemaining} days`;
}

function urgencyBucket(daysRemaining: number): UrgencyBucket {
  if (daysRemaining <= URGENT_WITHIN_DAYS) return 'urgent';
  if (daysRemaining <= SOON_WITHIN_DAYS) return 'soon';
  return 'upcoming';
}

// Raw shape PostgREST returns for the nested work/project embed — supabase-js
// types this as `any` without generated types (this repo has none, see
// PROJECT_SUMMARY.md), so this interface documents the actual shape
// confirmed by a live query rather than leaving it untyped.
interface RawUpcomingTaskRow {
  id: string;
  task_id: string;
  task_name: string;
  planned_start_date: string;
  status: string;
  work: { name: string; code: string; project: { name: string } | null } | null;
}

// tasks/works/projects DO have RLS enabled (confirmed live: an anon,
// unauthenticated read is rejected outright) — its policy just grants staff
// unrestricted SELECT across every project (`current_app_role() <> 'client'`
// in admin-web/supabase/rls-policies.sql), which is why this unscoped-looking
// query still returns every project's tasks: the database is doing that on
// purpose for a staff caller, not failing to scope it. This function is only
// ever called from staff-gated screens (see NotificationBell.tsx's own
// comment) — a client-role caller would see just their own project's rows.
export async function fetchUpcomingTasks(): Promise<UpcomingTask[]> {
  const today = todayDateOnly();
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + UPCOMING_TASK_WINDOW_DAYS);

  const toKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const { data, error } = await supabase
    .from('tasks')
    .select('id, task_id, task_name, planned_start_date, status, work:works(name, code, project:projects(name))')
    .gte('planned_start_date', toKey(today))
    .lte('planned_start_date', toKey(windowEnd))
    .not('status', 'in', '(in_progress,completed)')
    .order('planned_start_date', { ascending: true });

  if (error) throw new Error(error.message);

  // Pilot mode (lib/pilot.ts, mirrors admin-web's lib/config/pilot.ts):
  // client asked to scope every display surface down to only 12 Civil-work
  // tasks for now, everything else stays in the DB untouched but hidden.
  const rows = ((data ?? []) as unknown as RawUpcomingTaskRow[]).filter((r) =>
    isPilotVisible(r.task_id, r.work?.code)
  );

  return rows.map((r) => {
    const daysRemaining = calendarDaysBetween(today, parseDateKey(r.planned_start_date));
    return {
      id: r.id,
      taskId: r.task_id,
      taskName: r.task_name,
      workName: r.work?.name ?? 'Unknown trade',
      workCode: r.work?.code ?? '—',
      projectName: r.work?.project?.name ?? null,
      plannedStartDate: r.planned_start_date,
      daysRemaining,
      urgency: urgencyBucket(daysRemaining),
      countdownLabel: countdownLabel(daysRemaining),
    };
  });
}
