// Delay table (2026-11-23, client): instead of writing delays as checklist
// text (Edit → Checklist tab), the card's checklist icon opens small tables
// straight in edit mode — one per party ("Contractor", "Drawings"), one
// column per cause, days typed in the cells. The same tables for the
// Pre-construction and Construction stages.
//
// Being tried first on the Past Tasks Copy L (−4'6") column only
// (DELAY_GRID_LEVEL), so it can be shown to the client before it goes wider.
//
// Stored per stage in the checklist row's delay_days jsonb, under "grid"
// ({ "contractor.workersShortage": 4, ... }) — no new database column.
// Pure — no Supabase import, so tests can use it.
import type { ChecklistNoteKey } from './checklistNotes';
import { PAST_COPY_LEVEL_STACKS, pastTaskCode } from './dateOrder';

export interface DelayGridColumn {
  key: string;
  /** Column heading in the table. */
  label: string;
  /** Bar name in the reports, when it differs from the heading. */
  reportLabel?: string;
  color: string;
  /** Who the delay is on (milestone report party). */
  party: 'Contractor' | 'Client' | 'Architect' | 'Consultant';
  /** The checklist point this cause already is — counted as that reason in
   *  the reports (not a second bar). Its days replace the checklist's days. */
  field?: ChecklistNoteKey;
  /** Days carried down from the task above (2026-11-23, client): count toward
   *  the card's delay, but are not a reason in the reports — they already are
   *  on the task above. */
  carried?: boolean;
}

export interface DelayGridTable {
  key: string;
  title: string;
  columns: DelayGridColumn[];
  /** Only on the Pre-construction tab (a late start is the only delay the task above can cause). */
  preOnly?: boolean;
}

export const DELAY_GRID_TABLES: DelayGridTable[] = [
  {
    // The task above finished late, so this one started late (2026-11-23, client).
    key: 'previous',
    title: 'Task above',
    preOnly: true,
    columns: [{ key: 'above', label: 'Delay from task above', color: '#6B7280', party: 'Contractor', carried: true }],
  },
  {
    key: 'contractor',
    title: 'Contractor',
    columns: [
      { key: 'workersDelay', label: 'Workers delay', color: '#B91C1C', party: 'Contractor', field: 'contractorDelay' },
      { key: 'workersShortage', label: 'Workers shortage', color: '#9F1239', party: 'Contractor' },
      { key: 'procurementDelay', label: 'Procurement delay', color: '#EA580C', party: 'Contractor', field: 'procurementStatus' },
      { key: 'equipmentDelay', label: 'Equipment delay', color: '#4B5563', party: 'Contractor', field: 'equipmentDelay' },
    ],
  },
  {
    key: 'drawings',
    title: 'Drawings',
    columns: [
      { key: 'architect', label: 'Architect', color: '#2563EB', party: 'Architect', field: 'architect' },
      { key: 'structural', label: 'Structural consultant', reportLabel: 'Drawing approval — Structural consultant', color: '#7C3AED', party: 'Consultant' },
      { key: 'mep', label: 'MEP consultant', reportLabel: 'Drawing approval — MEP consultant', color: '#0891B2', party: 'Consultant' },
    ],
  },
];

/** Cell id → days, e.g. { "contractor.workersShortage": 4 }. */
export type DelayGrid = Record<string, number>;

export const gridCellId = (table: DelayGridTable, column: DelayGridColumn) => `${table.key}.${column.key}`;

export const DELAY_GRID_CELLS = DELAY_GRID_TABLES.flatMap((table) =>
  table.columns.map((column) => ({ id: gridCellId(table, column), table, column }))
);

/** Only cells with whole days above 0 (unknown keys kept as they are); null when empty. */
export function cleanGrid(grid: DelayGrid | null | undefined): DelayGrid | null {
  const out: DelayGrid = {};
  for (const [id, v] of Object.entries(grid ?? {})) {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n > 0) out[id] = Math.min(n, 9999);
  }
  return Object.keys(out).length ? out : null;
}

/** Cell id → the reason written for it (2026-11-23, client), e.g. "Compactor breakdown". */
export type DelayGridNotes = Record<string, string>;

/** Reasons trimmed, empty ones dropped (300 characters at most); null when none. */
export function cleanGridNotes(notes: DelayGridNotes | null | undefined): DelayGridNotes | null {
  const out: DelayGridNotes = {};
  for (const [id, v] of Object.entries(notes ?? {})) {
    const t = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (t) out[id] = t;
  }
  return Object.keys(out).length ? out : null;
}

/** More than one delay per cause (2026-11-23, client: "Excel sheet format"):
 *  each table can have extra rows. Row 1 is the cell id itself (so older
 *  saved tables read the same); row n is "<cell id>#n". */
export const MAX_GRID_ROWS = 10;
export const rowCellId = (cellId: string, row: number) => (row <= 1 ? cellId : `${cellId}#${row}`);
const rowOf = (key: string, cellId: string): number | null => {
  if (key === cellId) return 1;
  if (!key.startsWith(`${cellId}#`)) return null;
  const n = Number(key.slice(cellId.length + 1));
  return Number.isInteger(n) && n > 1 ? n : null;
};

/** One cause's days over all its rows. */
export function cellDays(grid: DelayGrid | null | undefined, cellId: string): number {
  let sum = 0;
  for (const [k, v] of Object.entries(grid ?? {})) if (rowOf(k, cellId) && v > 0) sum += v;
  return sum;
}

/** One cause's reasons, row by row (empty ones left out). */
export function cellNotes(notes: DelayGridNotes | null | undefined, cellId: string): string[] {
  return Object.entries(notes ?? {})
    .map(([k, v]) => ({ row: rowOf(k, cellId), text: String(v ?? '').trim() }))
    .filter((x): x is { row: number; text: string } => x.row !== null && !!x.text)
    .sort((a, b) => a.row - b.row)
    .map((x) => x.text);
}

/** How many rows a table has filled (at least 1). */
export function tableRows(table: DelayGridTable, ...maps: (Record<string, unknown> | null | undefined)[]): number {
  let rows = 1;
  for (const m of maps)
    for (const k of Object.keys(m ?? {}))
      for (const c of table.columns) {
        const r = rowOf(k, gridCellId(table, c));
        if (r && r > rows) rows = r;
      }
  return Math.min(rows, MAX_GRID_ROWS);
}

/** The "Delay from task above" cell. */
export const CARRIED_CELL_ID = 'previous.above';

/** All days in one stage's tables. */
export function gridTotal(grid: DelayGrid | null | undefined): number {
  return Object.values(cleanGrid(grid) ?? {}).reduce((a, b) => a + b, 0);
}

/** Past Tasks Copy column the delay table is on (2026-11-23, client: "only the −4'6" row"). */
export const DELAY_GRID_LEVEL = PAST_COPY_LEVEL_STACKS.find((s) => s.label.includes(`−4'6"`))!;
const GRID_CODES = new Set(DELAY_GRID_LEVEL.taskCodes);

/** A Past Tasks Copy card that gets the delay table (by its code, PTC-xx read as PT-xx). */
export const usesDelayGrid = (taskCode: string) => GRID_CODES.has(pastTaskCode(taskCode));
