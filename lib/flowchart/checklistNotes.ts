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
  /** Days of delay per point (2026-11-22, client): a small box next to every
   *  delay. Per field, one entry per point, in the same order as splitPoints
   *  (column delay_days, jsonb). null = no days given. */
  delayDays?: DelayDays;
}

export type ChecklistNoteKey = Exclude<keyof ChecklistNotes, 'delayDays'>;
export type DelayDays = Partial<Record<ChecklistNoteKey, (number | null)[]>>;

/** Days given for one field (all its points added up); null when none were given. */
export function fieldDays(n: ChecklistNotes | undefined, key: ChecklistNoteKey): number | null {
  const list = (n?.delayDays?.[key] ?? []).slice(0, Math.max(splitPoints(n?.[key]).length, 1));
  const given = list.filter((d): d is number => typeof d === 'number' && d > 0);
  return given.length ? given.reduce((a, b) => a + b, 0) : null;
}

/** "5" / "" → 5 / null (whole days, 0–9999). */
export function parseDays(text: string): number | null {
  const n = Number(text.replace(/[^0-9]/g, ''));
  return text.trim() && Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : null;
}

/** Only fields with at least one day given; trailing empties dropped. */
export function cleanDelayDays(d: DelayDays | undefined): DelayDays | null {
  const out: DelayDays = {};
  for (const [k, list] of Object.entries(d ?? {}) as [ChecklistNoteKey, (number | null)[]][]) {
    const trimmed = [...(list ?? [])];
    while (trimmed.length && !(typeof trimmed[trimmed.length - 1] === 'number')) trimmed.pop();
    if (trimmed.length) out[k] = trimmed.map((v) => (typeof v === 'number' && v > 0 ? v : null));
  }
  return Object.keys(out).length ? out : null;
}

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
/** One field's points with their days (2026-11-22): "Workers late (5 days)"; one point as it is, several as a "• " list. */
export function notePointsText(n: ChecklistNotes | undefined, key: ChecklistNoteKey): string {
  const days = n?.delayDays?.[key] ?? [];
  const pts = splitPoints(n?.[key]).map((p, i) => (days[i] ? `${p} (${days[i]} day${days[i] === 1 ? '' : 's'})` : p));
  return pts.length > 1 ? pts.map((p) => `• ${p}`).join('\n') : pts[0] ?? '';
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
  delay_days?: DelayDays | null;
  updated_at: string | null;
}

const BASE_SELECT = 'task_id, architect, consultant, client, procurement_status, lead_time, other, contractor_delay, contractor_client_finalization, updated_at';
const SELECT = `${BASE_SELECT}, equipment_delay`;
const FULL_SELECT = `${SELECT}, delay_days`;
let daysColumnMissing = false;

/** The delay_days column isn't in this database yet (its migration hasn't been run). */
export function isMissingDaysColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return /delay_days/.test(e?.message ?? '') && (e?.code === '42703' || e?.code === 'PGRST204' || /column/i.test(e?.message ?? ''));
}

/** The equipment_delay column isn't in this database yet (its migration hasn't been run). */
export function isMissingEquipmentColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return /equipment_delay/.test(e?.message ?? '') && (e?.code === '42703' || e?.code === 'PGRST204' || /column/i.test(e?.message ?? ''));
}

/** Runs a read with equipment_delay; if that column doesn't exist yet, reads without it. */
async function withEquipmentFallback<T>(run: (select: string) => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  if (!daysColumnMissing) {
    const full = await run(FULL_SELECT);
    if (!full.error) return full.data;
    if (!isMissingDaysColumn(full.error) && !isMissingEquipmentColumn(full.error)) throw full.error;
    // Remembered for this session, so every later read doesn't try (and fail) first.
    if (isMissingDaysColumn(full.error)) daysColumnMissing = true;
  }
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
    ...(r.delay_days ? { delayDays: r.delay_days } : {}),
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
      delay_days: cleanDelayDays(notes.delayDays),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
  };
  let attempt: Partial<typeof row> = row;
  let { error } = await supabase.from(STAGE_TABLE[stage]).upsert(row, { onConflict: 'task_id' });
  if (!error) return;
  // Database without the delay_days column yet: save the delays, unless days
  // were actually given (then say what's needed).
  if (isMissingDaysColumn(error)) {
    if (row.delay_days) throw new Error('Days need a database update first (run supabase/migrations/20261122130000_checklist_delay_days.sql).');
    const { delay_days: _days, ...withoutDays } = row;
    attempt = withoutDays;
    ({ error } = await supabase.from(STAGE_TABLE[stage]).upsert(attempt, { onConflict: 'task_id' }));
    if (!error) return;
  }
  // Database without the equipment_delay column yet: save the rest, unless an
  // Equipment delay was actually written (then say what's needed).
  if (isMissingEquipmentColumn(error)) {
    if (row.equipment_delay) throw new Error('Equipment delays need a database update first (run supabase/migrations/20261121130000_checklist_equipment_delay.sql).');
    const { equipment_delay: _skip, delay_days: _noDays, ...rest } = attempt;
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
