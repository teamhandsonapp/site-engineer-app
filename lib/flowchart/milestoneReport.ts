import * as XLSX from 'xlsx';
import { contractorFor, fieldDays, pointDays, splitPoints, STAGED_NOTE_FIELDS, type ChecklistNoteKey, type ChecklistNotes } from './checklistNotes';
import { cellDays, cellNotes, DELAY_GRID_CELLS, DELAY_GRID_TABLES, gridCellId, gridCoveredFields, rowCellId, tableRows } from './delayGrid';
import { saveWorkbook } from './excelExport';
import { printReportHtml, type SheetReportRow } from './sheetReport';

// Milestone report format (2026-11-21, client): when a milestone is picked in
// Past Tasks → Reports, the report is this, for whatever tasks the milestone
// holds (the list lives in pastMilestones.ts, so new or changed milestones
// keep this same format):
//   1. How many tasks.
//   2. Planned: first planned start → last planned end, total days.
//      Actual:  first actual start  → last actual end,  total days.
//   3. Delayed by: actual end − planned end, in days.
//   4. Who the delay is on — the party only (Contractor, Client, Architect,
//      Consultant), never the reason text.
// Days are calendar days, counting both the first and the last day.

/** Each checklist point → the party it puts the delay on. */
export const MILESTONE_PARTY: Record<ChecklistNoteKey, string> = {
  architect: 'Architect',
  consultant: 'Consultant',
  client: 'Client',
  // Finalising a contractor / vendor is the client's decision.
  contractorClientFinalization: 'Client',
  procurementStatus: 'Contractor',
  contractorDelay: 'Contractor',
  leadTime: 'Contractor',
  other: 'Contractor',
  equipmentDelay: 'Contractor',
};
const PARTY_ORDER = ['Contractor', 'Client', 'Architect', 'Consultant'];
export const PARTY_COLORS: Record<string, string> = { Contractor: '#B91C1C', Client: '#DB2777', Architect: '#2563EB', Consultant: '#7C3AED' };

const DAY = 86_400_000;
const ms = (k: string) => Date.parse(`${k.slice(0, 10)}T00:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
const minKey = (ks: (string | null | undefined)[]) => ks.filter((k): k is string => !!k).sort()[0] ?? null;
const maxKey = (ks: (string | null | undefined)[]) => ks.filter((k): k is string => !!k).sort().reverse()[0] ?? null;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (k: string | null) => (k ? `${Number(k.slice(8, 10))} ${MON[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : '—');

/** One reason for delay given on a task in one stage (2026-11-23): a
 *  checklist point written, or a delay-table cell filled (lib/flowchart/delayGrid.ts).
 *  id = the checklist key; a table cell with no checklist point of its own is "grid:<cell>". */
export interface DelayCause {
  id: string;
  label: string;
  color: string;
  party: string;
  /** Who exactly, when more than the party (e.g. "Structural consultant"). */
  who?: string;
  days: number | null;
  /** What was written for it (2026-11-23): the checklist points and the delay-table reason. */
  texts: string[];
}

/** Every reason the reports know, in bar order: the checklist points, then the table-only causes. */
export const REASON_DEFS: Omit<DelayCause, 'days' | 'texts'>[] = [
  ...STAGED_NOTE_FIELDS.map((f) => ({ id: f.key as string, label: f.label, color: f.color, party: MILESTONE_PARTY[f.key] })),
  ...DELAY_GRID_CELLS.filter((c) => !c.column.field && !c.column.carried).map((c) => ({
    id: `grid:${c.id}`,
    label: c.column.reportLabel ?? c.column.label,
    color: c.column.color,
    party: c.column.party,
    ...(c.column.party === 'Consultant' ? { who: c.column.label } : {}),
  })),
];
const REASON_BY_ID = new Map(REASON_DEFS.map((d) => [d.id, d]));
/** A reason's label and colour as the reports show it. */
export const reasonDef = (id: string) => REASON_BY_ID.get(id);

/** The reasons given in one stage. A table cell for a checklist point is that
 *  same reason, and its days replace the days written in the checklist. */
export function stageCauses(n: ChecklistNotes | undefined): DelayCause[] {
  const out = new Map<string, DelayCause>();
  // Points the delay table has days for: the table alone counts (no duplicates).
  const covered = gridCoveredFields(n?.delayGrid);
  for (const f of STAGED_NOTE_FIELDS) {
    if (covered.has(f.key)) continue;
    if (n?.[f.key]?.trim()) out.set(f.key, { ...REASON_BY_ID.get(f.key)!, days: fieldDays(n, f.key), texts: splitPoints(n[f.key]) });
  }
  for (const c of DELAY_GRID_CELLS) {
    // Carried from the task above: its reason is on that task, not here.
    if (c.column.carried) continue;
    // Every row of the cause added up (more than one delay per cause, 2026-11-23).
    const d = cellDays(n?.delayGrid, c.id);
    if (!d || d <= 0) continue;
    const id = c.column.field ?? `grid:${c.id}`;
    // The table's reasons; none typed → the old checklist text for that point.
    const typed = cellNotes(n?.delayGridNotes, c.id);
    const texts = typed.length ? typed : c.column.field ? splitPoints(n?.[c.column.field]) : [];
    out.set(id, { ...REASON_BY_ID.get(id)!, days: d, texts });
  }
  return REASON_DEFS.filter((d) => out.has(d.id)).map((d) => out.get(d.id)!);
}

/** The parties a task's delay is on (both stages), e.g. ['Contractor', 'Client']. */
export function rowParties(r: Pick<SheetReportRow, 'notes' | 'constructionNotes'>): string[] {
  const parties = new Set([...stageCauses(r.notes), ...stageCauses(r.constructionNotes)].map((c) => c.party));
  return PARTY_ORDER.filter((p) => parties.has(p));
}

export interface MilestoneTaskLine {
  code: string;
  name: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  /** Finished: actual end − planned end. Not finished: days past the planned end so far. */
  delayDays: number | null;
  parties: string[];
  /** Reasons given (checklist points / delay-table cells, either stage) — DelayCause ids. */
  reasons: string[];
  /** Every delay written, both stages, for the task list (2026-11-22, client):
   *  "Pre-con: Workers delay, Client approval · Const: Equipment delays". */
  delays: string;
  equipment: { stage: 'Pre-con' | 'Const'; text: string; days: number | null }[];
  /** Days given per reason (DelayCause id) on this task, both stages added. */
  reasonDays: Partial<Record<string, number>>;
  /** Task by task (2026-11-23, client): every delay entered for this task, one line each. */
  entries: TaskDelayEntry[];
  /** What the card shows, e.g. "Pre-con: 30d · Const: 19d · Total: 49d". */
  cardDelay: string;
  /** The card's days per stage (null = not on the card). */
  cardPre: number | null;
  cardCon: number | null;
  /** Days entered per stage (Pre-con includes the days from the task above). */
  enteredPre: number;
  enteredCon: number;
  /** "Delay from task above" days entered on this task. */
  fromAbove: number;
}

/** One delay entered on a task (2026-11-23, client "Task by task"): a delay-table
 *  row, or a checklist point when the table has nothing for that point. */
export interface TaskDelayEntry {
  stage: 'Pre-con' | 'Const';
  /** "Workers delay", "MEP consultant", "Delay from task above", … */
  cause: string;
  /** The reason it is in the reports (DelayCause id: checklist key or "grid:<cell>"). */
  causeId: string;
  color: string;
  /** "Civil contractor", "Architect", "MEP consultant", or "Task above". */
  responsible: string;
  days: number | null;
  reason: string;
  /** Days carried from the task above (counted on that task, not as a reason here). */
  fromAbove?: boolean;
}

/** Every delay entered for one stage of a task, in table order. */
export function taskDelayEntries(n: ChecklistNotes | undefined, stage: TaskDelayEntry['stage'], department: string | null | undefined): TaskDelayEntry[] {
  const out: TaskDelayEntry[] = [];
  const grid = n?.delayGrid ?? {};
  const covered = gridCoveredFields(grid);
  for (const table of DELAY_GRID_TABLES) {
    const rows = tableRows(table, grid, n?.delayGridNotes);
    for (const col of table.columns) {
      for (let r = 1; r <= rows; r++) {
        const id = rowCellId(gridCellId(table, col), r);
        const days = grid[id] ?? 0;
        if (days <= 0) continue;
        out.push({
          stage,
          cause: col.label,
          causeId: col.carried ? 'carried' : col.field ?? `grid:${gridCellId(table, col)}`,
          color: col.color,
          responsible: col.carried ? 'Task above' : responsibleFor({ party: col.party, who: col.party === 'Consultant' ? col.label : undefined }, department),
          days,
          reason: n?.delayGridNotes?.[id]?.replace(/\s+/g, ' ').trim() ?? '',
          ...(col.carried ? { fromAbove: true } : {}),
        });
      }
    }
  }
  // Checklist points the delay table has no days for.
  for (const f of STAGED_NOTE_FIELDS) {
    if (covered.has(f.key)) continue;
    const days = pointDays(n, f.key);
    splitPoints(n?.[f.key]).forEach((p, i) =>
      out.push({ stage, cause: f.label, causeId: f.key, color: f.color, responsible: responsibleFor({ party: MILESTONE_PARTY[f.key] }, department), days: days[i] ?? null, reason: p })
    );
  }
  return out;
}

const cardDays = (delay: string, label: string): number | null => {
  const m = new RegExp(`${label}: (-?\\d+)d`).exec(delay);
  return m ? Number(m[1]) : null;
};

/** The delay points written on a task, per stage, as one line. */
export function rowDelays(r: Pick<SheetReportRow, 'notes' | 'constructionNotes'>): string {
  const labels = (n?: ChecklistNotes) => stageCauses(n).map((c) => (c.days ? `${c.label} (${c.days}d)` : c.label));
  const pre = labels(r.notes);
  const con = labels(r.constructionNotes);
  return [pre.length ? `Pre-con: ${pre.join(', ')}` : '', con.length ? `Const: ${con.join(', ')}` : ''].filter(Boolean).join(' · ');
}

export interface AllDelay {
  label: string;
  color: string;
  /** "Civil contractor", "Architect", "Structural consultant", … */
  responsible: string;
  /** Days in the report: this delay's share of the days the milestone is
   *  late (see allDelays) — or the days given, when the milestone isn't late.
   *  null = no days given. */
  days: number | null;
  /** Days given, all tasks and both stages added (null = none given). */
  given: number | null;
  tasks: number;
  /** The reasons written, with the task they are on (2026-11-23, client). */
  reasons: { code: string; text: string }[];
}

/**
 * Shares `total` whole days between the items in proportion to their weights,
 * so the parts add up to exactly `total` (largest remainder: the floors first,
 * the days left over to the biggest fractions).
 */
export function shareDays(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w * total) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r), w: weights[i] })).sort((a, b) => b.f - a.f || b.w - a.w || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    out[o.i] += 1;
    left -= 1;
  }
  return out;
}

