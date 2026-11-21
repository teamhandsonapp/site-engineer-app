import { supabase } from '../supabase';

// Client checklist answers per task (table task_checklist_notes, Flowchart 2):
// the client's checklist points (six from the sheet + Contractor delay), as plain text
// ("On hold", "Shop dwgs", "11th Nov", ...). Empty string = nothing written.

export interface ChecklistNotes {
  architect: string;
  consultant: string;
  client: string;
  procurementStatus: string;
  leadTime: string;
  other: string;
  contractorDelay: string;
  contractorClientFinalization: string;
  // Past Tasks only (2026-11-21): written on both the Pre-construction and Construction tabs.
  equipmentDelay: string;
}

export type ChecklistNoteKey = keyof ChecklistNotes;

// Checklist stage (2026-11-21, Past Tasks): the same points, written
// separately for Pre-construction (task_checklist_notes, the original) and
// Construction (task_construction_notes).
// 'copyPreConstruction' (2026-11-21): the Pre-construction delays of a Current
// Status task copied onto the Past Works tab — its own table, so moving those
// delays to Construction there leaves the Current Status checklist untouched.
export type ChecklistStage = 'preConstruction' | 'copyPreConstruction' | 'construction';
export const CHECKLIST_STAGE_LABEL: Record<ChecklistStage, string> = {
  preConstruction: 'Pre-construction',
  copyPreConstruction: 'Pre-construction',
  construction: 'Construction',
};
const STAGE_TABLE: Record<ChecklistStage, string> = {
  preConstruction: 'task_checklist_notes',
  copyPreConstruction: 'task_copy_preconstruction_notes',
  construction: 'task_construction_notes',
};

/** The construction table isn't in this database yet (its migration hasn't been run). */
export function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '42P01' || e?.code === 'PGRST205' || /task_(construction|copy_preconstruction)_notes/.test(e?.message ?? '');
}

// `color`: each point's own colour on the card's checklist wheel and its
// read-only pop-up (2026-11-14).
export const CHECKLIST_NOTE_FIELDS: { key: ChecklistNoteKey; label: string; column: string; color: string }[] = [
  { key: 'architect', label: 'Drawing approval — Architect', column: 'architect', color: '#2563EB' },
  { key: 'consultant', label: 'Drawing approval — Consultant', column: 'consultant', color: '#7C3AED' },
  { key: 'client', label: 'Client approval', column: 'client', color: '#DB2777' },
  { key: 'procurementStatus', label: 'Procurement delay', column: 'procurement_status', color: '#EA580C' },
  { key: 'leadTime', label: 'Material Procurement Status', column: 'lead_time', color: '#0D9488' },
  { key: 'other', label: 'Roof Erection Process', column: 'other', color: '#CA8A04' },
  { key: 'contractorDelay', label: 'Workers delay', column: 'contractor_delay', color: '#B91C1C' },
  // 2026-11-16: next to Client approval in Sheet View.
  { key: 'contractorClientFinalization', label: 'Contractor / Vendor Finalization', column: 'contractor_client_finalization', color: '#0891B2' },
];

// Equipment delays (2026-11-21, client): Past Tasks only, on both stage tabs.
// Kept out of CHECKLIST_NOTE_FIELDS so the other boards (wheel, Sheet View,
// reports) are unchanged.
export const EQUIPMENT_DELAY_FIELD: { key: ChecklistNoteKey; label: string; column: string; color: string } = {
  key: 'equipmentDelay',
  label: 'Equipment delays',
  column: 'equipment_delay',
  color: '#4B5563',
};
/** The checklist points on the Past Tasks stage tabs. */
export const STAGED_NOTE_FIELDS = [...CHECKLIST_NOTE_FIELDS, EQUIPMENT_DELAY_FIELD];

// Contractor (2026-11-16): Procurement delay and Workers delay are the
// contractor's two points — shown side by side under one "Contractor" heading.
export const CONTRACTOR_KEYS: ChecklistNoteKey[] = ['procurementStatus', 'contractorDelay'];

/** The contractor for a department (2026-11-16): "Civil Works" → "Civil contractor", "Electrical" → "Electrical contractor". */
export function contractorFor(department: string | null | undefined): string {
  const d = (department ?? '').replace(/\s*works?$/i, '').trim();
  return d && d !== 'Unassigned' ? `${d} contractor` : 'Contractor';
}

/** Sheet / report column order: the two Contractor columns together, Other last. */
export const SHEET_FIELD_ORDER: ChecklistNoteKey[] = ['architect', 'consultant', 'client', 'contractorClientFinalization', 'leadTime', 'procurementStatus', 'contractorDelay', 'other'];

// Points (2026-11-21, Past Works): a checklist field can hold several delays,
// one per line in the same text column — "Add point" in the task sheet.
// Older single-text answers read as one point, so nothing needs migrating.
/** The separate points written in one field (blank lines dropped). */
export function splitPoints(text: string | null | undefined): string[] {
  return (text ?? '').split('\n').map((p) => p.trim()).filter(Boolean);
}
/** Points back into the stored text: one per line, blanks dropped. */
export function joinPoints(points: string[]): string {
  return points.map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n');
}
/** For reports: one point as it is, several as a "• " list (one per line). */
export function pointsText(text: string | null | undefined): string {
  const pts = splitPoints(text);
  return pts.length > 1 ? pts.map((p) => `• ${p}`).join('\n') : pts[0] ?? '';
}

