import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { CHECKLIST_NOTE_FIELDS, CONTRACTOR_KEYS, contractorFor, SHEET_FIELD_ORDER, EMPTY_CHECKLIST_NOTES, type ChecklistNoteKey, type ChecklistNotes } from './checklistNotes';
import { formatCardDateRange } from './delay';
import { saveWorkbook } from './excelExport';
import { sheetStatus, type SheetStatusTask } from './sheetStatus';

// Flowchart 2 "Reports" tab (2026-11-15): the Sheet View's columns as a
// report — one row per task — downloadable as Excel or printed / saved as
// PDF. Whatever filter is on decides which tasks are in it.

// Same column order as the Sheet View; the contractor's two columns read
// "Contractor — Procurement delay" / "Contractor — Workers delay" in reports.
export const SHEET_FIELDS = SHEET_FIELD_ORDER.map((k) => {
  const f = CHECKLIST_NOTE_FIELDS.find((x) => x.key === k)!;
  return CONTRACTOR_KEYS.includes(k) ? { ...f, label: `Contractor — ${f.label}` } : f;
});

// Three groups only (2026-11-16, client) — every task is in exactly one, so they add up to the total:
//   Pending   = not finished and late (planned start passed, or running past its planned end)
//   Upcoming  = not finished and not late (start still ahead, running on time, or no dates yet)
//   Completed = has an Actual End
// 'In progress' (2026-11-16): has an Actual Start but no Actual End.
export type ReportStatus = 'Pending' | 'In progress' | 'Upcoming' | 'Completed';

export interface SheetReportRow {
  no: number;
  taskCode: string;
  taskName: string;
  department: string;
  status: ReportStatus;
  plannedDates: string; // completed tasks only
  actualDates: string; // completed tasks only
  delay: string; // Pre-con/Const/Total, or "Nd delay"
  delayed: boolean;
  delayDays: number; // total delay in days (0 = on time)
  notes: ChecklistNotes;
}

export function sheetReportRows(
  tasks: ({ id: string; taskId: string; taskName: string; workName: string } & SheetStatusTask)[],
  notes: Map<string, ChecklistNotes>,
  today: string
): SheetReportRow[] {
  const rows: SheetReportRow[] = tasks.map((t, i) => {
    const st = sheetStatus(t, today);
    const done = st.completed;
    const delay = done?.delay ?? st.open?.delay ?? '';
    return {
      no: i + 1,
      taskCode: t.taskId,
      taskName: t.taskName.trim(),
      department: t.workName && t.workName !== 'Unassigned' ? t.workName : '',
      status: done ? 'Completed' : t.actualStartDate ? 'In progress' : st.open?.delay ? 'Pending' : 'Upcoming',
      plannedDates: done ? formatCardDateRange(t.plannedStartDate, t.dueDate) : '',
      actualDates: done?.dates ?? '',
      delay,
      delayed: /\d+d delay|Total: [1-9]/.test(delay),
      delayDays: Math.max(0, Number(/Total: (-?\d+)d/.exec(delay)?.[1] ?? /(\d+)d delay/.exec(delay)?.[1] ?? 0)),
      notes: notes.get(t.id) ?? EMPTY_CHECKLIST_NOTES,
    };
  });
  // Group by status in report order; tasks keep their date order inside a group.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => REPORT_STATUSES.indexOf(a.r.status) - REPORT_STATUSES.indexOf(b.r.status) || a.i - b.i)
    .map(({ r }, i) => ({ ...r, no: i + 1 }));
}

// ─── Chart data (2026-11-16) ─────────────────────────────────────────────
// Status colours in the app's own palette (2026-11-16, by request): brand navy,
// brand amber, light slate. Always shown with a text label / count.
export const STATUS_COLORS: Record<ReportStatus, string> = { Pending: '#DC2626', 'In progress': '#F0A227', Upcoming: '#2563EB', Completed: '#16A34A' };
export const DELAY_RED = '#DC2626';
export const REPORT_STATUSES: ReportStatus[] = ['Pending', 'In progress', 'Upcoming', 'Completed'];