/** Who a delay is on: a contractor by the task's department ("Civil contractor"), else the consultant / party. */
export function responsibleFor(c: Pick<DelayCause, 'party' | 'who'>, department: string | null | undefined): string {
  return c.party === 'Contractor' ? contractorFor(department) : c.who ?? c.party;
}

/**
 * Every delay given on these rows, with days and who is responsible (see MilestoneSummary.allDelays).
 *
 * Days match the milestone (2026-11-23, client): the tasks of a milestone run
 * one after another, so a delay on one task also makes the next ones late and
 * the days given on each task add up to more than the milestone is late. When
 * the milestone is late (`milestoneDelay` > 0), those days are shared between
 * the delays in proportion to the days given, so the list adds up to exactly
 * the milestone's delay. Otherwise the days given are shown as they are.
 */
export function allDelays(
  rows: Pick<SheetReportRow, 'notes' | 'constructionNotes' | 'department' | 'taskCode' | 'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd'>[],
  milestoneDelay: number | null = null,
  /** Pre-construction with dates (2026-11-25, client): same-date tasks each counted, not merged. */
  keepSameDates = false
): {
  allDelays: AllDelay[];
  byResponsible: { responsible: string; days: number; delays: number }[];
  /** All days given, added (before sharing). */
  delaysGiven: number;
  /** true = the days are the milestone's delay shared out. */
  delaysShared: boolean;
} {
  const out = new Map<string, AllDelay>();
  // The same delay on tasks running side by side (2026-11-23, client: PTC-18 and
  // PTC-19 both "Material (Acro span, Jacks …) 5 days", same dates) is one delay:
  // same cause, same responsible, same reason and overlapping dates → its days
  // count once (the larger), and the reason is listed once with both task codes.
  const seen = new Map<string, { words: Set<string>; start: string | null; end: string | null; days: number; line: { code: string; text: string } | null }[]>();
  const taskSeen = new Map<string, Set<string>>();
  // Tasks that start and finish on the same days (SS + FF, side by side — e.g.
  // PTC-18 and PTC-19, both 22 Aug – 1 Sep) are one piece of work for the delay
  // (2026-11-23, client): only the one with the most delay days entered counts,
  // and its reasons carry all their codes ("PTC-18 / PTC-19").
  const { skip, codeOf } = keepSameDates ? { skip: new Set<unknown>(), codeOf: new Map<unknown, string>() } : sameDateTasks(rows);
  for (const r of rows) {
    if (skip.has(r)) continue;
    // When each stage's delay happened: Pre-construction is the wait before the
    // start (planned start → actual start), Construction the work itself.
    const preSpan = { start: day(r.plannedStart), end: day(r.actualStart) };
    const conSpan = { start: day(r.actualStart ?? r.plannedStart), end: day(r.actualEnd ?? r.actualStart ?? r.plannedEnd) };
    const code = codeOf.get(r) ?? r.taskCode;
    const stages: [DelayCause[], { start: string | null; end: string | null }][] = [
      [stageCauses(r.notes), preSpan],
      [stageCauses(r.constructionNotes), conSpan],
    ];
    for (const [causes, span] of stages)
      for (const c of causes) {
        const responsible = responsibleFor(c, r.department);
        const key = `${c.id}|${responsible}`;
        const prev = out.get(key);
        const reason = reasonWords(c.texts);
        const earlier = seen.get(key) ?? [];
        // The same delay again: same cause and responsible, the same reason (wording
        // aside) and at the same time → it is one delay, its days counted once.
        const same = reason.size ? earlier.find((x) => sameReason(x.words, reason) && overlaps(x, span)) : undefined;
        const add = same ? Math.max(0, (c.days ?? 0) - same.days) : c.days ?? 0;
        if (same) same.days += add;
        seen.set(key, earlier);
        const d = prev ?? { label: c.label, color: c.color, responsible, days: null, given: null, tasks: 0, reasons: [] };
        // Tasks on this delay, each task once (both stages, or a same-dates group, = 1).
        if (!taskSeen.get(key)?.has(code)) d.tasks += 1;
        taskSeen.set(key, (taskSeen.get(key) ?? new Set()).add(code));
        if (add) d.given = (d.given ?? 0) + add;
        // Each reason once: the same delay again (above), or the same words on
        // another task, just adds its code to the line already there.
        const words = (t: string) => [...reasonWords([t])].sort().join(' ');
        let first: { code: string; text: string } | null = null;
        for (const text of c.texts) {
          const w = same?.line ?? d.reasons.find((x) => words(x.text) !== '' && words(x.text) === words(text));
          if (w) {
            if (!w.code.split(', ').includes(code)) w.code = `${w.code}, ${code}`;
            first ??= w;
            if (same) break;
          } else {
            const line = { code, text };
            d.reasons.push(line);
            first ??= line;
          }
        }
        if (!same) earlier.push({ words: reason, ...span, days: c.days ?? 0, line: first });
        if (!prev) out.set(key, d);
      }
  }
  const items = [...out.values()];
  const delaysGiven = items.reduce((a, d) => a + (d.given ?? 0), 0);
  const delaysShared = (milestoneDelay ?? 0) > 0 && delaysGiven > 0;
  const shares = delaysShared ? shareDays(items.map((d) => d.given ?? 0), milestoneDelay!) : [];
  items.forEach((d, i) => {
    d.days = d.given === null ? null : delaysShared ? shares[i] : d.given;
  });
  const list = items.sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || (b.given ?? 0) - (a.given ?? 0) || b.tasks - a.tasks || a.label.localeCompare(b.label));
  const who = new Map<string, { responsible: string; days: number; delays: number }>();
  for (const d of list) {
    const w = who.get(d.responsible) ?? { responsible: d.responsible, days: 0, delays: 0 };
    w.days += d.days ?? 0;
    w.delays += 1;
    who.set(d.responsible, w);
  }
  return { allDelays: list, byResponsible: [...who.values()].sort((a, b) => b.days - a.days || b.delays - a.delays), delaysGiven, delaysShared };
}

