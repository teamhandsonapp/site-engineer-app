// Converts between a template task's persisted day-offset (dayOffsetStart/
// dayOffsetEnd — see templateTypes.ts's own comment on why those, not real
// dates, are what's stored) and a real calendar date, so the task-creation
// popup can use ordinary date pickers instead of asking someone to type
// "day 5" by hand. The anchor is the template's own createdAt — fixed for
// the template's whole lifetime, so a date picked today converts to the
// same offset (and back to the same date) regardless of which day it's
// authored or viewed on. Plain whole-day arithmetic on UTC calendar dates —
// timezone-agnostic on purpose, since this is relative day-counting, not a
// wall-clock display (contrast lib/formatTime.ts's IST-specific handling,
// which IS a display concern).
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUTCDateOnly(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// isoDate: 'YYYY-MM-DD' (DateField's own format).
export function dateToOffset(anchorISO: string, isoDate: string): number {
  const anchor = toUTCDateOnly(anchorISO);
  const target = toUTCDateOnly(isoDate);
  return Math.round((target - anchor) / MS_PER_DAY);
}

export function offsetToDate(anchorISO: string, offsetDays: number): string {
  const anchor = toUTCDateOnly(anchorISO);
  const d = new Date(anchor + offsetDays * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
