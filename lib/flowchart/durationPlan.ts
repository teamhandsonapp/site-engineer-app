import { addDays } from './projected';
import type { DependencyType } from './types';

// Planned dates from a number of days (client trial, 2026-11-15).
// Instead of picking Planned Start/End, the person enters how many days the
// task takes; the planned start comes from the tasks linked into it (their
// PLANNED dates), using the same link rules as the projected chip:
//   FS  day after the previous task's planned end
//   SS  same day as the previous task's planned start
//   FF  ends the same day as the previous task's planned end
//   SF  ends the same day as the previous task's planned start
// The latest of these wins. Every day is counted, so 10 days from Jan 11 ends Jan 20.
// A task with no dated link before it starts from its own Planned Start (`ownStart`).
// Used on every Flowchart 2 task (the FC2T copy board is a backup and keeps date pickers).

export interface DurationPred {
  name: string;
  type: DependencyType;
  plannedStartDate: string | null;
  dueDate: string | null;
}

export function planFromDuration(days: number, preds: DurationPred[], ownStart?: string | null): { start: string; end: string; from: string } | null {
  if (!Number.isFinite(days) || days < 1) return null;
  const len = Math.round(days) - 1;
  let best: { start: string; from: string } | null = null;
  for (const p of preds) {
    const s = p.plannedStartDate ?? p.dueDate, e = p.dueDate ?? p.plannedStartDate;
    if (!s || !e) continue;
    const start = p.type === 'SS' ? s : p.type === 'FF' ? addDays(e, -len) : p.type === 'SF' ? addDays(s, -len) : addDays(e, 1);
    if (!best || start > best.start) best = { start, from: `${p.name} (${p.type})` };
  }
  if (!best && ownStart) best = { start: ownStart, from: 'Planned Start' };
  return best && { start: best.start, end: addDays(best.start, len), from: best.from };
}
