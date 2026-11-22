import * as XLSX from 'xlsx';
import { fieldDays, STAGED_NOTE_FIELDS, type ChecklistNoteKey, type ChecklistNotes } from './checklistNotes';
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

/** The parties a task's delay is on (both stages), e.g. ['Contractor', 'Client']. */
export function rowParties(r: Pick<SheetReportRow, 'notes' | 'constructionNotes'>): string[] {
  const written = (n?: ChecklistNotes) => (Object.keys(MILESTONE_PARTY) as ChecklistNoteKey[]).filter((k) => !!n?.[k]?.trim());
  const parties = new Set([...written(r.notes), ...written(r.constructionNotes)].map((k) => MILESTONE_PARTY[k]));
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
  /** Reasons written (checklist points, either stage). */
  reasons: ChecklistNoteKey[];
  /** Every delay written, both stages, for the task list (2026-11-22, client):
   *  "Pre-con: Workers delay, Client approval · Const: Equipment delays". */
  delays: string;
  equipment: { stage: 'Pre-con' | 'Const'; text: string; days: number | null }[];
  /** Days given per reason on this task, both stages added. */
  reasonDays: Partial<Record<ChecklistNoteKey, number>>;
}

/** The delay points written on a task, per stage, as one line. */
export function rowDelays(r: Pick<SheetReportRow, 'notes' | 'constructionNotes'>): string {
  const labels = (n?: ChecklistNotes) =>
    STAGED_NOTE_FIELDS.filter((f) => !!n?.[f.key]?.trim()).map((f) => {
      const d = fieldDays(n, f.key);
      return d ? `${f.label} (${d}d)` : f.label;
    });
  const pre = labels(r.notes);
  const con = labels(r.constructionNotes);
  return [pre.length ? `Pre-con: ${pre.join(', ')}` : '', con.length ? `Const: ${con.join(', ')}` : ''].filter(Boolean).join(' · ');
}

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
  /** Equipment delays as written (e.g. "Compactor – 4 days"), per task and stage (2026-11-22, client). */
  equipment: { code: string; stage: 'Pre-con' | 'Const'; text: string; delayDays: number | null; days: number | null }[];
  lines: MilestoneTaskLine[];
}

