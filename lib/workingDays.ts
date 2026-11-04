// Pure working-day math, ported verbatim from admin-web's
// lib/utils/working-days.ts (the synchronous half — isWorkingDay/
// subtractWorkingDaysSync) since procurement reminders need the exact same
// "Sunday + Holiday row" definition of a working day the rest of the app's
// scheduling math already uses, not a second, possibly-inconsistent one.

function formatDateKeyUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isWorkingDay(date: Date, blockedDates: Set<string>): boolean {
  return !blockedDates.has(formatDateKeyUtc(date));
}

// The Nth working day on/before `date`, inclusive.
export function subtractWorkingDaysSync(date: Date, days: number, blockedDates: Set<string>): Date {
  const cursor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  let remaining = Math.max(1, days);
  for (;;) {
    if (isWorkingDay(cursor, blockedDates)) {
      remaining--;
      if (remaining === 0) return cursor;
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
}

// The Nth working day on/after `date`, inclusive — ported for the CPM delay
// engine (lib/gantt/delayEngine.ts), same semantics as subtractWorkingDaysSync
// but walking forward.
export function addWorkingDaysSync(date: Date, days: number, blockedDates: Set<string>): Date {
  const cursor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  let remaining = Math.max(1, days);
  for (;;) {
    if (isWorkingDay(cursor, blockedDates)) {
      remaining--;
      if (remaining === 0) return cursor;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

// Inclusive working-day span from `start` to `end` (both counted if both are
// working days) — e.g. same day = 1, next working day = 2. Ported for the
// CPM delay engine's workingDayGap() helper.
export function countWorkingDaysBetween(start: Date, end: Date, blockedDates: Set<string>): number {
  const s = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const e = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  if (e < s) return 0;
  let count = 0;
  const cursor = new Date(s);
  while (cursor <= e) {
    if (isWorkingDay(cursor, blockedDates)) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

// Ported verbatim from admin-web's lib/utils/working-days.ts's own
// workingDaysBetween — a step/gap count (0 when from/to are the same day),
// not the inclusive span countWorkingDaysBetween above returns. Added for
// the General Parameter report's Type 1 (Preconstruction) delay figure.
export function workingDaysBetween(from: Date, to: Date, blockedDates: Set<string>): number {
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let count = 0;
  while (cursor.getTime() !== end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWorkingDay(cursor, blockedDates)) count++;
  }
  return count;
}

// Ported verbatim from admin-web's lib/utils/working-days.ts's own
// addWorkingDaysFromAnchor — the Flowchart Template Kit's "apply" half.
// Unlike addWorkingDaysSync above (which answers "the Nth working day
// on/after `date`" and clamps to a minimum of 1), this answers "step N
// working days forward from `anchor`", with offsetDays <= 0 returning the
// anchor itself unchanged — the round-trip-safe inverse of
// admin-web's workingDaysBetween (used when the template was SAVED), so
// applying a template at anchorDate reproduces exactly the offsets that
// were captured relative to the template's own day-0 task.
export function addWorkingDaysFromAnchor(anchor: Date, offsetDays: number, blockedDates: Set<string>): Date {
  const cursor = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  if (offsetDays <= 0) return cursor;
  let remaining = offsetDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWorkingDay(cursor, blockedDates)) remaining--;
  }
  return cursor;
}
