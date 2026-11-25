// Construction delay in a date range, each day counted once (2026-11-25, client).
//
// "Completed Tasks, 28 Jul – 24 Sep: Construction delay should be 19 days, not
// 37. Tasks happening on the same days — take only one." A task's Construction
// delay is the extra days its work took (actual days − planned days); those
// extra days are the last days of its actual work. Tasks running side by side
// are late on the same calendar days, so each calendar day is counted once,
// and only the days inside From – To count. Each day goes to one task (the
// one with reasons / the most days entered), and that task's days are shared
// between the reasons entered for it. Pure — no Supabase / React Native imports.
import type { SheetReportRow } from './sheetReport';
import { CARRIED_CELL_ID } from './delayGrid';
import { allDelays, reasonWords, responsibleFor, shareDays, stageCauses, type AllDelay } from './milestoneReport';

const DAY = 86_400_000;
const ms = (k: string) => Date.parse(`${k.slice(0, 10)}T00:00:00Z`);
const key = (t: number) => new Date(t).toISOString().slice(0, 10);

type Row = Pick<SheetReportRow, 'taskCode' | 'department' | 'constructionNotes' | 'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd'>;

/** The calendar days a finished task's work ran over its planned length (its last days). */
export function overrunDays(r: Pick<Row, 'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd'>): string[] {
  if (!r.plannedStart || !r.plannedEnd || !r.actualStart || !r.actualEnd) return [];
  const planned = (ms(r.plannedEnd) - ms(r.plannedStart)) / DAY + 1;
  const actual = (ms(r.actualEnd) - ms(r.actualStart)) / DAY + 1;
  const extra = Math.max(0, actual - planned);
  const end = ms(r.actualEnd);
  return Array.from({ length: extra }, (_, i) => key(end - (extra - 1 - i) * DAY));
}

export interface CountedOnce {
  allDelays: AllDelay[];
  byResponsible: { responsible: string; days: number; delays: number }[];
  /** Construction delay days in the range, each calendar day once. */
  total: number;
  /** Days entered on the tasks, all added (what the report showed before). */
  given: number;
  /** Which task each counted day went to, e.g. { 'PTC-20': 12, 'PTC-22': 1 }. */
  byTask: Record<string, number>;
}

export const NO_REASON_LABEL = 'No reason written';

export function constructionDaysOnce(rows: Row[], from: string | null, to: string | null): CountedOnce {
  const entered = (r: Row) => stageCauses(r.constructionNotes).reduce((a, c) => a + (c.days ?? 0), 0);
  const given = rows.reduce((a, r) => a + entered(r), 0);
  // Each day → the task that explains it best: reasons written first, then most days entered.
  const rank = (r: Row) => [stageCauses(r.constructionNotes).length ? 1 : 0, entered(r)];
  const owner = new Map<string, Row>();
  for (const r of rows)
    for (const d of overrunDays(r)) {
      if ((from && d < from) || (to && d > to)) continue;
      const cur = owner.get(d);
      const [a1, a2] = rank(r);
      const [b1, b2] = cur ? rank(cur) : [-1, -1];
      if (!cur || a1 > b1 || (a1 === b1 && (a2 > b2 || (a2 === b2 && r.taskCode < cur.taskCode)))) owner.set(d, r);
    }
  const perTask = new Map<Row, number>();
  for (const r of owner.values()) perTask.set(r, (perTask.get(r) ?? 0) + 1);

  const out = new Map<string, AllDelay>();
  const byTask: Record<string, number> = {};
  for (const [r, days] of [...perTask.entries()].sort((a, b) => a[0].taskCode.localeCompare(b[0].taskCode))) {
    byTask[r.taskCode] = days;
    const causes = stageCauses(r.constructionNotes);
    const parts = causes.length
      ? shareDays(causes.map((c) => (causes.some((x) => x.days) ? c.days ?? 0 : 1)), days).map((n, i) => ({ c: causes[i], n }))
      : [{ c: null, n: days }];
    for (const { c, n } of parts) {
      if (n === 0) continue;
      const responsible = c ? responsibleFor(c, r.department) : '—';
      const k = c ? `${c.id}|${responsible}` : 'none';
      const d = out.get(k) ?? { label: c?.label ?? NO_REASON_LABEL, color: c?.color ?? '#CBD5E1', responsible, days: 0, given: 0, tasks: 0, reasons: [] };
      d.days = (d.days ?? 0) + n;
      d.given = (d.given ?? 0) + (c?.days ?? 0);
      d.tasks += 1;
      for (const text of c?.texts ?? []) {
        const same = d.reasons.find((x) => x.text.trim().toLowerCase() === text.trim().toLowerCase());
        if (same) {
          if (!same.code.split(', ').includes(r.taskCode)) same.code += `, ${r.taskCode}`;
        } else d.reasons.push({ code: r.taskCode, text });
      }
      if (!c || !c.texts.length) d.reasons.push({ code: r.taskCode, text: `${n} day${n === 1 ? '' : 's'} longer than planned` });
      out.set(k, d);
    }
  }
  const allDelays = [...out.values()].filter((d) => (d.days ?? 0) > 0).sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || a.label.localeCompare(b.label));
  const who = new Map<string, { responsible: string; days: number; delays: number }>();
  for (const d of allDelays) {
    const w = who.get(d.responsible) ?? { responsible: d.responsible, days: 0, delays: 0 };
    w.days += d.days ?? 0;
    w.delays += 1;
    who.set(d.responsible, w);
  }
  return { allDelays, byResponsible: [...who.values()].sort((a, b) => b.days - a.days), total: owner.size, given, byTask };
}