const day = (k: string | null | undefined) => (k ? k.slice(0, 10) : null);

/** Days entered on a task, both stages (delay table, or checklist days). */
const enteredDays = (r: Pick<SheetReportRow, 'notes' | 'constructionNotes'>) =>
  [...stageCauses(r.notes), ...stageCauses(r.constructionNotes)].reduce((a, c) => a + (c.days ?? 0), 0);

/**
 * Finished tasks with the same actual start and the same actual finish (SS + FF):
 * all but the one with the most delay days entered are skipped, and the one kept
 * shows every code of its group, most days first ("PTC-19 / PTC-18").
 */
export function sameDateTasks<R extends Pick<SheetReportRow, 'notes' | 'constructionNotes' | 'taskCode' | 'actualStart' | 'actualEnd'>>(
  rows: R[]
): { skip: Set<R>; codeOf: Map<R, string> } {
  const groups = new Map<string, R[]>();
  for (const r of rows) {
    const a = day(r.actualStart);
    const b = day(r.actualEnd);
    if (!a || !b) continue;
    groups.set(`${a}|${b}`, [...(groups.get(`${a}|${b}`) ?? []), r]);
  }
  const skip = new Set<R>();
  const codeOf = new Map<R, string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((x, y) => enteredDays(y) - enteredDays(x) || stageCauses(y.constructionNotes).length + stageCauses(y.notes).length - (stageCauses(x.constructionNotes).length + stageCauses(x.notes).length));
    sorted.slice(1).forEach((r) => skip.add(r));
    codeOf.set(sorted[0], sorted.map((r) => r.taskCode).join(' / '));
  }
  return { skip, codeOf };
}
const overlaps = (a: { start: string | null; end: string | null }, b: { start: string | null; end: string | null }) =>
  !!a.start && !!a.end && !!b.start && !!b.end && a.start <= b.end && b.start <= a.end;
const FILLER = new Set(['got', 'by', 'of', 'the', 'a', 'an', 'to', 'in', 'on', 'for', 'due', 'is', 'was', 'and', 'delay', 'delayed', 'days', 'day', 'not']);
/** The words that say what a reason is about ("Soil Compactor got delayed by 20 days" → soil, compactor). */
export function reasonWords(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts)
    for (const w of t.toLowerCase().split(/[^a-z]+/)) {
      if (w.length < 2 || FILLER.has(w)) continue;
      out.add(w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
    }
  return out;
}
/** The same reason, worded differently: one's words are all in the other's
 *  ("Delayed by compactor" = "Soil Compactor delayed by 20 days"). */
export function sameReason(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return [...small].every((w) => big.has(w));
}


/** Milestone report layouts: the standard one, or "All delays" (L (−4'6") report, 2026-11-23). */
/** 'taskDelays' (2026-11-23, client, Mezzanine Slab Casting milestone): All delays + every task's delays one by one. */
export type MilestoneFormat = 'reasons' | 'allDelays' | 'taskDelays';