export interface ReportSummary {
  total: number;
  byStatus: Record<ReportStatus, number>;
  delayed: number;
  /** Per department, biggest first: status counts and delayed count. */
  departments: { name: string; byStatus: Record<ReportStatus, number>; total: number; delayed: number; delayDays: number }[];
  /** Most delayed tasks first (only tasks with a delay). */
  topDelayed: SheetReportRow[];
  /** Per checklist point: how many tasks have something written. */
  checklist: { key: ChecklistNoteKey; label: string; color: string; written: number }[];
  /** Reasons for delay, by who (the checklist column it is written in). Biggest first. */
  reasons: { key: ChecklistNoteKey; label: string; who: string; tasks: number; delayed: number; items: { taskName: string; text: string; delay: string; delayed: boolean }[] }[];
  /** Pending tasks with no reason written at all. */
  delayedNoReason: number;
}

/** Who each checklist column points at, for "reason for delay" (2026-11-16). */
export const REASON_WHO: Record<ChecklistNoteKey, string> = {
  architect: 'Architect',
  consultant: 'Consultant',
  client: 'Client',
  procurementStatus: 'Contractor — Procurement',
  leadTime: 'Material Procurement Status',
  contractorDelay: 'Contractor — Workers',
  contractorClientFinalization: 'Contractor / Vendor Finalization',
  other: 'Roof Erection Process',
};

/** The reason texts written for a task, one per line, text only (2026-11-16). */
/**
 * Who the given tasks are waiting on (2026-11-16), most tasks first, e.g.
 * [{ who: 'Civil contractor', tasks: 12 }, { who: 'Architect', tasks: 5 }, …, { who: 'No reason written', tasks: 8 }].
 * Each task counted once (bars add up to the total): a task with two delays goes under its first one in column order.
 */
export function waitingOn(rows: SheetReportRow[], skip: string[] = []): { who: string; tasks: number }[] {
  const count = new Map<string, number>();
  let none = 0;
  for (const r of rows) {
    // Each task counted ONCE so the bars add up to the box total (client, 2026-11-16).
    // A task with two delays goes under the first one in Sheet View column order
    // (Architect → Consultant → Client → Lead time → Procurement → Workers → Roof Erection).
    // `skip` (e.g. Client): pass over it to the task's next reason; only used when it's the sole reason.
    const all = reasonEntries(r);
    const first = all.find((e) => !skip.includes(e.who)) ?? all[0];
    if (!first) {
      none++;
      continue;
    }
    count.set(first.who, (count.get(first.who) ?? 0) + 1);
  }
  const out = [...count.entries()].map(([who, tasks]) => ({ who, tasks })).sort((a, b) => b.tasks - a.tasks || a.who.localeCompare(b.who));
  if (none > 0) out.push({ who: 'No reason written', tasks: none });
  return out;
}

/** Each written reason with who it points at (2026-11-16): [{ who: 'Civil contractor — Workers', text: 'Workers Delay' }]. */
export function reasonEntries(r: SheetReportRow): { who: string; text: string }[] {
  return SHEET_FIELDS.filter((f) => r.notes[f.key]?.trim()).map((f) => ({ who: whoFor(f.key, r), text: r.notes[f.key].trim() }));
}

export function reasonLines(r: SheetReportRow): string[] {
  return SHEET_FIELDS.map((f) => r.notes[f.key]?.trim()).filter((v): v is string => !!v);
}

/** Who is responsible, names only (2026-11-16), e.g. "Client, Other". */
export function responsibleText(r: SheetReportRow): string {
  return SHEET_FIELDS.filter((f) => r.notes[f.key]?.trim()).map((f) => whoFor(f.key, r)).join(', ');
}

// ─── Party report (2026-11-16, client) ──────────────────────────────────
// "Report for: Architect" — only the tasks waiting on that party, with every
// other party's reasons cleared, so the whole report (boxes, bars,
// Dependencies, PDF) is about that party alone. Normal filters are separate.
export function partyRows(rows: SheetReportRow[], party: string): SheetReportRow[] {
  return rows.flatMap((r) => {
    const keep = SHEET_FIELDS.filter((f) => r.notes[f.key]?.trim() && whoFor(f.key, r) === party).map((f) => f.key);
    if (keep.length === 0) return [];
    const notes: ChecklistNotes = { ...EMPTY_CHECKLIST_NOTES };
    for (const k of keep) notes[k] = r.notes[k];
    return [{ ...r, notes }];
  });
}

