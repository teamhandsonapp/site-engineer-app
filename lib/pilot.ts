// Mirrors admin-web's lib/config/pilot.ts — client asked to scope the app
// down to only these 12 Civil-work tasks while every other Civil task stays
// fully intact in the database, just hidden from display surfaces (there:
// flowchart, Gantt, task lists, dashboard, notifications, client report;
// here: the same surfaces' mobile equivalents — flowchart, Gantt/timeline,
// Upcoming Alerts). Keep this list in sync with admin-web's if either changes.
//
// Turned back off — the pilot scoping was only ever meant to be temporary,
// not a permanent restriction. All real tasks are visible again everywhere
// this flag gates. Flip back to true (both here and in admin-web) if a
// pilot restriction is needed again later — nothing else about the
// mechanism was removed.
export const PILOT_MODE_ENABLED = false;

export const CIVIL_PILOT_TASK_IDS = ['1a', '1f', '1b', '1g', '1c', '1h', '1d', '1i', '1e', '1j', '2a', '2f'];

export function isPilotVisible(taskId: string, workCode: string | null | undefined): boolean {
  if (!PILOT_MODE_ENABLED) return true;
  if (workCode !== 'CIVIL') return true;
  return CIVIL_PILOT_TASK_IDS.includes(taskId);
}