export interface MilestoneSummary {
  tasks: number;
  completed: number;
  finished: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  plannedDays: number | null;
  actualStart: string | null;
  /** Last actual end — only when every task is finished. */
  actualEnd: string | null;
  actualDays: number | null;
  /** Finished: actual end − planned end (negative = early). Not finished: days past the planned end so far. */
  delayDays: number | null;
  /** Delayed tasks per party (a task on two parties counts for both). */
  parties: { party: string; tasks: number }[];
  /** Delayed tasks with no party written. */
  notWritten: number;
  delayedTasks: number;
  /** Finished on or before its planned end. */
  onTime: number;
  /** Delayed tasks per reason (checklist point written, either stage); a task with two reasons counts for both. */
  /** days: days given for that reason on the delayed tasks, both stages (null = none given). */
  reasons: { reason: string; tasks: number; color: string; days: number | null }[];
  /** Delayed tasks with no reason written. */
  noReason: number;
  /** "All delays" format (2026-11-23, client, L (−4'6") report): every delay
   *  given on the milestone's tasks with its days (both stages, all tasks
   *  added) and who is responsible, most days first. */
  allDelays: AllDelay[];
  /** The same days per responsible party, most days first. */
  byResponsible: { responsible: string; days: number; delays: number }[];
  /** All delay days given, added (before sharing). */
  delaysGiven: number;
  /** true = allDelays' days are the milestone's delay shared out (they add up to delayDays). */
  delaysShared: boolean;
  /** "Delay from task above" days entered, all tasks added, and on how many tasks. */
  fromAboveDays: number;
  fromAboveTasks: number;
  /** Only one stage's delays are in this report (2026-11-23, client filter), e.g.
   *  'Pre-construction': the days as given, with a Total row. */
  stageOnly?: string;
  /** Construction only + a date range (2026-11-25, client): each calendar day of
   *  delay counted once, only days inside the range (constructionDays.ts). */
  countedOnce?: { total: number; given: number; note: string; short: string };
  /** Date-range report (2026-11-25, client): no Planned end / Actual end / Difference box. */
  hideSpan?: boolean;
  /** Date-range report (2026-11-25, client): every task in the dates with its own
   *  Pre-con / Const days, listed after the delays; no "Responsible" table. */
  rangeTasks?: { code: string; name: string; department: string; pre: number; con: number }[];
  /** Both stages in one report: the Pre-con and Const subtotals. */
  stageTotals?: { pre: number; con: number };
  /** Set when allDelays is the milestone's delay followed back from its last task
   *  (milestoneChain.ts): the tasks it went through, last task first. */
  traced?: string[];
  /** Equipment delays as written (e.g. "Compactor – 4 days"), per task and stage (2026-11-22, client). */
  equipment: { code: string; stage: 'Pre-con' | 'Const'; text: string; delayDays: number | null; days: number | null }[];
  lines: MilestoneTaskLine[];
}

/** The reasons given for a task, either stage (DelayCause ids, in bar order). */
export function rowReasons(r: Pick<SheetReportRow, 'notes' | 'constructionNotes'>): string[] {
  const ids = new Set([...stageCauses(r.notes), ...stageCauses(r.constructionNotes)].map((c) => c.id));
  return REASON_DEFS.map((d) => d.id).filter((id) => ids.has(id));
}

/** Equipment delays in one stage: the text written, or "Equipment delay" when only the table has days. */
function stageEquipment(n: ChecklistNotes | undefined, stage: 'Pre-con' | 'Const') {
  const c = stageCauses(n).find((x) => x.id === 'equipmentDelay');
  return c ? [{ stage, text: n?.equipmentDelay?.trim() || 'Equipment delay', days: c.days }] : [];
}

export function milestoneSummary(rows: SheetReportRow[], today: string): MilestoneSummary {
  const lines: MilestoneTaskLine[] = rows
    .map((r) => {
      const pEnd = r.plannedEnd ?? r.plannedStart ?? null;
      const delayDays = pEnd ? (r.actualEnd ? daysBetween(pEnd, r.actualEnd) : today > pEnd ? daysBetween(pEnd, today) : 0) : null;
      return {
        code: r.taskCode,
        name: r.taskName,
        plannedStart: r.plannedStart ?? r.plannedEnd ?? null,
        plannedEnd: pEnd,
        actualStart: r.actualStart ?? null,
        actualEnd: r.actualEnd ?? null,
        delayDays,
        parties: rowParties(r),
        reasons: rowReasons(r),
        delays: rowDelays(r),
        equipment: [...stageEquipment(r.notes, 'Pre-con'), ...stageEquipment(r.constructionNotes, 'Const')],
        reasonDays: (() => {
          const out: Partial<Record<string, number>> = {};
          for (const c of [...stageCauses(r.notes), ...stageCauses(r.constructionNotes)]) if (c.days) out[c.id] = (out[c.id] ?? 0) + c.days;
          return out;
        })(),
        ...(() => {
          const pre = taskDelayEntries(r.notes, 'Pre-con', r.department);
          const con = taskDelayEntries(r.constructionNotes, 'Const', r.department);
          const add = (es: TaskDelayEntry[]) => es.reduce((a, e) => a + (e.days ?? 0), 0);
          return {
            entries: [...pre, ...con],
            cardDelay: r.delay ?? '',
            cardPre: cardDays(r.delay ?? '', 'Pre-con'),
            cardCon: cardDays(r.delay ?? '', 'Const'),
            enteredPre: add(pre),
            enteredCon: add(con),
            fromAbove: add([...pre, ...con].filter((e) => e.fromAbove)),
          };
        })(),
      };
    })
    .sort((a, b) => (a.plannedStart ?? '9999').localeCompare(b.plannedStart ?? '9999') || a.code.localeCompare(b.code, undefined, { numeric: true }));

  const completed = lines.filter((l) => l.actualEnd).length;
  const finished = lines.length > 0 && completed === lines.length;
  const plannedStart = minKey(lines.map((l) => l.plannedStart));
  const plannedEnd = maxKey(lines.map((l) => l.plannedEnd));
  const actualStart = minKey(lines.map((l) => l.actualStart));
  const actualEnd = finished ? maxKey(lines.map((l) => l.actualEnd)) : null;
  const delayDays = plannedEnd ? (actualEnd ? daysBetween(plannedEnd, actualEnd) : today > plannedEnd ? daysBetween(plannedEnd, today) : 0) : null;

  const delayed = lines.filter((l) => (l.delayDays ?? 0) > 0);
  const count = new Map<string, number>();
  for (const l of delayed) for (const p of l.parties) count.set(p, (count.get(p) ?? 0) + 1);
  const reasonCount = new Map<string, number>();
  const reasonDayTotal = new Map<string, number>();
  for (const l of delayed)
    for (const k of l.reasons) {
      reasonCount.set(k, (reasonCount.get(k) ?? 0) + 1);
      if (l.reasonDays[k]) reasonDayTotal.set(k, (reasonDayTotal.get(k) ?? 0) + l.reasonDays[k]!);
    }
  return {
    tasks: lines.length,
    completed,
    finished,
    plannedStart,
    plannedEnd,
    plannedDays: plannedStart && plannedEnd ? daysBetween(plannedStart, plannedEnd) + 1 : null,
    actualStart,
    actualEnd,
    actualDays: actualStart && actualEnd ? daysBetween(actualStart, actualEnd) + 1 : null,
    delayDays,
    parties: PARTY_ORDER.filter((p) => count.has(p)).map((p) => ({ party: p, tasks: count.get(p)! })).sort((a, b) => b.tasks - a.tasks),
    notWritten: delayed.filter((l) => l.parties.length === 0).length,
    delayedTasks: delayed.length,
    onTime: lines.filter((l) => l.actualEnd && (l.delayDays ?? 0) <= 0).length,
    reasons: REASON_DEFS.filter((d) => reasonCount.has(d.id))
      .map((d) => ({ reason: d.label, tasks: reasonCount.get(d.id)!, color: d.color, days: reasonDayTotal.get(d.id) ?? null }))
      .sort((a, b) => b.tasks - a.tasks),
    noReason: delayed.filter((l) => l.reasons.length === 0).length,
    equipment: lines.flatMap((l) => l.equipment.map((e) => ({ code: l.code, stage: e.stage, text: e.text, delayDays: l.delayDays, days: e.days }))),
    // Days exactly as entered (2026-11-23, client): no longer shared out to add up to
    // the milestone's delay — typing more days on a task shows more days here.
    ...allDelays(rows),
    fromAboveDays: lines.reduce((a, l) => a + l.fromAbove, 0),
    fromAboveTasks: lines.filter((l) => l.fromAbove > 0).length,
    lines,
  };
}

