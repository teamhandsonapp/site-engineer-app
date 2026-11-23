// Completed Tasks report filters (2026-11-23, client): a From – To date range
// ("select certain date to date and generate report") and "show only
// Pre-construction delay" / "show only Construction delay". Pure — no
// Supabase / React Native imports.
import { EMPTY_CHECKLIST_NOTES } from './checklistNotes';
import { fmtDay } from './milestoneReport';
import type { SheetReportRow } from './sheetReport';

/** Which dates a task is matched on: when the work was actually done, or when it was planned. */
export type RangeBy = 'actual' | 'planned';
/** Only one stage's delays in the report (null = both). */
export type StageOnly = 'pre' | 'con' | null;

export const STAGE_ONLY_LABEL: Record<'pre' | 'con', string> = {
  pre: 'Pre-construction',
  con: 'Construction',
};

const day = (k: string | null | undefined) => (k ? k.slice(0, 10) : null);

/**
 * The task is in the range when any day of it falls between From and To
 * (both days included). Either end may be left empty (open range). A task with
 * no dates of that kind is left out.
 */
export function inDateRange(
  r: Pick<SheetReportRow, 'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd'>,
  from: string | null,
  to: string | null,
  by: RangeBy
): boolean {
  const a = day(by === 'actual' ? r.actualStart : r.plannedStart);
  const b = day(by === 'actual' ? r.actualEnd : r.plannedEnd);
  const start = a ?? b;
  const end = b ?? a;
  if (!start || !end) return false;
  return (!to || start <= to) && (!from || end >= from);
}

/** "1 Aug 2026 – 31 Aug 2026 (actual dates)", "From 1 Aug 2026 …", "Up to 31 Aug 2026 …". */
export function dateRangeLabel(from: string | null, to: string | null, by: RangeBy): string {
  const span = from && to ? `${fmtDay(from)} – ${fmtDay(to)}` : from ? `From ${fmtDay(from)}` : `Up to ${fmtDay(to)}`;
  return `${span} (${by} dates)`;
}

/** The row with the other stage's delays emptied, so only one stage is reported. */
export function onlyStage<R extends Pick<SheetReportRow, 'notes' | 'constructionNotes'>>(r: R, stage: StageOnly): R {
  if (stage === 'pre') return r.constructionNotes ? { ...r, constructionNotes: EMPTY_CHECKLIST_NOTES } : r;
  if (stage === 'con') return { ...r, notes: EMPTY_CHECKLIST_NOTES };
  return r;
}
