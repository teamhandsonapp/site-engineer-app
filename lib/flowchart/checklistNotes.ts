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
}

export type ChecklistNoteKey = keyof ChecklistNotes;

// `color`: each point's own colour on the card's checklist wheel and its
// read-only pop-up (2026-11-14).
export const CHECKLIST_NOTE_FIELDS: { key: ChecklistNoteKey; label: string; column: string; color: string }[] = [
  { key: 'architect', label: 'Drawing approval — Architect', column: 'architect', color: '#2563EB' },
  { key: 'consultant', label: 'Drawing approval — Consultant', column: 'consultant', color: '#7C3AED' },
  { key: 'client', label: 'Client approval', column: 'client', color: '#DB2777' },
  { key: 'procurementStatus', label: 'Procurement delay', column: 'procurement_status', color: '#EA580C' },
  { key: 'leadTime', label: 'Procurement lead time', column: 'lead_time', color: '#0D9488' },
  { key: 'other', label: 'Roof Erection Process', column: 'other', color: '#CA8A04' },
  { key: 'contractorDelay', label: 'Workers delay', column: 'contractor_delay', color: '#B91C1C' },
  // 2026-11-16: next to Client approval in Sheet View.
  { key: 'contractorClientFinalization', label: 'Contractor finalization', column: 'contractor_client_finalization', color: '#0891B2' },
];

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

export const EMPTY_CHECKLIST_NOTES: ChecklistNotes = { architect: '', consultant: '', client: '', procurementStatus: '', leadTime: '', other: '', contractorDelay: '', contractorClientFinalization: '' };

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
  updated_at: string | null;
}

const SELECT = 'task_id, architect, consultant, client, procurement_status, lead_time, other, contractor_delay, contractor_client_finalization, updated_at';

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
    updatedAt: r.updated_at,
  };
}

export async function fetchChecklistNotes(taskId: string): Promise<(ChecklistNotes & { updatedAt: string | null }) | null> {
  const { data, error } = await supabase.from('task_checklist_notes').select(SELECT).eq('task_id', taskId).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as Row) : null;
}

export async function fetchChecklistNotesForTasks(taskIds: string[]): Promise<Map<string, ChecklistNotes>> {
  const out = new Map<string, ChecklistNotes>();
  for (let i = 0; i < taskIds.length; i += 200) {
    const { data, error } = await supabase.from('task_checklist_notes').select(SELECT).in('task_id', taskIds.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as Row[]) out.set(r.task_id, fromRow(r));
  }
  return out;
}

export async function saveChecklistNotes(taskId: string, notes: ChecklistNotes, updatedBy: string | null): Promise<void> {
  const clean = (s: string) => (s.trim() ? s.trim() : null);
  const { error } = await supabase.from('task_checklist_notes').upsert(
    {
      task_id: taskId,
      architect: clean(notes.architect),
      consultant: clean(notes.consultant),
      client: clean(notes.client),
      procurement_status: clean(notes.procurementStatus),
      lead_time: clean(notes.leadTime),
      other: clean(notes.other),
      contractor_delay: clean(notes.contractorDelay),
      contractor_client_finalization: clean(notes.contractorClientFinalization),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: 'task_id' }
  );
  if (error) throw error;
}

/** Sheet View autosave (2026-11-15): one cell at a time — only this column is written, the others are left alone. */
export async function saveChecklistNoteField(taskId: string, key: ChecklistNoteKey, value: string, updatedBy: string | null): Promise<void> {
  const column = CHECKLIST_NOTE_FIELDS.find((f) => f.key === key)!.column;
  const { error } = await supabase
    .from('task_checklist_notes')
    .upsert(
      { task_id: taskId, [column]: value.trim() ? value.trim() : null, updated_at: new Date().toISOString(), updated_by: updatedBy },
      { onConflict: 'task_id' }
    );
  if (error) throw error;
}
