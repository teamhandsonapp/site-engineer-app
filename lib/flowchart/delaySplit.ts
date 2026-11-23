// Delay split for a finished task (2026-11-14). Every day is counted,
// Sundays included.
//   Start delay = days between planned start and actual start (pre-construction)
//   Total delay = days between planned finish and actual finish
//   Work delay  = Total − Start (construction: the work took longer than planned)
// e.g. Lift shaft 1st lift: planned Oct 26–30 (5 days), actual Oct 27–Nov 5
//   (10 days) → Start +1d · Work +5d · Total 6d.

const DAY_MS = 86_400_000;
const toMs = (k: string) => Date.parse(`${k.slice(0, 10)}T00:00:00Z`);

/** Calendar days from `from` to `to` (every day counted). Negative when `to` is earlier. */
export function daysFromTo(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

export interface DelaySplit {
  start: number;
  work: number;
  total: number;
}

/** Only for a finished task that has all four dates; null otherwise. */
export function delaySplit(t: {
  plannedStart: string | null | undefined;
  plannedEnd: string | null | undefined;
  actualStart: string | null | undefined;
  actualEnd: string | null | undefined;
}): DelaySplit | null {
  if (!t.plannedStart || !t.plannedEnd || !t.actualStart || !t.actualEnd) return null;
  const start = daysFromTo(t.plannedStart, t.actualStart);
  const total = daysFromTo(t.plannedEnd, t.actualEnd);
  return { start, work: total - start, total };
}

// Days only, no words (2026-11-15); early shows as a minus, e.g. "-5d".
const phase = (n: number) => `${n}d`;

/** One short line, e.g. "Pre-con: 1d · Const: 5d · Total: 6d". */
export function formatDelaySplit(s: DelaySplit): string[] {
  return [`Pre-con: ${phase(s.start)} · Const: ${phase(s.work)} · Total: ${s.total}d`];
}
