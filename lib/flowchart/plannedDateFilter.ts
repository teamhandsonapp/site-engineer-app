import type { FlowchartTask } from './types';

// Flowchart's own date-range filter — by explicit request: "FILTER BASED ON
// THE DATES (Custom Dates)" + "FILTER BY Supposed to complete and Suppose
// to happen and Suppose to start". Read together as one filter (a picked
// date range, checked against one of three planned-date meanings) rather
// than two separate features — a single mode+range control in
// FlowchartFilterModal.tsx covers all of it.
//
// Deliberately PLANNED dates, not actual ones — "supposed to" is the
// spec's own word. Uses the same currentPlannedStartDate/currentDueDate ??
// plannedStartDate/dueDate fallback chain as phaseCompletion.ts's own
// projectedCompletion (actualEndDate ?? currentDueDate ?? dueDate) — the
// live/working schedule after any upstream cascade, falling back to the
// original plan when no cascade has touched this task.
export type PlannedDateMode = 'start' | 'complete' | 'happening';

export const PLANNED_DATE_MODE_LABEL: Record<PlannedDateMode, string> = {
  start: 'Supposed to start',
  complete: 'Supposed to complete',
  happening: 'Supposed to be happening',
};

export function effectivePlannedStart(t: Pick<FlowchartTask, 'plannedStartDate' | 'currentPlannedStartDate'>): string | null {
  return t.currentPlannedStartDate ?? t.plannedStartDate;
}

export function effectivePlannedDue(t: Pick<FlowchartTask, 'dueDate' | 'currentDueDate'>): string | null {
  return t.currentDueDate ?? t.dueDate;
}

// mode 'start'/'complete': the single relevant date falls inside [from, to].
// mode 'happening': the task's whole planned window [start, due] overlaps
// [from, to] at all — standard interval-overlap check, not an exact-date
// match, since "supposed to be happening" means anytime during that span,
// not just on its boundary days. A task missing one of its two planned
// dates uses whichever one it has as a single-point window rather than
// being excluded outright.
export function matchesPlannedDateFilter(
  t: Pick<FlowchartTask, 'plannedStartDate' | 'currentPlannedStartDate' | 'dueDate' | 'currentDueDate'>,
  mode: PlannedDateMode,
  from: string,
  to: string
): boolean {
  if (mode === 'start') {
    const d = effectivePlannedStart(t);
    return d !== null && d >= from && d <= to;
  }
  if (mode === 'complete') {
    const d = effectivePlannedDue(t);
    return d !== null && d >= from && d <= to;
  }
  const start = effectivePlannedStart(t);
  const due = effectivePlannedDue(t);
  if (start === null && due === null) return false;
  const windowStart = start ?? due!;
  const windowEnd = due ?? start!;
  return windowStart <= to && windowEnd >= from;
}
