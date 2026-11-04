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

// Today only (UTC), from === to — the Day Report's own default range.
export function defaultToday(): DateRange {
  const today = toDateKeyUtc(utcMidnightToday());
  return { from: today, to: today };
}

// Most recent 30 days, inclusive of today — the default window for the
// stakeholder/department-filtered reports (Report by Architect/Client/
// Vendor/Contractor/Department), which have no inherent time bound of
// their own, same "last N days" shape as defaultLast7Days above.
export function defaultLast30Days(): DateRange {
  const to = toDateKeyUtc(utcMidnightToday());
  return { from: addDaysUtc(to, -29), to };
}

// 1st of the current month through today (UTC) — Report by time — Monthly's
// own default. Stops at today rather than the month's last day since a DPR
// activity report has nothing real to show for days that haven't happened
// yet.
export function defaultCurrentMonth(): DateRange {
  const today = utcMidnightToday();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { from: toDateKeyUtc(from), to: toDateKeyUtc(today) };
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

// Calendar-month periods for the Weekly/Monthly pickers. Weeks are fixed
// day-of-month blocks (1–7, 8–14, 15–21, 22–28, 29–end) so "Week 1..5" of a
// month always means the same dates, regardless of weekday.
export interface Period {
  label: string;
  range: DateRange;
}

export function todayKeyUtc(): string {
  return toDateKeyUtc(utcMidnightToday());
}

export function monthRange(year: number, month0: number): DateRange {
  const from = new Date(Date.UTC(year, month0, 1));
  const to = new Date(Date.UTC(year, month0 + 1, 0));
  return { from: toDateKeyUtc(from), to: toDateKeyUtc(to) };
}

export function weeksOfMonth(year: number, month0: number): Period[] {
  const { to: monthEnd } = monthRange(year, month0);
  const lastDay = Number(monthEnd.slice(8, 10));
  const weeks: Period[] = [];
  for (let start = 1, n = 1; start <= lastDay; start += 7, n++) {
    const end = n === 5 ? lastDay : Math.min(start + 6, lastDay);
    weeks.push({
      label: `Week ${n}`,
      range: { from: toDateKeyUtc(new Date(Date.UTC(year, month0, start))), to: toDateKeyUtc(new Date(Date.UTC(year, month0, end))) },
    });
    if (end === lastDay) break;
  }
  return weeks;
}

export function currentWeekOfMonth(): DateRange {
  const today = todayKeyUtc();
  const d = parseDateKeyUtc(today);
  return weeksOfMonth(d.getUTCFullYear(), d.getUTCMonth()).find((w) => w.range.from <= today && today <= w.range.to)!.range;
}

export function currentCalendarMonth(): DateRange {
  const d = utcMidnightToday();
  return monthRange(d.getUTCFullYear(), d.getUTCMonth());
}