// ─── Pre-construction in a date range (2026-11-25, client: "should come to 50") ──
// The days as entered on each task's Pre-construction delay table, all tasks
// added: tasks on the same dates each count (not merged), and the "Delay from
// task above" days are their own line. The same delay written on two tasks
// (e.g. the soil compactor) still counts once (allDelays).
export const FROM_ABOVE_LABEL = 'Delay from task above';

export function preDaysAsEntered(rows: Pick<SheetReportRow, 'notes' | 'constructionNotes' | 'department' | 'taskCode' | 'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd'>[]): {
  allDelays: AllDelay[];
  byResponsible: { responsible: string; days: number; delays: number }[];
  total: number;
} {
  const base = allDelays(rows.map((r) => ({ ...r, constructionNotes: undefined })), null, true);
  const list = [...base.allDelays];
  const above = rows.filter((r) => (r.notes?.delayGrid?.[CARRIED_CELL_ID] ?? 0) > 0);
  if (above.length) {
    const days = above.reduce((a, r) => a + (r.notes.delayGrid![CARRIED_CELL_ID] ?? 0), 0);
    list.push({
      label: FROM_ABOVE_LABEL,
      color: '#94A3B8',
      responsible: 'Task above',
      days,
      given: days,
      tasks: above.length,
      reasons: above.map((r) => ({ code: r.taskCode, text: `${r.notes.delayGrid![CARRIED_CELL_ID]} days late start from the task above` })),
    });
  }
  list.sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || a.label.localeCompare(b.label));
  const who = new Map<string, { responsible: string; days: number; delays: number }>();
  for (const d of list) {
    const w = who.get(d.responsible) ?? { responsible: d.responsible, days: 0, delays: 0 };
    w.days += d.days ?? 0;
    w.delays += 1;
    who.set(d.responsible, w);
  }
  return { allDelays: list, byResponsible: [...who.values()].sort((a, b) => b.days - a.days), total: list.reduce((a, d) => a + (d.days ?? 0), 0) };
}

// ─── Date range = the last task's own delays (2026-11-25, client) ──────────
// "Filter 28 Jul – 24 Sep: the same Pre-con and Const delays as the Mezzanine
// Slab Casting card, with their reasons." The range report shows the task in
// the range that finished last (PTC-24): its Construction delay (actual days −
// planned days, 19) and its Pre-construction delay counted with both days
// (planned start → actual start, 25 Aug … 24 Sep = 31, client), each with the
// reasons in its delay table; days without a reason show as "No reason written".
const dayDiff = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

/** One finished task's delay, the same way as the range report: Pre-con = planned
 *  start → actual start with both days counted; Const = actual days − planned days. */
export function taskStageDays(r: Pick<SheetReportRow, 'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd'>): { pre: number; con: number } {
  if (!r.plannedStart || !r.plannedEnd || !r.actualStart || !r.actualEnd) return { pre: 0, con: 0 };
  const late = dayDiff(r.plannedStart, r.actualStart);
  return { pre: late > 0 ? late + 1 : 0, con: Math.max(0, dayDiff(r.actualStart, r.actualEnd) - dayDiff(r.plannedStart, r.plannedEnd)) };
}

export interface RangeTask {
  code: string;
  name: string;
  department: string;
  pre: number;
  con: number;
}

/** Every task in the date range with its own delay (2026-11-25, client), by actual start. */
export function rangeTaskList(rows: Pick<SheetReportRow, 'taskCode' | 'taskName' | 'department' | 'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd'>[]): RangeTask[] {
  return [...rows]
    .sort((a, b) => (a.actualStart ?? '9999').localeCompare(b.actualStart ?? '9999') || a.taskCode.localeCompare(b.taskCode, undefined, { numeric: true }))
    .map((r) => ({ code: r.taskCode, name: r.taskName, department: r.department ?? '', ...taskStageDays(r) }));
}

