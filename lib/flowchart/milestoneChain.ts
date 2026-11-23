// Milestone delay traced back through the tasks (2026-11-23, client: "49 days
// late, then why do the delays below add up to so many more days?").
//
// Adding every task's delays together counts the same days many times: tasks
// run side by side, and a late task makes the tasks after it late too. So
// the milestone's delay is followed back from its last task instead:
//   - the last task's delay (actual end − planned end) is split, by its dates,
//     into its own late start, its own longer work, and the days its late
//     start came from the task above (the same "Delay from task above" the
//     card's pop-up works out, delayMatch.ts);
//   - its own days go to the reasons entered in its pop-up, in proportion to
//     the days entered for each (a stage with days but no reason is "Not given");
//   - the days from the task above are passed to that task and split the same
//     way, and so on up the chain.
// Every day is given to exactly one reason, so the list adds up to exactly the
// milestone's delay. Pure — no Supabase / React Native imports.
import { expectedDelay, type AboveTask, type TaskDates } from './delayMatch';
import { reasonDef, shareDays, taskDelayEntries, type AllDelay, type TaskDelayEntry } from './milestoneReport';
import type { SheetReportRow } from './sheetReport';

/** A task's dates and the tasks linked into it (FS / SS arrows on the board), by task code. */
export interface ChainInfo {
  dates: TaskDates;
  above: AboveTask[];
}

interface Part {
  key: string;
  label: string;
  color: string;
  responsible: string;
  code: string;
  reason: string;
  days: number;
}

const NOT_GIVEN_COLOR = '#9CA3AF';

export interface TracedDelay {
  allDelays: AllDelay[];
  byResponsible: { responsible: string; days: number; delays: number }[];
  /** The tasks the delay was followed through, last task first. */
  path: string[];
  total: number;
}

export function traceMilestoneDelay(
  rows: Pick<SheetReportRow, 'taskCode' | 'notes' | 'constructionNotes' | 'department'>[],
  info: Map<string, ChainInfo>,
  lastCode: string,
  total: number
): TracedDelay {
  const byCode = new Map(rows.map((r) => [r.taskCode, r]));
  const parts: Part[] = [];
  const path: string[] = [];
  const notGiven = (code: string, days: number, why: string) =>
    parts.push({ key: 'notGiven', label: 'Reason not given', color: NOT_GIVEN_COLOR, responsible: 'Not given', code, reason: why, days });

  // Each entry's share of `days`, by the days entered for it.
  const giveTo = (code: string, entries: TaskDelayEntry[], days: number, stage: string) => {
    if (days <= 0) return;
    if (!entries.length) return notGiven(code, days, `${stage} delay with no reason entered`);
    shareDays(entries.map((e) => e.days ?? 0), days).forEach((d, i) => {
      if (d <= 0) return;
      const e = entries[i];
      const def = reasonDef(e.causeId);
      parts.push({ key: e.causeId, label: def?.label ?? e.cause, color: def?.color ?? e.color, responsible: e.responsible, code, reason: e.reason, days: d });
    });
  };

  const walk = (code: string, days: number, seen: Set<string>) => {
    if (days <= 0) return;
    const r = byCode.get(code);
    const inf = info.get(code);
    if (!r || !inf || seen.has(code)) {
      notGiven(code, days, r ? 'linked in a loop' : `${code} is not in this milestone`);
      return;
    }
    seen.add(code);
    path.push(code);
    const e = expectedDelay(inf.dates, inf.above);
    const fromAbove = e?.fromAbove ?? 0;
    const ownPre = Math.max(0, (e?.pre ?? 0) - fromAbove);
    const con = e?.con ?? 0;
    if (ownPre + con + fromAbove <= 0) {
      notGiven(code, days, 'not late by its own dates');
      return;
    }
    const [preDays, conDays, aboveDays] = shareDays([ownPre, con, fromAbove], days);
    const own = (n: SheetReportRow['notes'] | undefined, stage: TaskDelayEntry['stage']) =>
      taskDelayEntries(n, stage, r.department).filter((x) => !x.fromAbove && (x.days ?? 0) > 0);
    giveTo(code, own(r.notes, 'Pre-con'), preDays, 'Pre-construction');
    giveTo(code, own(r.constructionNotes, 'Const'), conDays, 'Construction');
    if (aboveDays > 0) {
      if (e?.aboveCode) walk(e.aboveCode, aboveDays, seen);
      else notGiven(code, aboveDays, 'late start, task above not found');
    }
  };
  walk(lastCode, total, new Set());

  // Same cause + same responsible = one line; days added, reasons listed with their task.
  const lines = new Map<string, AllDelay & { codes: Set<string> }>();
  for (const p of parts) {
    const k = `${p.key}|${p.responsible}`;
    const line = lines.get(k) ?? { label: p.label, color: p.color, responsible: p.responsible, days: 0, given: null, tasks: 0, reasons: [], codes: new Set<string>() };
    line.days = (line.days ?? 0) + p.days;
    line.codes.add(p.code);
    line.tasks = line.codes.size;
    if (p.reason && !line.reasons.some((w) => w.code === p.code && w.text === p.reason)) line.reasons.push({ code: p.code, text: p.reason });
    lines.set(k, line);
  }
  const allDelays: AllDelay[] = [...lines.values()]
    .map(({ codes, ...d }) => {
      // Codes with no reason written still show which task the days are on.
      for (const c of codes) if (!d.reasons.some((w) => w.code === c)) d.reasons.push({ code: c, text: '' });
      return d;
    })
    .sort((a, b) => (a.responsible === 'Not given' ? 1 : 0) - (b.responsible === 'Not given' ? 1 : 0) || (b.days ?? 0) - (a.days ?? 0) || a.label.localeCompare(b.label));
  const who = new Map<string, { responsible: string; days: number; delays: number }>();
  for (const d of allDelays) {
    const w = who.get(d.responsible) ?? { responsible: d.responsible, days: 0, delays: 0 };
    w.days += d.days ?? 0;
    w.delays += 1;
    who.set(d.responsible, w);
  }
  const byResponsible = [...who.values()].sort((a, b) => (a.responsible === 'Not given' ? 1 : 0) - (b.responsible === 'Not given' ? 1 : 0) || b.days - a.days);
  return { allDelays, byResponsible, path, total };
}