export const EMPTY_CHECKLIST_NOTES: ChecklistNotes = { architect: '', consultant: '', client: '', procurementStatus: '', leadTime: '', other: '', contractorDelay: '', contractorClientFinalization: '', equipmentDelay: '' };

interface Row {
  task_id: string;
  architect: string | null;
  consultant: string | null;
  client: string | null;
  procurement_status: string | null;
  lead_time: string | null;
  other: string | null;
  contractor_delay: string | null;
  contractor_client_finalization: string | null;
  equipment_delay?: string | null;
  updated_at: string | null;
}

const BASE_SELECT = 'task_id, architect, consultant, client, procurement_status, lead_time, other, contractor_delay, contractor_client_finalization, updated_at';
const SELECT = `${BASE_SELECT}, equipment_delay`;

/** The equipment_delay column isn't in this database yet (its migration hasn't been run). */
export function isMissingEquipmentColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return /equipment_delay/.test(e?.message ?? '') && (e?.code === '42703' || e?.code === 'PGRST204' || /column/i.test(e?.message ?? ''));
}

/** Runs a read with equipment_delay; if that column doesn't exist yet, reads without it. */
async function withEquipmentFallback<T>(run: (select: string) => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const first = await run(SELECT);
  if (!first.error) return first.data;
  if (!isMissingEquipmentColumn(first.error)) throw first.error;
  const second = await run(BASE_SELECT);
  if (second.error) throw second.error;
  return second.data;
}

function fromRow(r: Row): ChecklistNotes & { updatedAt: string | null } {
  return {
    architect: r.architect ?? '',
    consultant: r.consultant ?? '',
    client: r.client ?? '',
    procurementStatus: r.procurement_status ?? '',
    leadTime: r.lead_time ?? '',
    other: r.other ?? '',
    contractorDelay: r.contractor_delay ?? '',
    contractorClientFinalization: r.contractor_client_finalization ?? '',
    equipmentDelay: r.equipment_delay ?? '',
    updatedAt: r.updated_at,
  };
}

export async function fetchChecklistNotes(taskId: string, stage: ChecklistStage = 'preConstruction'): Promise<(ChecklistNotes & { updatedAt: string | null }) | null> {
  const data = await withEquipmentFallback((select) => supabase.from(STAGE_TABLE[stage]).select(select).eq('task_id', taskId).maybeSingle());
  return data ? fromRow(data as unknown as Row) : null;
}

export async function fetchChecklistNotesForTasks(taskIds: string[], stage: ChecklistStage = 'preConstruction'): Promise<Map<string, ChecklistNotes>> {
  const out = new Map<string, ChecklistNotes>();
  for (let i = 0; i < taskIds.length; i += 200) {
    const batch = taskIds.slice(i, i + 200);
    const data = await withEquipmentFallback((select) => supabase.from(STAGE_TABLE[stage]).select(select).in('task_id', batch));
    for (const r of (data ?? []) as unknown as Row[]) out.set(r.task_id, fromRow(r));
  }
  return out;
}

export async function saveChecklistNotes(taskId: string, notes: ChecklistNotes, updatedBy: string | null, stage: ChecklistStage = 'preConstruction'): Promise<void> {
  const clean = (s: string) => (s.trim() ? s.trim() : null);
  const row = {
      task_id: taskId,
      architect: clean(notes.architect),
      consultant: clean(notes.consultant),
      client: clean(notes.client),
      procurement_status: clean(notes.procurementStatus),
      lead_time: clean(notes.leadTime),
      other: clean(notes.other),
      contractor_delay: clean(notes.contractorDelay),
      contractor_client_finalization: clean(notes.contractorClientFinalization),
      equipment_delay: clean(notes.equipmentDelay ?? ''),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
  };
  const { error } = await supabase.from(STAGE_TABLE[stage]).upsert(row, { onConflict: 'task_id' });
  if (!error) return;
  // Database without the equipment_delay column yet: save the rest, unless an
  // Equipment delay was actually written (then say what's needed).
  if (isMissingEquipmentColumn(error)) {
    if (row.equipment_delay) throw new Error('Equipment delays need a database update first (run supabase/migrations/20261121130000_checklist_equipment_delay.sql).');
    const { equipment_delay: _skip, ...rest } = row;
    const retry = await supabase.from(STAGE_TABLE[stage]).upsert(rest, { onConflict: 'task_id' });
    if (retry.error) throw retry.error;
    return;
  }
  throw error;
}

/** Sheet View autosave (2026-11-15): one cell at a time — only this column is written, the others are left alone.
 *  `stage` (2026-11-21): Past Works point autosave writes to that stage's table. */
export async function saveChecklistNoteField(
  taskId: string,
  key: ChecklistNoteKey,
  value: string,
  updatedBy: string | null,
  stage: ChecklistStage = 'preConstruction'
): Promise<void> {
  const column = STAGED_NOTE_FIELDS.find((f) => f.key === key)!.column;
  const { error } = await supabase
    .from(STAGE_TABLE[stage])
    .upsert(
      { task_id: taskId, [column]: value.trim() ? value.trim() : null, updated_at: new Date().toISOString(), updated_by: updatedBy },
      { onConflict: 'task_id' }
    );
  if (error) throw error;
}
