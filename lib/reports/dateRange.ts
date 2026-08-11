// Pure UTC date-range math for the Reports feature, mirroring admin-web's own
// lib/data/weekly-report.ts UTC-anchoring rationale: due_date/actual_start_date/
// actual_end_date are Postgres `date` columns with no time component, so every
// boundary here is computed in UTC to avoid local-timezone off-by-one shifts.

export interface DateRange {
  from: string; // 'YYYY-MM-DD'
  to: string; // 'YYYY-MM-DD'
}

function utcMidnightToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function toDateKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateKeyUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDaysUtc(value: string, days: number): string {
  const d = parseDateKeyUtc(value);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateKeyUtc(d);
}

// Inclusive day count between from/to, e.g. same day = 1.
export function daysBetweenInclusive(range: DateRange): number {
  const from = parseDateKeyUtc(range.from);
  const to = parseDateKeyUtc(range.to);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

// Most recent 7 days, inclusive of today (UTC) — matches admin-web's
// defaultWeeklyReportRange().
export function defaultLast7Days(): DateRange {
  const to = toDateKeyUtc(utcMidnightToday());
  return { from: addDaysUtc(to, -6), to };
}

// Same-length period immediately preceding `range`, for trend comparisons
// (Weekly Report #3/#4) — e.g. range = last 7 days ⇒ previous = the 7 days
// before that.
export function previousRange(range: DateRange): DateRange {
  const rangeDays = daysBetweenInclusive(range);
  return { from: addDaysUtc(range.from, -rangeDays), to: addDaysUtc(range.from, -1) };
}

export function enumerateDaysUtc(range: DateRange): string[] {
  const days: string[] = [];
  let cursor = range.from;
  while (cursor <= range.to) {
    days.push(cursor);
    cursor = addDaysUtc(cursor, 1);
  }
  return days;
}

export function formatDayLabel(dateKey: string): string {
  return parseDateKeyUtc(dateKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatDateLabel(dateKey: string | null): string {
  if (!dateKey) return '—';
  return parseDateKeyUtc(dateKey).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