// Words that say nothing about which delay it is ("Soil filling" and "Soil compactor"
// are different delays; "workforce" = "workers").
const GENERIC = new Set(['soil', 'material', 'materials', 'supply', 'work', 'force', 'making', 'level', 'casting']);
function keyWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of reasonWords([text.replace(/workforce/gi, 'worker')])) if (!GENERIC.has(w) && !/^\d/.test(w)) out.add(w);
  return out;
}
type StageKey = 'notes' | 'constructionNotes';
const stageOf = (n: FullRow['notes'] | undefined, r: FullRow): StageKey => (n === r.constructionNotes ? 'constructionNotes' : 'notes');

/** The tasks (by actual start, `last` at the end) whose same-stage reasons share a key word with `text`. */
export function sameDelayTasks(rows: FullRow[], last: FullRow, text: string, stage: StageKey): string[] {
  const want = keyWords(text);
  const hit = rows.filter((r) => {
    if (r === last) return false;
    const texts = stageCauses(r[stage] ?? undefined).flatMap((c) => c.texts);
    return texts.some((t) => [...keyWords(t)].some((w) => want.has(w)));
  });
  hit.sort((a, b) => (a.actualStart ?? '').localeCompare(b.actualStart ?? '') || a.taskCode.localeCompare(b.taskCode, undefined, { numeric: true }));
  return [...hit.map((r) => r.taskCode), last.taskCode];
}

export interface LastTaskDelays {
  code: string | null;
  pre: number;
  con: number;
  allDelays: AllDelay[];
  byResponsible: { responsible: string; days: number; delays: number }[];
  total: number;
}

type FullRow = Pick<SheetReportRow, 'notes' | 'constructionNotes' | 'department' | 'taskCode' | 'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd'>;

export function lastTaskDelays(rows: FullRow[], stage: 'pre' | 'con' | null): LastTaskDelays {
  const done = rows.filter((r) => r.actualEnd && r.actualStart && r.plannedStart && r.plannedEnd);
  const last = [...done].sort((a, b) => b.actualEnd!.localeCompare(a.actualEnd!) || b.plannedEnd!.localeCompare(a.plannedEnd!))[0];
  if (!last) return { code: null, pre: 0, con: 0, allDelays: [], byResponsible: [], total: 0 };
  const { pre, con } = taskStageDays(last);
  const list: AllDelay[] = [];
  const add = (prefix: string, notes: FullRow['notes'] | undefined, days: number) => {
    if (days <= 0) return;
    let left = days;
    for (const c of stageCauses(notes)) {
      if (!c.days) continue;
      // Each reason with every task in the dates that had the same delay (2026-11-25,
      // client: "not all from PTC-24"), e.g. compactor → PTC-22, PTC-23, PTC-25B, PTC-24.
      const reasons = (c.texts.length ? c.texts : [c.label]).map((text) => ({ code: sameDelayTasks(rows, last, text, stageOf(notes, last)).join(', '), text }));
      const tasks = new Set(reasons.flatMap((x) => x.code.split(', '))).size;
      list.push({ label: `${prefix}${c.label}`, color: c.color, responsible: responsibleFor(c, last.department), days: c.days, given: c.days, tasks, reasons });
      left -= c.days;
    }
    const above = notes?.delayGrid?.[CARRIED_CELL_ID] ?? 0;
    if (above > 0) {
      list.push({ label: `${prefix}${FROM_ABOVE_LABEL}`, color: '#94A3B8', responsible: 'Task above', days: above, given: above, tasks: 1, reasons: [{ code: last.taskCode, text: `${above} days late start from the task above` }] });
      left -= above;
    }
    if (left > 0) list.push({ label: `${prefix}${NO_REASON_LABEL}`, color: '#CBD5E1', responsible: '—', days: left, given: null, tasks: 1, reasons: [{ code: last.taskCode, text: `${left} day${left === 1 ? '' : 's'} with no reason entered` }] });
  };
  const both = stage === null;
  if (stage !== 'con') add(both ? 'Pre-con · ' : '', last.notes, pre);
  if (stage !== 'pre') add(both ? 'Const · ' : '', last.constructionNotes, con);
  const who = new Map<string, { responsible: string; days: number; delays: number }>();
  for (const d of list) {
    const w = who.get(d.responsible) ?? { responsible: d.responsible, days: 0, delays: 0 };
    w.days += d.days ?? 0;
    w.delays += 1;
    who.set(d.responsible, w);
  }
  const total = list.reduce((a, d) => a + (d.days ?? 0), 0);
  return { code: last.taskCode, pre, con, allDelays: list, byResponsible: [...who.values()].sort((a, b) => b.days - a.days), total };
}
