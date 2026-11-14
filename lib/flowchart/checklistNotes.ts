import { supabase } from '../supabase';

// Client checklist answers per task (table task_checklist_notes, Flowchart 2):
// the six points from the client's checklist sheet, as plain text
// ("On hold", "Shop dwgs", "11th Nov", ...). Empty string = nothing written.

export interface ChecklistNotes {
  architect: string;
  consultant: string;
  client: string;
  procurementStatus: string;
  leadTime: string;
  other: string;
}

export type ChecklistNoteKey = keyof ChecklistNotes;

export const CHECKLIST_NOTE_FIELDS: { key: ChecklistNoteKey; label: string; column: string }[] = [
  { key: 'architect', label: 'Drawing approval — Architect', column: 'architect' },
  { key: 'consultant', label: 'Drawing approval — Consultant', column: 'consultant' },
  { key: 'client', label: 'Client approval', column: 'client' },
  { key: 'procurementStatus', label: 'Procurement status', column: 'procurement_status' },
  { key: 'leadTime', label: 'Procurement lead time', column: 'lead_time' },
  { key: 'other', label: 'Other dependencies', column: 'other' },
];

export const EMPTY_CHECKLIST_NOTES: ChecklistNotes = { architect: '', consultant: '', client: '', procurementStatus: '', leadTime: '', other: '' };

interface Row {
  task_id: string;
  architect: string | null;
  consultant: string | null;
  client: string | null;
  procurement_status: string | null;
  lead_time: string | null;
  other: string | null;
  updated_at: string | null;
}

const SELECT = 'task_id, architect, consultant, client, procurement_status, lead_time, other, updated_at';

function fromRow(r: Row): ChecklistNotes & { updatedAt: string | null } {
  return {
    architect: r.architect ?? '',
    consultant: r.consultant ?? '',
    client: r.client ?? '',
    procurementStatus: r.procurement_status ?? '',
    leadTime: r.lead_time ?? '',
    other: r.other ?? '',
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
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: 'task_id' }
  );
  if (error) throw error;
}
