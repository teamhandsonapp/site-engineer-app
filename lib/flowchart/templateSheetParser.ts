import * as XLSX from 'xlsx';

// ============================================================
// Template canvas "Upload Sheet" — spreadsheet column format
// ============================================================
// Header row first, columns matched by HEADER TEXT (case-insensitive,
// whitespace-trimmed), not fixed position — unlike admin-web's own sibling
// upload (lib/templateSheet.ts, which takes explicit Row ID/Predecessors
// columns), THIS format infers every relationship from column + row
// position alone:
//
//   Main Task              One task per non-empty cell.
//   Parallel Task (1..N)   One or more columns, any header starting with
//                          "Parallel Task" — one task per non-empty cell,
//                          Parallel-linked to the Main Task task on the
//                          SAME row (if any).
//   Planned Start Date     Any header starting with "Planned Start".
//   Planned End Date       Any header starting with "Planned End".
//
// Every column (Main + each Parallel) is FS-chained independently, in the
// order its own non-empty cells appear top-to-bottom (blank cells in a
// column are skipped, not treated as a break in that column's chain).
// dayOffsetStart/dayOffsetEnd are plain calendar-day differences from the
// sheet's own earliest Planned Start Date (day 0) — a template has no
// project/holiday context of its own to make this working-day-aware the
// way admin-web's "save a live project as a template" flow can.
const MAIN_HEADER = /^main task$/i;
const PARALLEL_HEADER = /^parallel task/i;
const START_HEADER = /^planned start/i;
const END_HEADER = /^planned end/i;

export interface ParsedSheetTask {
  taskName: string;
  columnLabel: string;
  dayOffsetStart: number;
  dayOffsetEnd: number;
}

export interface ParsedSheetLink {
  fromIndex: number; // the prerequisite (FS) or the Main Task (PARALLEL)
  toIndex: number;
  type: 'FS' | 'PARALLEL';
}

export interface TemplateSheetParseResult {
  tasks: ParsedSheetTask[];
  links: ParsedSheetLink[];
  warnings: string[];
  columnLabels: string[];
}

function cellToText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function cellToDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const utcB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((utcA - utcB) / 86_400_000);
}

export function parseTemplateSheetBytes(bytes: Uint8Array): TemplateSheetParseResult {
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The workbook has no sheets.');
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  if (rows.length === 0) throw new Error('The sheet is empty.');

  const header = rows[0].map((h) => cellToText(h));
  const mainColIdx = header.findIndex((h) => MAIN_HEADER.test(h));
  const startColIdx = header.findIndex((h) => START_HEADER.test(h));
  const endColIdx = header.findIndex((h) => END_HEADER.test(h));
  const parallelCols = header
    .map((h, idx) => ({ label: h, idx }))
    .filter(({ label }) => PARALLEL_HEADER.test(label));

  const missing: string[] = [];
  if (mainColIdx === -1) missing.push('Main Task');
  if (startColIdx === -1) missing.push('Planned Start Date');
  if (endColIdx === -1) missing.push('Planned End Date');
  if (missing.length > 0) {
    throw new Error(`Missing required column(s): ${missing.join(', ')}.`);
  }

  const columnLabels = ['Main Task', ...parallelCols.map((c) => c.label)];
  const warnings: string[] = [];

  interface ValidRow {
    excelRowNumber: number;
    mainName: string | null;
    parallelNames: (string | null)[];
    start: Date;
    end: Date;
  }
  const validRows: ValidRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const excelRowNumber = r + 1; // 1-based, matching what a spreadsheet app shows
    const mainName = cellToText(row[mainColIdx]) || null;
    const parallelNames = parallelCols.map(({ idx }) => cellToText(row[idx]) || null);
    const hasAnyTask = !!mainName || parallelNames.some(Boolean);
    if (!hasAnyTask) continue; // a genuinely empty spacer row — not a warning

    const start = cellToDate(row[startColIdx]);
    const end = cellToDate(row[endColIdx]);
    if (!start || !end) {
      warnings.push(`Row ${excelRowNumber}: has a task but a missing or unreadable Planned Start/End Date — skipped.`);
      continue;
    }
    if (end.getTime() < start.getTime()) {
      warnings.push(`Row ${excelRowNumber}: Planned End Date is before Planned Start Date — skipped.`);
      continue;
    }

    parallelCols.forEach(({ label }, i) => {
      if (parallelNames[i] && !mainName) {
        warnings.push(`Row ${excelRowNumber}: "${label}" has no Main Task on this row — task created without a Parallel link.`);
      }
    });

    validRows.push({ excelRowNumber, mainName, parallelNames, start, end });
  }

  if (validRows.length === 0) {
    return { tasks: [], links: [], warnings, columnLabels };
  }

  const earliest = validRows.reduce((min, r) => (r.start.getTime() < min.getTime() ? r.start : min), validRows[0].start);

  const tasks: ParsedSheetTask[] = [];
  const links: ParsedSheetLink[] = [];
  let lastMainIndex: number | null = null;
  const lastParallelIndex: (number | null)[] = parallelCols.map(() => null);

  for (const row of validRows) {
    const dayOffsetStart = daysBetween(row.start, earliest);
    const dayOffsetEnd = daysBetween(row.end, earliest);

    let mainIndex: number | null = null;
    if (row.mainName) {
      mainIndex = tasks.length;
      tasks.push({ taskName: row.mainName, columnLabel: 'Main Task', dayOffsetStart, dayOffsetEnd });
      if (lastMainIndex !== null) links.push({ fromIndex: lastMainIndex, toIndex: mainIndex, type: 'FS' });
      lastMainIndex = mainIndex;
    }

    row.parallelNames.forEach((name, i) => {
      if (!name) return;
      const idx = tasks.length;
      tasks.push({ taskName: name, columnLabel: parallelCols[i].label, dayOffsetStart, dayOffsetEnd });
      if (lastParallelIndex[i] !== null) links.push({ fromIndex: lastParallelIndex[i]!, toIndex: idx, type: 'FS' });
      lastParallelIndex[i] = idx;
      if (mainIndex !== null) links.push({ fromIndex: mainIndex, toIndex: idx, type: 'PARALLEL' });
    });
  }

  return { tasks, links, warnings, columnLabels };
}
