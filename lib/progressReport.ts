import { supabase } from './supabase';
import { buildFullDayEntryList, fetchAllDprEntriesForTask, type DprDependencyCategory } from './dprEntries';

// PR — Progress Report (2026-11-11). Instead of filling a task's DPR day by
// day, enter ONE cumulative % for the whole task plus Reasons for Delay; it
// is shared EQUALLY across the task's DPR days and written to those days as
// DRAFTS (dpr_entries.percent_complete, not submitted). Two modes when some
// days already have a %:
//   fill-empty  — filled days keep theirs; (target - already filled) is
//                 shared across the empty days only.
//   overwrite   — target is shared across every day, replacing what's there.
// percent_complete is a smallint, so shares are whole numbers that always
// add up exactly to the target (the remainder goes to the earliest days).
// Same pre-construction gate as the DPR (database-enforced); PR offers a
// one-tap "Mark all as Issued" for the checklist.

export type PrMode = 'fill-empty' | 'overwrite';

export interface PrDay {
  reportDate: string;
  percent: number | null; // the day's current share of the task, null = empty
}

export async function fetchPrDays(taskId: string, plannedStart: string | null, plannedEnd: string | null): Promise<PrDay[]> {
  const real = await fetchAllDprEntriesForTask(taskId);
  return buildFullDayEntryList(real, plannedStart, plannedEnd).map((e) => ({ reportDate: e.reportDate, percent: e.fields.percentComplete }));
}

// Whole-number equal split of `total` over `n` days (sums exactly to total).
export function splitEqually(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

export interface PrPlan {
  targets: { reportDate: string; percent: number }[];
  alreadyFilled: number;
  error: string | null;
}

export function planPr(days: PrDay[], target: number, mode: PrMode): PrPlan {
  const alreadyFilled = days.reduce((s, d) => s + (d.percent ?? 0), 0);
  if (days.length === 0) return { targets: [], alreadyFilled, error: 'This task has no planned days yet.' };
  if (mode === 'overwrite') {
    const shares = splitEqually(target, days.length);
    return { targets: days.map((d, i) => ({ reportDate: d.reportDate, percent: shares[i] })), alreadyFilled, error: null };
  }
  const empty = days.filter((d) => d.percent == null);
  if (empty.length === 0) return { targets: [], alreadyFilled, error: 'Every day is already filled — choose “Overwrite all days” to change them.' };
  const remaining = target - alreadyFilled;
  if (remaining < 0) {
    return { targets: [], alreadyFilled, error: `Filled days already add up to ${alreadyFilled}% — enter at least that, or choose “Overwrite all days”.` };
  }
  const shares = splitEqually(remaining, empty.length);
  return { targets: empty.map((d, i) => ({ reportDate: d.reportDate, percent: shares[i] })), alreadyFilled, error: null };
}

export async function savePr(
  taskId: string,
  targets: { reportDate: string; percent: number }[],
  reasons: DprDependencyCategory[],
  comments: Partial<Record<DprDependencyCategory, string>>,
  userId: string | null
): Promise<void> {
  if (targets.length === 0) return;
  const kept = Object.fromEntries(
    Object.entries(comments)
      .filter(([cat, text]) => reasons.includes(cat as DprDependencyCategory) && !!text?.trim())
      .map(([cat, text]) => [cat, (text as string).trim()])
  );
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('dpr_entries').upsert(
    targets.map((t) => ({
      task_id: taskId,
      report_date: t.reportDate,
      percent_complete: t.percent,
      dependency_categories: reasons,
      dependency_other_text: reasons.includes('other') ? (kept.other ?? null) : null,
      delay_reason_comments: kept,
      submitted_by: userId,
      updated_at: nowIso,
    })),
    { onConflict: 'task_id,report_date' }
  );
  if (error) throw new Error(error.message);
}

// One tap: every checklist item that isn't Issued / Not Required -> Issued.
// The database then moves the task to Ready (pre-construction done).
export async function markAllPrerequisitesIssued(taskId: string, userId: string | null): Promise<number> {
  const { data, error } = await supabase
    .from('dependency_items')
    .select('id, completion:dependency_completions(id, status)')
    .eq('task_id', taskId);
  if (error) throw new Error(error.message);
  type Row = { id: string; completion: { id: string; status: string } | { id: string; status: string }[] | null };
  const nowIso = new Date().toISOString();
  const toUpdate: string[] = [];
  const toInsert: string[] = [];
  for (const row of (data ?? []) as unknown as Row[]) {
    const comp = Array.isArray(row.completion) ? row.completion[0] : row.completion;
    if (comp && ['YES', 'PROCEED', 'NO'].includes(comp.status)) continue;
    if (comp) toUpdate.push(comp.id);
    else toInsert.push(row.id);
  }
  // Two batched writes, not one request per item.
  if (toUpdate.length) {
    const { error: e } = await supabase
      .from('dependency_completions')
      .update({ status: 'YES', completed_by: userId, completed_at: nowIso, updated_at: nowIso })
      .in('id', toUpdate);
    if (e) throw new Error(e.message);
  }
  if (toInsert.length) {
    const { error: e } = await supabase
      .from('dependency_completions')
      .insert(toInsert.map((itemId) => ({ item_id: itemId, status: 'YES', completed_by: userId, completed_at: nowIso, updated_at: nowIso })));
    if (e) throw new Error(e.message);
  }
  return toUpdate.length + toInsert.length;
}