/** "Delayed by 36 days" / "On time" / "4 days early" / "36 days late so far". */
export function delayHeadline(s: MilestoneSummary): string {
  const d = s.delayDays;
  if (d === null) return 'No planned dates';
  if (!s.finished) return d > 0 ? `${d} day${d === 1 ? '' : 's'} past the planned end so far` : 'On schedule so far';
  if (d > 0) return `Delayed by ${d} day${d === 1 ? '' : 's'}`;
  if (d < 0) return `Finished ${-d} day${d === -1 ? '' : 's'} early`;
  return 'Finished on time';
}

/** Client format (2026-11-22): "Difference" = actual end − planned end. */
export function differenceText(s: MilestoneSummary): string {
  const d = s.delayDays;
  if (d === null) return '—';
  const n = `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'}`;
  if (!s.finished) return d > 0 ? `${n} late so far` : 'On schedule so far';
  return d > 0 ? `${n} late` : d < 0 ? `${n} early` : 'On time';
}

export const lineDelay = (d: number | null) => (d === null ? '—' : d > 0 ? `${d}d late` : d < 0 ? `${-d}d early` : 'On time');

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Days in "All delays": "5 days"; a share that rounds to 0 is "under 1 day"
 *  (not "days not given", 2026-11-23); null = no days given at all. */
export function allDelayDaysText(n: number | null, shared: boolean): string {
  if (n === null || (n === 0 && !shared)) return 'days not given';
  if (n === 0) return 'under 1 day';
  return `${n} day${n === 1 ? '' : 's'}`;
}

/** The "Total" under All delays / Responsible: the milestone's delay when the days
 *  add up to it, the days given when only one stage is shown, else no Total row. */
export function delaysTotal(s: MilestoneSummary): number | null {
  if (s.countedOnce) return s.countedOnce.total;
  if (s.delaysShared) return s.delayDays;
  if (s.stageOnly) return s.delaysGiven;
  return null;
}

/** The note under "All delays": how its days are worked out. */
export function allDelaysNote(s: MilestoneSummary): string {
  if (s.countedOnce) return s.countedOnce.note;
  if (s.stageOnly && !s.traced?.length)
    return `${s.stageOnly} delays only: days as given on each task, all tasks added (${s.delaysGiven} day${s.delaysGiven === 1 ? '' : 's'}).`;
  if (s.traced?.length)
    return `The milestone is ${s.delayDays} day${s.delayDays === 1 ? '' : 's'} late. Followed back from its last task (${s.traced[0]}): each task's own delay goes to the reasons entered for it, and its "Delay from task above" days go to the task above (${s.traced.join(' ← ')}). Every day is counted once, so the delays add up to ${s.delayDays} days.`;
  return s.delaysShared
    ? `The milestone is ${s.delayDays} day${s.delayDays === 1 ? '' : 's'} late. Those days are shared between the delays in proportion to the days given on each task (${s.delaysGiven} days given in all — more than ${s.delayDays}, as a delay on one task also makes the next tasks late).`
    : 'Days as given for each delay (delay table or checklist), both stages and all tasks added.';
}

/** Short note for the compact report: where the days come from, in one line. */
export function compactDelaysNote(s: MilestoneSummary): string {
  if (s.countedOnce) return s.countedOnce.short;
  if (s.stageOnly && !s.traced?.length) return `${s.stageOnly} delays only: days as given, all tasks added.`;
  return s.traced?.length
    ? `Traced back from ${s.traced[0]} through the tasks above (${s.traced.join(' ← ')}); every day counted once.`
    : 'Days as given for each delay, both stages and all tasks added.';
}

