import { formatActualDateRange } from './delay';
import { daysFromTo, delaySplit, formatDelaySplit } from './delaySplit';

// Sheet View's two date columns (2026-11-15), every day counted:
//   "Completed": finished tasks only — actual start – end, then the
//     Pre-con / Const / Total delay (same line as the card).
//   "Not completed": every other task — no dates, only the status and delay:
//     "Upcoming"            planned start still ahead
//     "Delayed" + "Nd delay" not started past its planned start, or running
//                            (days past planned end, else how late it started)

export interface SheetStatusTask {
  plannedStartDate: string | null;
  dueDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
}

export interface SheetCell {
  /** "Completed" on finished tasks, shown above the dates. */
  status?: string;
  dates: string;
  delay: string | null;
}

export function sheetStatus(t: SheetStatusTask, today: string): { completed: SheetCell | null; open: SheetCell | null } {
  const ps = t.plannedStartDate;
  const pe = t.dueDate;

  if (t.actualEndDate) {
    const split = delaySplit({ plannedStart: ps, plannedEnd: pe, actualStart: t.actualStartDate, actualEnd: t.actualEndDate });
    return {
      completed: { status: 'Completed', dates: formatActualDateRange(t.actualStartDate, t.actualEndDate) ?? '', delay: split ? formatDelaySplit(split)[0] : null },
      open: null,
    };
  }

  // Not completed (2026-11-15): no dates — just the status and the delay count.
  if (!t.actualStartDate && ps && today < ps) return { completed: null, open: { dates: 'Upcoming', delay: null } };
  let days = 0;
  if (t.actualStartDate) {
    // Running: days past the planned end, else how late it started.
    days = pe && today > pe ? daysFromTo(pe, today) : ps ? Math.max(0, daysFromTo(ps, t.actualStartDate)) : 0;
  } else if (ps && today > ps) {
    days = daysFromTo(ps, today);
  }
  // Late → "Delayed"; not late yet (running on time, or no dates) → "Upcoming".
  return { completed: null, open: { dates: days > 0 ? 'Delayed' : 'Upcoming', delay: days > 0 ? `${days}d delay` : null } };
}

/** One status filter for the board, Sheet View and Reports (2026-11-16): Completed, Upcoming or Delayed. */
export type StatusFilter = 'Completed' | 'Upcoming' | 'Delayed';
export const STATUS_FILTERS: StatusFilter[] = ['Completed', 'Upcoming', 'Delayed'];

export function matchesStatusFilter(t: SheetStatusTask, filter: StatusFilter, today: string): boolean {
  // Same three groups as Reports — every task is in exactly one.
  if (t.actualEndDate) return filter === 'Completed';
  const late = !!sheetStatus(t, today).open?.delay;
  return filter === (late ? 'Delayed' : 'Upcoming');
}
