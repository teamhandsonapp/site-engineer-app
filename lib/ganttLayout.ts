// Layout math mirroring admin-web's Gantt exactly (components/gantt/ganttLayout.ts)
// so "a week of chart" reads the same width/density on both — same row
// heights, same px-per-day zoom values, same week-padded range computation.
// Re-derived here without date-fns (not a dependency of this app) rather
// than adding a library for a handful of calendar-week functions.
export const ROW_HEIGHT = 52;
export const WORK_HEADER_HEIGHT = 40;
export const MONTH_HEADER_HEIGHT = 24;
export const WEEK_HEADER_HEIGHT = 32;
export const TIMELINE_HEADER_HEIGHT = MONTH_HEADER_HEIGHT + WEEK_HEADER_HEIGHT;
export const BAR_HEIGHT = 16;

// Width of the frozen trade/task label column — sized for this app's
// screens, not copied from admin-web's desktop-width left panel.
export const LABEL_WIDTH = 168;

export type ZoomLevel = 'Day' | 'Week' | 'Month';
export const ZOOM_LEVELS: ZoomLevel[] = ['Week', 'Month', 'Day'];
export const ZOOM_PX_PER_DAY: Record<ZoomLevel, number> = {
  Day: 32,
  Week: 12,
  Month: 4,
};

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// The CPM delay engine (lib/gantt/delayEngine.ts) works entirely in
// UTC-midnight-anchored dates (Date.UTC(y,m,d)) — deliberately, so its
// results don't depend on the server/device's local timezone. Everything
// ELSE in this file (parseDateKey, dateToX, differenceInCalendarDays) works
// in LOCAL calendar-day terms, matching plannedStartDate/dueDate's own
// 'YYYY-MM-DD'-parsed-as-local convention. Mixing the two directly (feeding
// a UTC-anchored engine Date straight into a local-calendar function) is
// safe on a server that happens to run in UTC, but NOT safe on a phone in
// an arbitrary timezone — e.g. any timezone west of UTC would read a
// UTC-midnight instant as the PREVIOUS local calendar day, silently
// shifting every projected bar/date by one day. Reading the UTC Y/M/D
// fields back off an engine date and re-constructing it as a LOCAL date
// (same calendar day, different underlying instant) is what bridges the
// two systems correctly — always route an engine date through this before
// handing it to dateToX/differenceInCalendarDays/addDays.
export function toLocalCalendarDate(utcAnchoredDate: Date): Date {
  return new Date(utcAnchoredDate.getUTCFullYear(), utcAnchoredDate.getUTCMonth(), utcAnchoredDate.getUTCDate());
}

// Monday-start week, matching admin-web's { weekStartsOn: 1 }.
function startOfWeekMonday(date: Date): Date {
  const day = date.getDay(); // 0 = Sun .. 6 = Sat
  const diff = day === 0 ? 6 : day - 1;
  return addDays(date, -diff);
}

function endOfWeekMonday(date: Date): Date {
  return addDays(startOfWeekMonday(date), 6);
}

export function differenceInCalendarDays(later: Date, earlier: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const a = new Date(later.getFullYear(), later.getMonth(), later.getDate());
  const b = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((a.getTime() - b.getTime()) / msPerDay);
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export interface WeekColumn {
  start: Date;
  end: Date;
  left: number;
  width: number;
}

export interface MonthColumn {
  label: string;
  left: number;
  width: number;
}

export interface TimelineScale {
  rangeStart: Date;
  rangeEnd: Date;
  pxPerDay: number;
  totalWidth: number;
  weeks: WeekColumn[];
  months: MonthColumn[];
  dateToX: (date: Date) => number;
}

// Expands the raw min/max across every dated task to full Monday-Sunday
// weeks plus a week of padding each side, so the first/last bars aren't
// flush against the timeline's edge. Falls back to a fixed today-centered
// 8-week window when nothing has a date at all — the caller (gantt.tsx)
// shows an explicit empty state in that case rather than an empty chart,
// but this still returns something sane rather than a zero-width range.
export function computeTimelineRange(dates: Date[], today: Date): { rangeStart: Date; rangeEnd: Date } {
  if (dates.length === 0) {
    return {
      rangeStart: startOfWeekMonday(addDays(today, -28)),
      rangeEnd: endOfWeekMonday(addDays(today, 28)),
    };
  }
  const rawStart = new Date(Math.min(...dates.map((d) => d.getTime())));
  const rawEnd = new Date(Math.max(...dates.map((d) => d.getTime())));
  return {
    rangeStart: startOfWeekMonday(addDays(rawStart, -7)),
    rangeEnd: endOfWeekMonday(addDays(rawEnd, 7)),
  };
}

export function buildTimelineScale(rangeStart: Date, rangeEnd: Date, pxPerDay: number): TimelineScale {
  const dateToX = (date: Date) => differenceInCalendarDays(date, rangeStart) * pxPerDay;
  const totalWidth = dateToX(rangeEnd) + pxPerDay;

  const weeks: WeekColumn[] = [];
  for (let start = startOfWeekMonday(rangeStart); start <= rangeEnd; start = addDays(start, 7)) {
    const end = endOfWeekMonday(start);
    weeks.push({ start, end, left: dateToX(start), width: 7 * pxPerDay });
  }

  const months: MonthColumn[] = [];
  for (const week of weeks) {
    const label = formatMonthYear(week.start);
    const last = months[months.length - 1];
    if (last && last.label === label) {
      last.width += week.width;
    } else {
      months.push({ label, left: week.left, width: week.width });
    }
  }

  return { rangeStart, rangeEnd, pxPerDay, totalWidth, weeks, months, dateToX };
}

// 'YYYY-MM-DD' parsed as a *local* calendar day — matches the identical
// convention in lib/tasks/upcomingTasks.ts and admin-web's own date-key
// parsing (a plain `new Date('YYYY-MM-DD')` reads as the previous day west
// of UTC).
export function parseDateKey(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}