// Compact milestone report (2026-11-23, client: "one page, compact, no reasons"):
// the summary in one row, then Delays and Responsible side by side, no reason text.
function compactMilestoneHtml(s: MilestoneSummary, projectName: string, milestone: string, today: Date): string {
  const tone = s.delayDays === null ? '#6B7280' : (s.delayDays ?? 0) > 0 ? '#B91C1C' : '#15803D';
  const dayText = (n: number | null) => allDelayDaysText(n, s.delaysShared);
  const total = delaysTotal(s) !== null ? `<tr class="tot"><td>Total</td><td class="r">${dayText(delaysTotal(s))}</td></tr>` : '';
  const stat = (label: string, value: string, color = '#0F1F33') => `<td><div class="sl">${esc(label)}</div><div class="sv" style="color:${color}">${esc(value)}</div></td>`;
  const delays = s.allDelays.length
    ? `<table class="t"><tr><th>Delay</th><th class="r">Days</th></tr>${s.allDelays
        .map(
          (x) =>
            `<tr><td><span class="dot" style="background:${x.color}"></span>${esc(x.label)}<div class="who">${esc(x.responsible)}${x.tasks > 1 ? ` · ${x.tasks} tasks` : ''}</div></td><td class="r dd">${dayText(x.days)}</td></tr>`
        )
        .join('')}${total}</table>`
    : '<p class="muted">No delays given.</p>';
  const resp = s.byResponsible.length
    ? `<table class="t"><tr><th>Responsible</th><th class="r">Days</th></tr>${s.byResponsible
        .map((w) => `<tr><td class="b">${esc(w.responsible)}</td><td class="r dd">${dayText(w.days)}</td></tr>`)
        .join('')}${total}</table>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(projectName)} — ${esc(milestone)}</title><style>
    @page { size: A4 portrait; margin: 10mm 10mm 12mm;
      @top-left { content: ""; } @top-center { content: ""; } @top-right { content: ""; }
      @bottom-left { content: "Team Hands On Pvt Ltd"; font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 10px; font-weight: 700; color: #0F1F33; }
      @bottom-center { content: ""; } @bottom-right { content: ""; } }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #0b0b0b; font-size: 12px; }
    .head { border-bottom: 2px solid #0F1F33; padding-bottom: 4px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end; }
    h1 { font-size: 17px; margin: 0; color: #0F1F33; } .ms { font-size: 13px; font-weight: 700; color: #B45309; } .sub { font-size: 9px; color: #52514e; }
    table { border-collapse: collapse; width: 100%; }
    .stats td { border: 1px solid #DDDCD7; padding: 5px 7px; vertical-align: top; width: 16.6%; }
    .sl { font-size: 9px; color: #52514e; text-transform: uppercase; letter-spacing: .3px; } .sv { font-size: 14px; font-weight: 800; margin-top: 1px; }
    .cols { display: flex; gap: 10px; margin-top: 10px; align-items: flex-start; } .cols > div { border: 1px solid #E7E5E0; border-radius: 8px; padding: 7px 9px; }
    .c1 { flex: 3; } .c2 { flex: 2; } h2 { font-size: 12.5px; margin: 0 0 4px; color: #0F1F33; }
    .t th { text-align: left; font-size: 9.5px; color: #52514e; padding: 3px 4px; border-bottom: 1.5px solid #E7E5E0; }
    .t td { border-bottom: 1px solid #F0EFEC; padding: 3px 4px; font-size: 11.5px; vertical-align: top; }
    .t .r { text-align: right; white-space: nowrap; } .t .dd { font-weight: 800; color: #B91C1C; } .t .b { font-weight: 700; color: #0F1F33; }
    .t tr.tot td { border-top: 1.5px solid #0F1F33; border-bottom: none; font-weight: 800; color: #0F1F33; } .t tr.tot td.r { color: #B91C1C; }
    .who { font-size: 9.5px; color: #6B7280; margin-left: 14px; } .dot { display: inline-block; width: 8px; height: 8px; border-radius: 4px; margin-right: 6px; }
    .note { font-size: 9px; color: #6B7280; margin-top: 6px; } .muted { color: #898781; }
  </style></head><body>
    <div class="head"><div><h1>${esc(projectName)} — Milestone Report</h1><div class="ms">${esc(milestone)}</div></div><div class="sub">Generated <b>${fmtDay(today.toISOString().slice(0, 10))}</b></div></div>
    <table class="stats"><tr>
      ${s.hideSpan ? '' : `${stat('Planned end', fmtDay(s.plannedEnd))}${stat('Actual end', s.finished ? fmtDay(s.actualEnd) : 'Not finished')}${stat('Difference', differenceText(s), tone)}`}
      ${stat('Tasks', String(s.tasks))}${stat('Delayed', String(s.delayedTasks), '#B91C1C')}${stat('On time', String(s.onTime), '#15803D')}
    </tr></table>
    <div class="cols"><div class="c1"><h2>Delays</h2>${delays}</div>${resp ? `<div class="c2"><h2>Responsible</h2>${resp}</div>` : ''}</div>
    <div class="note">${s.hideSpan ? '' : 'Difference = actual end − planned end. '}${esc(compactDelaysNote(s))}</div>
  </body></html>`;
}