const PARTY_ORDER = ['Architect', 'Consultant (MEP)', 'Consultant (Structural)', 'Consultant', 'Client'];
/** Everyone named in the reasons, Architect / Consultants / Client first, then the rest A–Z. */
export function reportParties(rows: SheetReportRow[]): string[] {
  const all = new Set(rows.flatMap((r) => reasonEntries(r).map((e) => e.who)));
  const rank = (w: string) => (PARTY_ORDER.includes(w) ? PARTY_ORDER.indexOf(w) : PARTY_ORDER.length);
  return [...all].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export const reportTitle = (party?: string | null) => (party ? `${party} Report` : 'Project Status');

/**
 * Status chips can be combined (2026-11-17, client), e.g. Pending + Upcoming in one report.
 * Tapping a status turns it on/off; All (or all four picked) = no status filter, i.e. [].
 */
export function toggleStatus(cur: ReportStatus[], s: ReportStatus | 'All'): ReportStatus[] {
  if (s === 'All') return [];
  const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
  const ordered = REPORT_STATUSES.filter((x) => next.includes(x));
  return ordered.length === REPORT_STATUSES.length ? [] : ordered;
}

/**
 * File name that follows the filters (2026-11-16, client), e.g.
 * "ROAST @ Kokapet - Architect - Upcoming Tasks Dependencies - 16 Nov 2026", or with two
 * statuses (status = "Pending & Upcoming") "... - Architect - Pending & Upcoming Tasks Dependencies - ...".
 * `extra` = the other filters in use (department, floor, "… written"), added in brackets.
 */
export function reportFileName(projectName: string, party: string | null, status: string, extra: string[]): string {
  const d = new Date();
  const what = `${status === 'All' ? 'All Tasks' : `${status} Tasks`} Dependencies`;
  const parts = [projectName || 'Project', party ?? 'Project Status', what + (extra.length ? ` (${extra.join(', ')})` : ''), fmtDate(d)];
  return parts
    .join(' - ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

/** Who a reason points at; the contractor depends on the task's department ("Civil contractor — Workers"). */
export function whoFor(key: ChecklistNoteKey, r: SheetReportRow): string {
  if (key === 'procurementStatus') return `${contractorFor(r.department)} — Procurement`;
  if (key === 'contractorDelay') return `${contractorFor(r.department)} — Workers`;
  if (key === 'consultant') return consultantFor(r.notes.consultant, r.department);
  // Other dependencies (2026-11-16): show what it is waiting on, e.g. "Roof Erection", not "Other".
  if (key === 'other') return titleCase(r.notes.other) || REASON_WHO.other;
  return REASON_WHO[key];
}

// Which consultant (2026-11-16, client): from what's written ("MEP …", "Structural …"),
// else from the department (services trades → MEP).
const MEP_DEPARTMENTS = ['Electrical', 'Plumbing', 'HVAC', 'Networking', 'Sound & Home Theatre', 'Lighting Vendor'];
export function consultantFor(text: string, department: string): string {
  if (/\bMEP\b/.test(text)) return 'Consultant (MEP)';
  if (/structural/i.test(text)) return 'Consultant (Structural)';
  if (MEP_DEPARTMENTS.includes(department)) return 'Consultant (MEP)';
  return 'Consultant';
}

const titleCase = (v: string) =>
  v.trim().replace(/\s+/g, ' ').replace(/\b([a-z])/g, (c) => c.toUpperCase());

/** The text under the who line, or '' when it only repeats the who (Other: "Roof erection"). */
export function reasonDetail(e: { who: string; text: string }): string {
  return e.text.trim().toLowerCase() === e.who.trim().toLowerCase() ? '' : e.text;
}

/** Reason for delay with who, e.g. "Client: On hold · Other: Roof erection". */
export function reasonText(r: SheetReportRow): string {
  return SHEET_FIELDS.filter((f) => r.notes[f.key]?.trim())
    .map((f) => `${REASON_WHO[f.key]}: ${r.notes[f.key].trim()}`)
    .join(' · ');
}

export function summarizeReport(rows: SheetReportRow[]): ReportSummary {
  const zero = (): Record<ReportStatus, number> => ({ Pending: 0, 'In progress': 0, Upcoming: 0, Completed: 0 });
  const byStatus = zero();
  const depts = new Map<string, { byStatus: Record<ReportStatus, number>; total: number; delayed: number; delayDays: number }>();
  for (const r of rows) {
    byStatus[r.status]++;
    const name = r.department || 'No department';
    const d = depts.get(name) ?? { byStatus: zero(), total: 0, delayed: 0, delayDays: 0 };
    d.byStatus[r.status]++;
    d.total++;
    if (r.delayed) d.delayed++;
    d.delayDays += r.delayDays;
    depts.set(name, d);
  }
  return {
    total: rows.length,
    byStatus,
    delayed: rows.filter((r) => r.delayed).length,
    departments: [...depts.entries()].map(([name, d]) => ({ name, ...d })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    topDelayed: rows.filter((r) => r.delayDays > 0).sort((a, b) => b.delayDays - a.delayDays).slice(0, 10),
    checklist: SHEET_FIELDS.map((f) => ({ key: f.key, label: f.label, color: f.color, written: rows.filter((r) => !!r.notes[f.key]?.trim()).length })),
    // Grouped by who — contractors split by department (Civil contractor, Electrical contractor …).
    reasons: (() => {
      const groups = new Map<string, { key: ChecklistNoteKey; label: string; who: string; tasks: number; delayed: number; items: { taskName: string; text: string; delay: string; delayed: boolean }[] }>();
      for (const f of SHEET_FIELDS) {
        for (const r of rows) {
          const text = r.notes[f.key]?.trim();
          if (!text) continue;
          const who = whoFor(f.key, r);
          const g = groups.get(who) ?? { key: f.key, label: f.label, who, tasks: 0, delayed: 0, items: [] };
          g.tasks++;
          if (r.delayed) g.delayed++;
          g.items.push({ taskName: `${r.taskCode} · ${r.taskName}`, text, delay: r.delay, delayed: r.delayed });
          groups.set(who, g);
        }
      }
      return [...groups.values()].sort((a, b) => b.tasks - a.tasks);
    })(),
    delayedNoReason: rows.filter((r) => r.delayed && !reasonText(r)).length,
  };
}

const HEADERS = ['S.No', 'Task ID', 'Task Name', 'Department', 'Status', 'Planned dates (completed)', 'Actual dates (completed)', 'Delay', 'Reason for delay', ...SHEET_FIELDS.map((f) => f.label)];

function rowValues(r: SheetReportRow): (string | number)[] {
  return [r.no, r.taskCode, r.taskName, r.department, r.status, r.plannedDates, r.actualDates, r.delay, reasonEntries(r).map((e) => (reasonDetail(e) ? `${e.who}: ${e.text}` : e.who)).join('\n'), ...SHEET_FIELDS.map((f) => r.notes[f.key as ChecklistNoteKey])];
}

export async function exportSheetReportExcel(rows: SheetReportRow[], projectName: string, filterText: string, party?: string | null, fileName?: string): Promise<string> {
  const body: (string | number)[][] = [];
  for (const s of REPORT_STATUSES) {
    const group = rows.filter((r) => r.status === s);
    if (group.length === 0) continue;
    body.push([`${s.toUpperCase()} — ${group.length} task${group.length === 1 ? '' : 's'}`], ...group.map(rowValues));
  }
  const sheet = XLSX.utils.aoa_to_sheet([[`${reportTitle(party)} — ${filterText}`], [], HEADERS, ...body]);
  sheet['!cols'] = [{ wch: 6 }, { wch: 9 }, { wch: 44 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 34 }, { wch: 50 }, ...SHEET_FIELDS.map(() => ({ wch: 28 }))];
  sheet['!freeze'] = { xSplit: 3, ySplit: 3 };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Report');
  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = fileName || `${(projectName || 'Project').replace(/[^\w@ -]+/g, '').trim()} - ${reportTitle(party)} ${stamp}`;
  return saveWorkbook(book, baseName, 'Flowchart 2 Report (Excel)');
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ─── A4 portrait PDF (2026-11-16, client) ────────────────────────────────
// Same order as the Reports screen; any number of pages, nothing squeezed:
// cards never split across a page, the task table repeats its header on
// every page and rows never break in half.

const WHO_PDF_COLORS: Record<string, string> = {
  Architect: '#2563EB',
  Consultant: '#7C3AED',
  'Consultant (MEP)': '#7C3AED',
  'Consultant (Structural)': '#C026D3',
  Client: '#DB2777',
  'Material Procurement Status': '#0D9488',
  'Contractor / Vendor Finalization': '#0891B2',
  'No reason written': '#CBD5E1',
};
const PDF_CONTRACTOR = ['#EA580C', '#0EA5E9', '#16A34A', '#9333EA', '#B91C1C', '#0F766E'];
const PDF_OTHER = ['#CA8A04', '#65A30D', '#0891B2', '#A16207'];

function pdfColorFor(whos: string[]): (w: string) => string {
  const contractors = whos.filter((w) => /contractor( — |$)/i.test(w)).sort();
  const others = whos.filter((w) => !WHO_PDF_COLORS[w] && !contractors.includes(w));
  return (w: string) =>
    WHO_PDF_COLORS[w] ??
    (contractors.includes(w) ? PDF_CONTRACTOR[contractors.indexOf(w) % PDF_CONTRACTOR.length] : PDF_OTHER[Math.max(0, others.indexOf(w)) % PDF_OTHER.length]);
}

function pdfBars(items: { who: string; tasks: number }[], total: number): string {
  const color = pdfColorFor(items.map((x) => x.who));
  return items
    .map(
      (x) => `<div class="wb"><div class="wbl"><span${x.who === 'No reason written' ? ' class="muted"' : ''}>${esc(x.who)}</span><b>${x.tasks}</b></div>
      <div class="track"><div style="width:${total > 0 ? Math.min(100, (x.tasks / total) * 100) : 0}%;background:${color(x.who)}"></div></div></div>`
    )
    .join('');
}

function pdfBar(label: string, parts: { c: string; n: number }[], max: number, value: string, note = ''): string {
  const total = parts.reduce((x, q) => x + q.n, 0);
  // Each part keeps room for its number (min 24px), so small counts like 1 stay readable.
  const shown = parts.filter((q) => q.n > 0);
  const counts = parts.length > 1;
  const segs = shown.map((q) => `<span style="flex:${q.n};${counts ? 'min-width:24px;' : ''}background:${q.c};color:${q.c === '#F0A227' ? '#0F172A' : '#fff'}">${counts ? q.n : ''}</span>`).join('');
  return `<div class="br"><div class="bl">${esc(label)}</div><div class="bt"><div class="track" style="display:flex;align-items:center"><div class="bf" style="width:calc((100% - 48px) * ${max > 0 ? total / max : 0});${counts ? `min-width:${shown.length * 26}px;` : ''}">${segs}</div><b class="bv2">${esc(value)}</b></div></div></div>${note ? `<div class="rs">${esc(note)}</div>` : ''}`;
}

function pdfDependencies(title: string, rows: SheetReportRow[], keepClient = false): string {
  const reasons = summarizeReport(rows).reasons.filter((x) => keepClient || x.who !== 'Client');
  if (reasons.length === 0) return ''; // empty boxes are left out (2026-11-16)
  // Heading in the person's colour with the count beside it; no chip row (2026-11-16).
  const color = pdfColorFor(reasons.map((x) => x.who));
  const lists = reasons
    .map((x) => `<div class="who" style="border-left-color:${color(x.who)}"><div class="wh" style="color:${color(x.who)}">${esc(x.who)} <b style="color:#0b0b0b">${x.tasks}</b></div>${x.items.map((it) => `<div class="wi">${esc(it.taskName)}${it.text && it.text.toLowerCase() !== x.who.toLowerCase() ? `<div class="wt">${esc(it.text)}</div>` : ''}</div>`).join('')}</div>`)
    .join('');
  return `<div class="card deps"><h2>${esc(title)}</h2><div class="lists">${lists}</div></div>`;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
const fmtTime = (d: Date) => {
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
};

export function sheetReportHtml(
  rows: SheetReportRow[],
  projectName: string,
  filterText: string,
  projectCreatedAt?: string | null,
  party?: string | null,
  picked?: ReportStatus[] | null
): string {
  const keepClient = party === 'Client';
  const sum = summarizeReport(rows);
  const pc = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 100) : 0);
  const of = (st: ReportStatus) => rows.filter((r) => r.status === st);

  // 1. Count boxes: Total + one per status, each status with its "waiting on" bars.
  const totalTile =
    `<div class="tile"><div class="tl">Total tasks</div><div class="tv">${sum.total}</div><div class="ts">Pending + In progress + Upcoming + Completed</div>
      <div class="wbs">${REPORT_STATUSES.map((st) => `<div class="wb"><div class="wbl"><span>${st}</span><b>${sum.byStatus[st]}</b></div><div class="track"><div style="width:${pc(sum.byStatus[st], sum.total)}%;background:${STATUS_COLORS[st]}"></div></div></div>`).join('')}</div></div>`;
  const tileOf = (st: ReportStatus) => `<div class="tile"><div class="tl"><i style="background:${STATUS_COLORS[st]}"></i>${st}</div><div class="tv">${sum.byStatus[st]}</div><div class="ts">${pc(sum.byStatus[st], sum.total)}% of tasks</div>
      ${!sum.byStatus[st] ? '' : st === 'In progress' ? `<div class="wbs">${of(st).map((r) => `<div class="wi"><b>${esc(r.taskCode)}</b> · ${esc(r.taskName)}</div>`).join('')}</div>` : `<div class="wbs">${pdfBars(waitingOn(of(st), ['Client']), sum.byStatus[st])}</div>`}</div>`;
  // Layout (2026-11-16): Total | Pending, then [In progress + Completed stacked] | Upcoming,
  // so the short boxes don't stretch to the tall Upcoming box. Statuses picked → only their boxes (2026-11-17).
  const tiles = picked
    ? picked.map(tileOf).join('')
    : totalTile + tileOf('Pending') + `<div class="stack">${tileOf('In progress')}${tileOf('Completed')}</div>` + tileOf('Upcoming');

  // 2. Most delayed + checklist
  const delayMax = Math.max(1, ...sum.topDelayed.map((r) => r.delayDays));
  const mostDelayed = sum.topDelayed.length
    ? sum.topDelayed.map((r) => pdfBar(`${r.taskCode} · ${r.taskName}`, [{ c: '#DC2626', n: r.delayDays }], delayMax, `${r.delayDays}d`, responsibleText(r) ? `Responsible: ${responsibleText(r)}` : 'No one responsible written')).join('')
    : '<p class="muted">No delayed tasks.</p>';
  const checklist = sum.checklist.map((c) => pdfBar(c.label, [{ c: '#0F1F33', n: c.written }], sum.total, `${c.written} · ${pc(c.written, sum.total)}%`)).join('');

  // 3. Delay by department
  const deptRows = sum.departments
    .map((d) => `<tr><td>${esc(d.name)}</td><td class="num">${d.delayed} of ${d.total}</td><td class="num"><b>${d.delayDays}d</b></td></tr>`)
    .join('');

  // 4. Task sheet
  const reasonCell = (r: SheetReportRow) =>
    reasonEntries(r).map((e) => `<b>${esc(e.who)}</b>${reasonDetail(e) ? `<br>${esc(e.text)}` : ''}`).join('<br>');
  const taskRow = (r: SheetReportRow) =>
    `<tr><td class="num muted">${r.no}</td><td><b>${esc(r.taskCode)}</b></td><td>${esc(r.taskName)}</td><td>${esc(r.department)}</td><td>${esc(r.plannedDates)}</td><td>${esc(r.actualDates)}</td><td${r.delayed ? ' class="late"' : ''}>${esc(r.delay)}</td><td class="reason">${reasonCell(r)}</td></tr>`;
  const sheet = REPORT_STATUSES.map((st) => {
    const g = of(st);
    return g.length ? `<tr class="grp"><td colspan="8"><i style="background:${STATUS_COLORS[st]}"></i>${st} · ${g.length} task${g.length === 1 ? '' : 's'}</td></tr>${g.map(taskRow).join('')}` : '';
  }).join('');

  // 5. Task status donut + tasks by department (last, like the screen)
  let at = 0;
  const stops: string[] = [];
  for (const st of REPORT_STATUSES) {
    const deg = (sum.byStatus[st] / Math.max(sum.total, 1)) * 360;
    if (deg <= 0) continue;
    stops.push(`${STATUS_COLORS[st]} ${at}deg ${Math.max(at, at + deg - 1.5)}deg`, `#ffffff ${Math.max(at, at + deg - 1.5)}deg ${at + deg}deg`);
    at += deg;
  }
  const legend = REPORT_STATUSES.map((st) => `<div class="lg"><i style="background:${STATUS_COLORS[st]}"></i><span>${st}</span><b>${sum.byStatus[st]}</b><em>${pc(sum.byStatus[st], sum.total)}%</em></div>`).join('');
  const deptMax = Math.max(1, ...sum.departments.map((d) => d.total));
  const deptBars = sum.departments.map((d) => pdfBar(d.name, REPORT_STATUSES.map((st) => ({ c: STATUS_COLORS[st], n: d.byStatus[st] })), deptMax, String(d.total))).join('');
  const keys = REPORT_STATUSES.filter((st) => !picked || picked.includes(st)).map((st) => `<span><i style="background:${STATUS_COLORS[st]}"></i>${st}</span>`).join('');

  const today = new Date();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(projectName)} — ${esc(reportTitle(party))}</title><style>
    /* Our own page footer (2026-11-16): "Teamhandson" bottom-left, a bigger page number
       bottom-right; empty top boxes so the browser's URL/title header isn't printed. */
    @page {
      size: A4 portrait; margin: 12mm 11mm 16mm;
      @top-left { content: ""; } @top-center { content: ""; } @top-right { content: ""; }
      @bottom-left { content: "Team Hands On Pvt Ltd"; font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 11px; font-weight: 700; color: #0F1F33; }
      @bottom-center { content: ""; }
      @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 13px; font-weight: 700; color: #0F1F33; }
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #0b0b0b; font-size: 13px; }
    h1 { font-size: 24px; margin: 0; color: #0F1F33; }
    h2 { font-size: 16px; margin: 0 0 8px; color: #0F1F33; }
    .head { border-bottom: 2px solid #0F1F33; padding-bottom: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-end; }
    .head .sub { font-size: 9.5px; color: #52514e; margin-top: 2px; }
    .muted { color: #898781; }
    i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
    .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; align-items: stretch; }
    .tiles.one { grid-template-columns: 1fr; }
    /* In progress on top, then a gap; Completed stretches so its bottom lines up with Upcoming's. */
    .stack { display: flex; flex-direction: column; gap: 14px; }
    /* In progress centred in the space above Completed; Completed ends level with Upcoming. */
    .stack > .tile:first-child { margin-top: auto; margin-bottom: auto; }
    .tile { border: 1px solid #E7E5E0; border-radius: 10px; padding: 8px 10px; break-inside: avoid; }
    .tl { font-size: 15.5px; color: #52514e; }
    .tv { font-size: 30px; font-weight: 700; line-height: 1.15; }
    .ts { font-size: 13.5px; color: #898781; }
    .wbs { margin-top: 6px; border-top: 1px solid #E7E5E0; padding-top: 5px; }
    .wb { margin-bottom: 4px; }
    .wbl { display: flex; justify-content: space-between; font-size: 14px; color: #52514e; }
    .track { height: 11px; background: #F0EFEC; border-radius: 3px; overflow: hidden; margin-top: 2px; }
    .track > div { height: 100%; border-radius: 3px; }
    .card { border: 1px solid #E7E5E0; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; break-inside: avoid; }
    .card.deps { break-inside: avoid; page-break-inside: avoid; margin-bottom: 26px; }
    h2, .chips { break-after: avoid; page-break-after: avoid; }
    .br { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .bl { width: 30%; font-size: 15px; font-weight: 400; }
    .bv2 { margin-left: 8px; font-size: 13px; white-space: nowrap; flex: none; }
    .bt { flex: 1; }
    .bt .track { height: 28px; }
    .bf { display: flex; gap: 1.5px; height: 100%; }
    .bf span { display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; overflow: visible; white-space: nowrap; }
    .bf span:last-child { border-radius: 0 3px 3px 0; }
    .bv { width: 70px; text-align: right; font-weight: 700; font-size: 12px; }
    .rs { font-size: 10.5px; color: #52514e; margin: 1px 0 3px 39%; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
    .chip { background: #FEF5E4; border-radius: 8px; padding: 5px 10px; font-size: 12px; color: #412402; }
    .chip b { margin-left: 6px; color: #0b0b0b; font-size: 11px; }
    /* Grid, not CSS columns: CSS columns push the last block onto a new page in print. */
    .lists { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12px; align-items: start; }
    /* Each person in its own small box (2026-11-16). */
    .who { border: 1px solid #E7E5E0; border-left: 4px solid #F0A227; border-radius: 7px; padding: 4px 8px 9px; margin-bottom: 8px; break-inside: avoid; }
    .wh { font-weight: 700; font-size: 15px; margin-bottom: 2px; }
    .wt { font-size: 12px; font-weight: 400; color: #52514e; margin: 0 0 2px; }
    .wi { font-size: 14.5px; font-weight: 600; line-height: 1.16; overflow-wrap: anywhere; color: #1F2937; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #DDDCD7; padding: 4px 5px; vertical-align: top; text-align: left; font-size: 11.5px; line-height: 1.35; word-wrap: break-word; }
    th { background: #F1F5F9; font-weight: 700; color: #334155; }
    td.num, th.num { text-align: right; }
    td.late { color: #B91C1C; font-weight: 600; }
    td.reason b { color: #0F1F33; }
    tr.grp td { background: #F8FAFC; font-weight: 700; font-size: 10px; padding: 5px 6px; }
    .sheet-title { font-size: 12px; font-weight: 700; color: #0F1F33; margin: 4px 0 6px; break-after: avoid; }
    .end { display: grid; grid-template-columns: 1fr; gap: 0; }
    .donutrow { display: flex; align-items: center; gap: 22px; }
    .donut { width: 190px; height: 190px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none; }
    .donut > div { width: 128px; height: 128px; border-radius: 50%; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; }
    .donut small { font-size: 10px; font-weight: 400; color: #52514e; }
    .lg { display: flex; align-items: center; gap: 6px; font-size: 11px; margin: 6px 0; }
    .lg span { width: 80px; } .lg b { width: 26px; text-align: right; } .lg em { color: #898781; font-style: normal; }
    .keys { font-size: 9px; color: #52514e; margin-bottom: 4px; } .keys span { margin-right: 12px; }
    .foot { margin-top: 8px; font-size: 8px; color: #898781; text-align: right; }
  </style></head><body>
    <div class="head"><div><h1>${esc(projectName)} — ${esc(reportTitle(party))}</h1><div class="sub">${esc(filterText)}</div></div><div class="sub" style="text-align:right">Report generated: <b>${esc(fmtDate(today))}</b></div></div>
    <div class="tiles${picked?.length === 1 ? ' one' : ''}">${tiles}</div>
    ${pdfDependencies('Dependencies for Pending Tasks', of('Pending'), keepClient)}
    ${pdfDependencies('Dependencies for Completed Tasks', of('Completed'), keepClient)}
    ${pdfDependencies('Dependencies for Upcoming Tasks', of('Upcoming'), keepClient)}
    <div style="height:10px"></div>
    ${party || picked ? '' : `<div class="card"><h2>Tasks by department</h2><div class="keys">${keys}</div>${deptBars}</div>`}
  </body></html>`;
}

/** Opens the print dialog (choose "Save as PDF" there to get a PDF file). */
export async function printSheetReport(
  rows: SheetReportRow[],
  projectName: string,
  filterText: string,
  projectCreatedAt?: string | null,
  party?: string | null,
  fileName?: string,
  picked?: ReportStatus[] | null
): Promise<void> {
  let html = sheetReportHtml(rows, projectName, filterText, projectCreatedAt, party, picked);
  // The browser's "Save as PDF" names the file after the page title, so the title = the file name.
  if (fileName) html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(fileName)}</title>`);
  if (Platform.OS === 'web') {
    // expo-print on web only prints the whole app page, so print the report
    // from a hidden frame instead.
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const doc = frame.contentWindow!.document;
    doc.open();
    doc.write(html);
    doc.close();
    // Some browsers take the PDF name from the main page's title, so set that too while printing.
    const oldTitle = document.title;
    if (fileName) document.title = fileName;
    setTimeout(() => {
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      setTimeout(() => {
        frame.remove();
        document.title = oldTitle;
      }, 1000);
    }, 300);
    return;
  }
  if (!fileName) {
    await Print.printAsync({ html });
    return;
  }
  // Phone: make the PDF, give it the filter-based name, then share / save it.
  const { uri } = await Print.printToFileAsync({ html });
  const named = `${FileSystem.cacheDirectory}${fileName.replace(/[#%]/g, '')}.pdf`;
  await FileSystem.deleteAsync(named, { idempotent: true });
  await FileSystem.moveAsync({ from: uri, to: named });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(named, { mimeType: 'application/pdf', dialogTitle: fileName, UTI: 'com.adobe.pdf' });
}
