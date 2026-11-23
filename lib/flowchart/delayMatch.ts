// Do the delay days given match the task's delay? (2026-11-23, client)
//
// A finished task's delay comes from its dates (delaySplit.ts):
//   Pre-construction = it started later than planned (actual start − planned start)
//   Construction     = the work took more days than planned (actual days − planned days)
// Simple rule (2026-11-23, client): the days entered should equal what the
// card shows — Pre-construction and Construction. Part of a late start can
// come from the task above (it finished (FS) or started (SS) late); that part
// goes in the delay table's "Delay from task above" cell, which is filled in
// for you and is not counted again as a reason in the reports.
import type { ChecklistNotes } from './checklistNotes';
import { CARRIED_CELL_ID } from './delayGrid';
import { daysFromTo, delaySplit } from './delaySplit';
import { stageCauses } from './milestoneReport';

/** Days entered in one stage: every reason (table cells win over checklist days, as in the
 *  reports) plus the "Delay from task above" cell. */
export function enteredDays(n: ChecklistNotes | null | undefined): number {
  return stageCauses(n ?? undefined).reduce((a, c) => a + (c.days ?? 0), 0) + (n?.delayGrid?.[CARRIED_CELL_ID] ?? 0);
}

export interface TaskDates {
  plannedStart: string | null | undefined;
  plannedEnd: string | null | undefined;
  actualStart: string | null | undefined;
  actualEnd: string | null | undefined;
}

/** A task linked into this one (the task above). */
export interface AboveTask {
  code: string;
  type: string;
  actualStart: string | null | undefined;
  actualEnd: string | null | undefined;
}

const nextDay = (k: string) => new Date(Date.parse(`${k.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Late start caused by the tasks above: the latest day they let this task
 * start (FS: the day after the task above finished · SS: the day it started),
 * minus this task's planned start. Never more than the late start itself.
 */
export function delayFromAbove(plannedStart: string, lateStart: number, above: AboveTask[]): { days: number; code: string | null } {
  let best = 0;
  let code: string | null = null;
  for (const a of above) {
    const allowed = a.type === 'FS' && a.actualEnd ? nextDay(a.actualEnd) : a.type === 'SS' && a.actualStart ? a.actualStart.slice(0, 10) : null;
    if (!allowed) continue;
    const d = daysFromTo(plannedStart, allowed);
    if (d > best) {
      best = d;
      code = a.code;
    }
  }
  const days = Math.min(best, lateStart);
  return { days, code: days > 0 ? code : null };
}

export interface ExpectedDelay {
  /** Late start in all (actual start − planned start; an early start is 0). */
  preTotal: number;
  /** Of that, caused by the task above (fills the "Delay from task above" cell). */
  fromAbove: number;
  aboveCode: string | null;
  /** Pre-construction delay the days entered should add up to (= the card's Pre-con). */
  pre: number;
  /** Construction delay (actual days − planned days; 0 if quicker). */
  con: number;
}

/** null until the task is finished (all four dates). */
export function expectedDelay(t: TaskDates, above: AboveTask[] = []): ExpectedDelay | null {
  const s = delaySplit(t);
  if (!s || !t.plannedStart) return null;
  const preTotal = Math.max(0, s.start);
  const inh = delayFromAbove(t.plannedStart, preTotal, above);
  return { preTotal, fromAbove: inh.days, aboveCode: inh.code, pre: preTotal, con: Math.max(0, s.work) };
}

export interface DelayCheck {
  expected: ExpectedDelay;
  entered: { pre: number; con: number };
  matched: boolean;
}

/** null when there is nothing to check (not finished, or on time with nothing given). */
export function delayCheck(
  t: TaskDates,
  pre: ChecklistNotes | null | undefined,
  con: ChecklistNotes | null | undefined,
  above: AboveTask[] = []
): DelayCheck | null {
  const e = expectedDelay(t, above);
  if (!e) return null;
  const entered = { pre: enteredDays(pre), con: enteredDays(con) };
  if (e.preTotal + e.con === 0 && entered.pre + entered.con === 0) return null;
  return { expected: e, entered, matched: entered.pre === e.pre && entered.con === e.con };
}

/** "given 7d for 3d — 4d too many" / "matched". */
export function stageMatchText(given: number, own: number): string {
  if (given === own) return 'matched';
  return given > own ? `${given - own}d too many` : `${own - given}d missing`;
}

/** "5d (5d from PTC-03 above)" */
export function preDelayText(e: ExpectedDelay): string {
  return e.fromAbove ? `${e.preTotal}d (${e.fromAbove}d from ${e.aboveCode} above)` : `${e.preTotal}d`;
}