export function milestoneReportHtml(s: MilestoneSummary, projectName: string, milestone: string, today = new Date(), format: MilestoneFormat = 'reasons'): string {
  if (format === 'taskDelays') return compactMilestoneHtml(s, projectName, milestone, today);
  const d = s.delayDays ?? 0;
  const tone = s.delayDays === null ? '#6B7280' : d > 0 ? '#B91C1C' : '#15803D';
  const max = Math.max(1, ...s.reasons.map((r) => r.tasks), s.noReason);
  // Same look as the on-screen milestone report (2026-11-23, client): a plain
  // count after each bar, and Equipment delays as light rows.
  const bar = (label: string, n: number, color: string) =>
    `<div class="br"><div class="bl">${esc(label)}</div><div class="bt"><div style="width:${(n / max) * 100}%;background:${color}"></div></div><div class="bv">${n}</div></div>`;
  const equipmentHtml = s.equipment.length
    ? `<h3 class="eq">Equipment delays</h3><table class="eqrows">${s.equipment
        .map(
          (e) =>
            `<tr><td class="ec">${esc(e.code)}</td><td class="es">${e.stage}</td><td>${esc(e.text)}</td><td class="ed">${e.days ? `${e.days}d` : ''}</td><td class="el" style="color:${(e.delayDays ?? 0) > 0 ? '#B91C1C' : '#15803D'}">${lineDelay(e.delayDays)}</td></tr>`
        )
        .join('')}</table>`
    : '';
  const reasons = s.reasons.length || s.noReason
    ? // Task counts only, no days total (2026-11-23, client).
      s.reasons.map((r) => bar(r.reason, r.tasks, r.color)).join('') + (s.noReason ? bar('Not written', s.noReason, '#9CA3AF') : '')
    : '<p class="muted">No delayed tasks.</p>';
  const dayText = (n: number | null) => allDelayDaysText(n, s.delaysShared);
  const subRow = (label: string, n: number) => `<tr class="sub"><td class="who">${label}</td><td class="r dd">${dayText(n)}</td><td></td></tr>`;
  const dd = (n: number) => (n ? `${n}d` : '—');
  const rangeTasksHtml = s.rangeTasks
    ? `<div class="card tasks newpage"><h2>Delayed tasks in these dates (${s.rangeTasks.length})</h2><table class="list"><thead><tr><th>#</th><th>Task</th><th>Department</th><th class="num">Pre-con</th><th class="num">Const</th><th class="num">Total</th></tr></thead>${s.rangeTasks
        .map((t, i) => `<tr><td class="num">${i + 1}</td><td><b>${esc(t.code)}</b> · ${esc(t.name)}</td><td>${esc(t.department)}</td><td class="num${t.pre ? ' late' : ''}">${dd(t.pre)}</td><td class="num${t.con ? ' late' : ''}">${dd(t.con)}</td><td class="num${t.pre + t.con ? ' late' : ''}">${dd(t.pre + t.con)}</td></tr>`)
        .join('')}</table><div class="note">Pre-con = planned start to actual start (both days counted). Const = actual days − planned days. — = no delay.</div></div>`
    : '';
  const allDelaysHtml = s.allDelays.length
    ? `<table class="ad"><tr><th>Delay</th><th class="r">Days</th><th>Responsible · reason</th></tr>${s.allDelays
        .map(
          (x, i) =>
            `${s.stageTotals && x.label.startsWith('Const · ') && !s.allDelays[i - 1]?.label.startsWith('Const · ') ? subRow('Pre-construction total', s.stageTotals.pre) : ''}<tr><td><span class="dot" style="background:${x.color}"></span>${esc(x.label)}${x.tasks > 1 ? ` <span class="tk">(${x.tasks} tasks)</span>` : ''}</td><td class="r dd">${dayText(x.days)}${s.delaysShared && x.given ? `<div class="tk">${x.given} given</div>` : ''}</td><td><div class="whos">${esc(x.responsible)}</div>${x.reasons.map((w) => `<div class="why">${esc(w.text)} <span class="tk">${esc(w.code)}</span></div>`).join('')}</td></tr>`
        )
        .join('')}${s.stageTotals ? subRow('Construction total', s.stageTotals.con) : ''}${delaysTotal(s) !== null ? `<tr><td class="who">Total</td><td class="r dd">${dayText(delaysTotal(s))}</td><td></td></tr>` : ''}</table>
      ${s.rangeTasks ? '' : `<h3 class="eq">Responsible for the delays</h3><table class="ad">${s.byResponsible
        .map((w) => `<tr><td class="who">${esc(w.responsible)}</td><td class="r dd">${dayText(w.days)}</td><td class="tk">${w.delays} delay${w.delays === 1 ? '' : 's'}</td></tr>`)
        .join('')}${delaysTotal(s) !== null ? `<tr><td class="who">Total</td><td class="r dd">${dayText(delaysTotal(s))}</td><td></td></tr>` : ''}</table>`}`
    : '<p class="muted">No delays given.</p>';
  const fromAboveHtml = s.fromAboveDays
    ? `<div class="note"><b>Delay from task above:</b> ${s.fromAboveDays} day${s.fromAboveDays === 1 ? '' : 's'} on ${s.fromAboveTasks} task${s.fromAboveTasks === 1 ? '' : 's'} — a late task above made these start late; those days are already counted on the task above, so they are not added again here.</div>`
    : '';
  const delaysCard =
    format !== 'reasons'
      ? `<div class="card"><h2>All delays (${s.delayedTasks} task${s.delayedTasks === 1 ? '' : 's'} delayed)</h2>${allDelaysHtml}<div class="note">${esc(allDelaysNote(s))}</div>${s.traced || s.rangeTasks ? '' : fromAboveHtml}${s.rangeTasks ? '' : equipmentHtml}</div>`
      : `<div class="card"><h2>Reasons for delay (${s.delayedTasks} delayed)</h2>${reasons}<div class="note">Delayed tasks per reason; a task with two reasons counts for both.</div>${equipmentHtml}</div>`;
  // No task list in the report (2026-11-22, client).
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(projectName)} — ${esc(milestone)}</title><style>
    @page { size: A4 portrait; margin: 12mm 11mm 16mm;
      @top-left { content: ""; } @top-center { content: ""; } @top-right { content: ""; }
      @bottom-left { content: "Team Hands On Pvt Ltd"; font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 11px; font-weight: 700; color: #0F1F33; }
      @bottom-center { content: ""; }
      @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 13px; font-weight: 700; color: #0F1F33; } }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #0b0b0b; font-size: 13px; }
    .head { border-bottom: 2px solid #0F1F33; padding-bottom: 6px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; }
    h1 { font-size: 22px; margin: 0; color: #0F1F33; } .ms { font-size: 16px; font-weight: 700; color: #B45309; margin-top: 2px; }
    .sub { font-size: 10px; color: #52514e; }
    h2 { font-size: 15px; margin: 0 0 8px; color: #0F1F33; }
    .card { border: 1px solid #E7E5E0; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; break-inside: avoid; }
    .count { font-size: 14px; color: #52514e; margin-bottom: 8px; } .count b { font-size: 22px; color: #0b0b0b; }
    table { border-collapse: collapse; width: 100%; }
    .span td, .span th { border: 1px solid #DDDCD7; padding: 7px 9px; font-size: 14px; text-align: left; }
    .span th { background: #F1F5F9; color: #334155; } .span td.days { font-weight: 700; text-align: right; }
    .delay { margin-top: 10px; font-size: 22px; font-weight: 800; }
    .br { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
    .bl { width: 110px; font-size: 14px; font-weight: 600; } .bt { flex: 1; height: 22px; background: #F0EFEC; border-radius: 4px; overflow: hidden; }
    .bt > div { height: 100%; border-radius: 4px; } .bv { width: 70px; text-align: right; font-weight: 700; }
    .counts { margin-top: 12px; } .counts td { padding: 6px 4px; font-size: 15px; border-bottom: 1px solid #F0EFEC; } .counts td.cv { text-align: right; font-size: 20px; font-weight: 800; width: 80px; }
    .bl { width: 210px; }
    .bv { width: 40px; font-size: 15px; }
    .eqrows { width: 100%; border-collapse: collapse; }
    .eqrows td { border-top: 1px solid #E7E5E0; padding: 6px 6px; font-size: 13px; vertical-align: top; }
    .eqrows td.ec { width: 13%; font-weight: 700; } .eqrows td.es { width: 10%; color: #52514e; }
    .eqrows td.ed { width: 7%; text-align: right; font-weight: 700; color: #C2410C; white-space: nowrap; }
    .eqrows td.el { width: 11%; text-align: right; font-weight: 700; white-space: nowrap; }
    h3.eq { font-size: 13px; margin: 12px 0 4px; color: #0F1F33; }
    .muted { color: #898781; }
    .list th, .list td { border: 1px solid #DDDCD7; padding: 4px 6px; font-size: 11.5px; vertical-align: top; text-align: left; }
    .list th { background: #F1F5F9; } td.num { text-align: right; } td.late { color: #B91C1C; font-weight: 600; } tr { break-inside: avoid; }
    .note { font-size: 10px; color: #6B7280; margin-top: 6px; }
    .ad { width: 100%; border-collapse: collapse; }
    .ad th { text-align: left; font-size: 12px; color: #52514e; padding: 6px; border-bottom: 2px solid #E7E5E0; }
    .ad td { border-bottom: 1px solid #E7E5E0; padding: 8px 6px; font-size: 14px; vertical-align: top; }
    .ad tr.sub td { background: #F8FAFC; border-top: 1.5px solid #CBD5E1; }
    .ad .r { text-align: right; white-space: nowrap; } .ad .dd { font-weight: 800; color: #B91C1C; width: 22%; }
    .ad .who { font-weight: 700; color: #0F1F33; width: 32%; } .tk { font-size: 11px; color: #6B7280; font-weight: 400; }
    .whos { font-size: 11px; font-weight: 700; color: #6B7280; } .why { font-size: 15px; font-weight: 700; color: #0F1F33; margin-top: 2px; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 5px; margin-right: 8px; }
    .card.tasks { break-inside: auto; } .newpage { break-before: page; page-break-before: always; } .list thead { display: table-header-group; } .tb { border-top: 1px solid #E7E5E0; padding: 8px 0; break-inside: avoid; }
    .th { font-size: 14px; color: #0F1F33; } .th .cd { float: right; font-size: 12px; font-weight: 700; color: #B91C1C; }
    .te { width: 100%; border-collapse: collapse; margin: 6px 0 4px; } .te th { text-align: left; font-size: 11px; color: #52514e; padding: 4px 6px; background: #F1F5F9; }
    .te td { font-size: 12.5px; padding: 4px 6px; border-bottom: 1px solid #F0EFEC; vertical-align: top; } .te .r { text-align: right; white-space: nowrap; }
    .te .dd { font-weight: 800; color: #B91C1C; } .te tr.fa td { color: #4B5563; font-style: italic; } .te tr.fa .dd { color: #4B5563; }
  </style></head><body>
    <div class="head"><div><h1>${esc(projectName)} — Milestone Report</h1><div class="ms">${esc(milestone)}</div></div><div class="sub">Report generated: <b>${fmtDay(today.toISOString().slice(0, 10))}</b></div></div>
    <div class="card">
      ${s.hideSpan ? '' : `<table class="span"><tr><th>Planned end</th><th>Actual end</th><th style="text-align:right">Difference</th></tr>
        <tr><td>${fmtDay(s.plannedEnd)}</td><td>${s.finished ? fmtDay(s.actualEnd) : 'Not finished yet'}</td><td class="days" style="color:${tone}">${esc(differenceText(s))}</td></tr>
      </table>`}
      <table class="counts">
        <tr><td>No. of tasks ${s.rangeTasks ? 'in these dates' : 'in milestone'}</td><td class="cv">${s.tasks}</td></tr>
        <tr><td>No. of tasks delayed</td><td class="cv" style="color:#B91C1C">${s.delayedTasks}</td></tr>
        <tr><td>No. of tasks completed on time</td><td class="cv" style="color:#15803D">${s.onTime}</td></tr>
      </table>
      ${s.hideSpan ? "" : `<div class="note">Difference = actual end − planned end.</div>`}
    </div>
    ${delaysCard}
    ${rangeTasksHtml}
  </body></html>`;
}

export function printMilestoneReport(s: MilestoneSummary, projectName: string, milestone: string, fileName?: string, format: MilestoneFormat = 'reasons'): Promise<void> {
  return printReportHtml(milestoneReportHtml(s, projectName, milestone, new Date(), format), fileName);
}

export function exportMilestoneExcel(s: MilestoneSummary, projectName: string, milestone: string, fileName: string, format: MilestoneFormat = 'reasons'): Promise<string> {
  // Compact (2026-11-23, client): summary, delays and responsible — no reasons.
  const compact: (string | number)[][] = [
    [`${projectName} — Milestone Report`],
    [milestone],
    [],
    ...(s.hideSpan
      ? [['Tasks', 'Delayed', 'On time'], [s.tasks, s.delayedTasks, s.onTime]]
      : [['Planned end', 'Actual end', 'Difference', 'Tasks', 'Delayed', 'On time'], [fmtDay(s.plannedEnd), s.finished ? fmtDay(s.actualEnd) : 'Not finished', differenceText(s), s.tasks, s.delayedTasks, s.onTime]]),
    [],
    ['Delay', 'Responsible', 'Days'],
    ...s.allDelays.map((x) => [x.label, x.responsible, x.days ?? '']),
    ...(delaysTotal(s) !== null ? [['Total', '', delaysTotal(s) ?? '']] : []),
    [],
    ['Responsible', '', 'Days'],
    ...s.byResponsible.map((w) => [w.responsible, '', w.days || '']),
    ...(delaysTotal(s) !== null ? [['Total', '', delaysTotal(s) ?? '']] : []),
    [],
    [compactDelaysNote(s)],
  ];
  if (format === 'taskDelays') {
    const sheet = XLSX.utils.aoa_to_sheet(compact);
    sheet['!cols'] = [{ wch: 36 }, { wch: 22 }, { wch: 16 }, { wch: 8 }, { wch: 9 }, { wch: 9 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Milestone');
    return saveWorkbook(book, fileName, 'Milestone Report (Excel)');
  }
  const aoa: (string | number)[][] = [
    [`${projectName} — Milestone Report`],
    [milestone],
    [],
    ...(s.hideSpan ? [] : [['Planned end', 'Actual end', 'Difference'], [fmtDay(s.plannedEnd), s.finished ? fmtDay(s.actualEnd) : 'Not finished yet', differenceText(s)], []]),
    ['No. of tasks in milestone', s.tasks],
    ['No. of tasks delayed', s.delayedTasks],
    ...(format !== 'reasons' ? [] : s.reasons.map((r) => [`   ${r.reason}`, r.tasks])),
    ...(format === 'reasons' && s.noReason ? [['   Not written', s.noReason]] : []),
    ['No. of tasks completed on time', s.onTime],
    ...(format !== 'reasons'
      ? [
          [],
          ['All delays', 'Days', 'Responsible', 'Reason', ...(s.delaysShared ? ['Days given'] : [])],
          ...s.allDelays.map((x) => [
            x.tasks > 1 ? `${x.label} (${x.tasks} tasks)` : x.label,
            x.days ?? '',
            x.responsible,
            x.reasons.map((w) => `${w.code}: ${w.text}`).join('; '),
            ...(s.delaysShared ? [x.given ?? ''] : []),
          ]),
          ...(delaysTotal(s) !== null ? [['Total', delaysTotal(s) ?? '', '', '', ...(s.delaysShared ? [s.delaysGiven] : [])]] : []),
          [],
          ['Responsible', 'Days', 'Delays'],
          ...s.byResponsible.map((w) => [w.responsible, w.days || '', w.delays]),
          [],
          [allDelaysNote(s)],
          ...(s.fromAboveDays && !s.traced
            ? [[`Delay from task above: ${s.fromAboveDays} days on ${s.fromAboveTasks} tasks (already counted on the task above, not added again).`]]
            : []),
        ]
      : []),
    ...(s.equipment.length ? [[], ['Equipment delays', 'Stage', 'Written', 'Days', 'Task delay'], ...s.equipment.map((e) => [e.code, e.stage, e.text, e.days ?? '', lineDelay(e.delayDays)])] : []),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 44 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 60 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Milestone');
  return saveWorkbook(book, fileName, 'Milestone Report (Excel)');
}
