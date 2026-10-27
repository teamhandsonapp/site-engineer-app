import type { RangeTaskRow } from '../reports/rangeTaskReport';
import type { ParamCheckResult } from './taskReportParamCheck';

// TEMP DEBUG - REMOVE BEFORE CLIENT DELIVERY. Same flag/removal instructions
// as taskReportParamCheck.ts's own header comment — this file, its sibling
// component components/reports/RangeDebugPanel.tsx, and the one usage in
// each of Weekly/Monthly/Custom-Range Report screens all go together.
export { SHOW_DEBUG_PARAM_CHECK } from './taskReportParamCheck';

export interface TaskParamCheck {
  id: string;
  taskCode: string;
  taskName: string;
  results: ParamCheckResult[];
  okCount: number;
  total: number;
  allOk: boolean;
}

// Pure, synchronous, and reads ONLY the already-fetched RangeTaskRow — same
// "no second query" rule as the single-task version, just operating on a
// row already in memory instead of an async report object. Same 13
// parameters, same real-vs-fallback distinction on quantity fields, same
// honest "no data found" rather than a fabricated value.
export function computeRowParamCheck(row: RangeTaskRow): TaskParamCheck {
  const results: ParamCheckResult[] = [];

  results.push({ key: 'taskName', label: 'Task name', ok: row.taskName.trim().length > 0, detail: row.taskName || 'No data found' });
  results.push({ key: 'unit', label: 'Unit of measure', ok: row.unit != null, detail: row.unit ?? 'No data found' });
  results.push({ key: 'plannedQuantity', label: 'Planned quantity', ok: row.plannedQuantity != null, detail: row.plannedQuantity != null ? String(row.plannedQuantity) : 'No data found' });
  results.push({ key: 'completedQuantity', label: 'Completed quantity', ok: row.completedQuantity != null, detail: row.completedQuantity != null ? String(row.completedQuantity) : 'No data found' });
  results.push({ key: 'remainingQuantity', label: 'Remaining quantity', ok: row.remainingQuantity != null, detail: row.remainingQuantity != null ? String(row.remainingQuantity) : 'No data found' });
  results.push({ key: 'percentComplete', label: '% complete (by quantity)', ok: row.percentCompleteByQuantity != null, detail: row.percentCompleteByQuantity != null ? `${row.percentCompleteByQuantity}%` : 'No data found' });
  results.push({ key: 'checklistTotal', label: 'Checklist items — total count', ok: true, detail: String(row.checklistTotal) });
  results.push({ key: 'checklistCompleted', label: 'Checklist items — completed count', ok: true, detail: String(row.checklistDone) });
  results.push({ key: 'checklistPending', label: 'Checklist items — pending count', ok: true, detail: String(row.checklistPending) });
  results.push({ key: 'assignedEngineer', label: 'Assigned engineer', ok: row.assignedEngineerName != null, detail: row.assignedEngineerName ?? 'No data found' });
  {
    const refs = [...row.blockedBy, ...row.blocking];
    results.push({ key: 'dependencies', label: 'Dependencies (blocked by / blocking)', ok: refs.length > 0, detail: refs.length > 0 ? refs.map((r) => r.taskCode).join(', ') : 'No data found' });
  }
  results.push({ key: 'dueDate', label: 'Due date', ok: row.dueDate != null, detail: row.dueDate ?? 'No data found' });
  results.push({ key: 'overdueStatus', label: 'Overdue status', ok: true, detail: row.isOverdue ? 'Overdue' : 'On track' });

  const okCount = results.filter((r) => r.ok).length;
  return { id: row.id, taskCode: row.taskCode, taskName: row.taskName, results, okCount, total: results.length, allOk: okCount === results.length };
}

export function computeRangeParamCheck(rows: RangeTaskRow[]): { perTask: TaskParamCheck[]; tasksComplete: number; tasksTotal: number } {
  const perTask = rows.map(computeRowParamCheck);
  return { perTask, tasksComplete: perTask.filter((t) => t.allOk).length, tasksTotal: perTask.length };
}