/** The reasons (checklist points) written for a task, either stage. */
export function rowReasons(r: Pick<SheetReportRow, 'notes' | 'constructionNotes'>): ChecklistNoteKey[] {
  return STAGED_NOTE_FIELDS.map((f) => f.key).filter((k) => !!r.notes?.[k]?.trim() || !!r.constructionNotes?.[k]?.trim());
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
        equipment: [
          { stage: 'Pre-con' as const, text: r.notes?.equipmentDelay?.trim() ?? '', days: fieldDays(r.notes, 'equipmentDelay') },
          { stage: 'Const' as const, text: r.constructionNotes?.equipmentDelay?.trim() ?? '', days: fieldDays(r.constructionNotes, 'equipmentDelay') },
        ].filter((e) => e.text),
        reasonDays: Object.fromEntries(
          STAGED_NOTE_FIELDS.map((f) => [f.key, (fieldDays(r.notes, f.key) ?? 0) + (fieldDays(r.constructionNotes, f.key) ?? 0)]).filter(([, d]) => (d as number) > 0)
        ),
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
  const reasonCount = new Map<ChecklistNoteKey, number>();
  const reasonDayTotal = new Map<ChecklistNoteKey, number>();
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
    reasons: STAGED_NOTE_FIELDS.filter((f) => reasonCount.has(f.key))
      .map((f) => ({ reason: f.label, tasks: reasonCount.get(f.key)!, color: f.color, days: reasonDayTotal.get(f.key) ?? null }))
      .sort((a, b) => b.tasks - a.tasks),
    noReason: delayed.filter((l) => l.reasons.length === 0).length,
    equipment: lines.flatMap((l) => l.equipment.map((e) => ({ code: l.code, stage: e.stage, text: e.text, delayDays: l.delayDays, days: e.days }))),
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

export function milestoneReportHtml(s: MilestoneSummary, projectName: string, milestone: string, today = new Date()): string {
  const d = s.delayDays ?? 0;
  const tone = s.delayDays === null ? '#6B7280' : d > 0 ? '#B91C1C' : '#15803D';
  const max = Math.max(1, ...s.reasons.map((r) => r.tasks), s.noReason);
  const bar = (label: string, n: number, color: string, days: number | null = null) =>
    `<div class="br"><div class="bl">${esc(label)}</div><div class="bt"><div style="width:${(n / max) * 100}%;background:${color}"></div></div><div class="bv">${n} task${n === 1 ? '' : 's'}${days ? `<br><span class="dd">${days} day${days === 1 ? '' : 's'}</span>` : ''}</div></div>`;
  const equipmentHtml = s.equipment.length
    ? `<h3 class="eq">Equipment delays</h3><table class="list">${s.equipment
        .map((e) => `<tr><td style="width:12%"><b>${esc(e.code)}</b></td><td style="width:10%">${e.stage}</td><td>${esc(e.text)}</td><td style="width:9%;font-weight:700;color:#C2410C">${e.days ? `${e.days}d` : ''}</td><td style="width:12%"${(e.delayDays ?? 0) > 0 ? ' class="late"' : ''}>${lineDelay(e.delayDays)}</td></tr>`)
        .join('')}</table>`
    : '';
  const reasons = s.reasons.length || s.noReason
    ? s.reasons.map((r) => bar(r.reason, r.tasks, r.color, r.days)).join('') + (s.noReason ? bar('Not written', s.noReason, '#9CA3AF') : '')
    : '<p class="muted">No delayed tasks.</p>';
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
    .bv { width: 80px; } .dd { color: #C2410C; font-size: 12px; }
    h3.eq { font-size: 13px; margin: 12px 0 4px; color: #0F1F33; }
    .muted { color: #898781; }
    .list th, .list td { border: 1px solid #DDDCD7; padding: 4px 6px; font-size: 11.5px; vertical-align: top; text-align: left; }
    .list th { background: #F1F5F9; } td.num { text-align: right; } td.late { color: #B91C1C; font-weight: 600; } tr { break-inside: avoid; }
    .note { font-size: 10px; color: #6B7280; margin-top: 6px; }
  </style></head><body>
    <div class="head"><div><h1>${esc(projectName)} — Milestone Report</h1><div class="ms">${esc(milestone)}</div></div><div class="sub">Report generated: <b>${fmtDay(today.toISOString().slice(0, 10))}</b></div></div>
    <div class="card">
      <table class="span"><tr><th>Planned end</th><th>Actual end</th><th style="text-align:right">Difference</th></tr>
        <tr><td>${fmtDay(s.plannedEnd)}</td><td>${s.finished ? fmtDay(s.actualEnd) : 'Not finished yet'}</td><td class="days" style="color:${tone}">${esc(differenceText(s))}</td></tr>
      </table>
      <table class="counts">
        <tr><td>No. of tasks in milestone</td><td class="cv">${s.tasks}</td></tr>
        <tr><td>No. of tasks delayed</td><td class="cv" style="color:#B91C1C">${s.delayedTasks}</td></tr>
        <tr><td>No. of tasks completed on time</td><td class="cv" style="color:#15803D">${s.onTime}</td></tr>
      </table>
      <div class="note">Difference = actual end − planned end.</div>
    </div>
    <div class="card"><h2>Reasons for delay (${s.delayedTasks} delayed task${s.delayedTasks === 1 ? '' : 's'})</h2>${reasons}<div class="note">Number of delayed tasks per reason; a task with two reasons counts for both.</div>${equipmentHtml}</div>
  </body></html>`;
}

export function printMilestoneReport(s: MilestoneSummary, projectName: string, milestone: string, fileName?: string): Promise<void> {
  return printReportHtml(milestoneReportHtml(s, projectName, milestone), fileName);
}

export function exportMilestoneExcel(s: MilestoneSummary, projectName: string, milestone: string, fileName: string): Promise<string> {
  const aoa: (string | number)[][] = [
    [`${projectName} — Milestone Report`],
    [milestone],
    [],
    ['Planned end', 'Actual end', 'Difference'],
    [fmtDay(s.plannedEnd), s.finished ? fmtDay(s.actualEnd) : 'Not finished yet', differenceText(s)],
    [],
    ['No. of tasks in milestone', s.tasks],
    ['No. of tasks delayed', s.delayedTasks],
    ...s.reasons.map((r) => [`   ${r.reason}`, r.tasks, r.days ? `${r.days} days` : '']),
    ...(s.noReason ? [['   Not written', s.noReason]] : []),
    ['No. of tasks completed on time', s.onTime],
    ...(s.equipment.length ? [[], ['Equipment delays', 'Stage', 'Written', 'Days', 'Task delay'], ...s.equipment.map((e) => [e.code, e.stage, e.text, e.days ?? '', lineDelay(e.delayDays)])] : []),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 44 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 60 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Milestone');
  return saveWorkbook(book, fileName, 'Milestone Report (Excel)');
}
