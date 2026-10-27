import type { TaskReportData } from '../reports/taskReport';

// TEMP DEBUG - REMOVE BEFORE CLIENT DELIVERY. Gated entirely behind
// SHOW_DEBUG_PARAM_CHECK below — flip to false first if you want to keep
// this code around a bit longer without deleting it. To remove for real:
// delete this file, components/reports/DebugParamCheckPanel.tsx, and the
// one <DebugParamCheckPanel> usage + its two imports in each of
// app/reports/{task,weekly,monthly}-report.tsx.
export const SHOW_DEBUG_PARAM_CHECK = true;

export interface ParamCheckResult {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

// Reads ONLY the already-fetched `report` object the real Task Report
// screen renders below this panel — no second query, per its own
// requirement. Every value shown here is the literal same value (or a
// value trivially derived from it, e.g. % complete) the report already
// has in memory.
export function computeTaskReportParamCheck(report: TaskReportData): ParamCheckResult[] {
  const q = report.quantity;
  const results: ParamCheckResult[] = [];

  results.push({
    key: 'taskName',
    label: 'Task name',
    ok: report.task.taskName.trim().length > 0,
    detail: report.task.taskName || 'No data found',
  });

  results.push({
    key: 'unit',
    label: 'Unit of measure',
    ok: q?.unit != null,
    detail: q?.unit ?? 'No data found',
  });

  results.push({
    key: 'plannedQuantity',
    label: 'Planned quantity',
    ok: q != null, // quantity is only ever non-null once a real "Targeted Quantity" row exists
    detail: q != null ? String(q.targeted) : 'No data found',
  });

  results.push({
    key: 'completedQuantity',
    label: 'Completed quantity',
    ok: q != null && q.hasDone, // NOT just `q.done != null` — done defaults to 0 when never entered
    detail: q != null && q.hasDone ? String(q.done) : 'No data found',
  });

  results.push({
    key: 'remainingQuantity',
    label: 'Remaining quantity',
    // This screen's "remaining" is the separately-entered "Pending
    // Quantity" checklist row (matches the real chart below, which reads
    // report.quantity.pending directly) — NOT targeted-minus-done.
    ok: q != null && q.hasPending,
    detail: q != null && q.hasPending ? String(q.pending) : 'No data found',
  });

  {
    const pct = q != null && q.targeted > 0 ? Math.round((q.done / q.targeted) * 1000) / 10 : null;
    results.push({
      key: 'percentComplete',
      label: '% complete (by quantity)',
      ok: pct != null,
      detail: pct != null ? `${pct}%` : 'No data found',
    });
  }

  results.push({
    key: 'checklistTotal',
    label: 'Checklist items — total count',
    ok: report.completion != null,
    detail: report.completion != null ? String(report.completion.total) : 'No data found',
  });
  results.push({
    key: 'checklistCompleted',
    label: 'Checklist items — completed count',
    ok: report.completion != null,
    detail: report.completion != null ? String(report.completion.done) : 'No data found',
  });
  results.push({
    key: 'checklistPending',
    label: 'Checklist items — pending count',
    ok: report.completion != null,
    detail: report.completion != null ? String(report.completion.total - report.completion.done) : 'No data found',
  });

  // Fixed 2026-08-17 — was "not fetched by this screen" (a real code gap);
  // fetchTaskReport() now resolves assigned_to to a name. Still commonly
  // red in practice: a real DB check found 0/311 tasks system-wide have
  // assigned_to set at all today — that's a genuine data gap, not this code.
  results.push({
    key: 'assignedEngineer',
    label: 'Assigned engineer',
    ok: report.assignedEngineerName != null,
    detail: report.assignedEngineerName ?? 'No data found',
  });

  // Fixed 2026-08-17 — was "not fetched"; fetchTaskReport() now queries
  // task_dependencies in both directions. 243 real rows exist system-wide,
  // so this is expected to genuinely go green for tasks that have links.
  {
    const refs = [...report.dependencies.blockedBy, ...report.dependencies.blocking];
    results.push({
      key: 'dependencies',
      label: 'Dependencies (blocked by / blocking)',
      ok: refs.length > 0,
      detail: refs.length > 0 ? refs.map((r) => r.taskCode).join(', ') : 'No data found',
    });
  }

  results.push({
    key: 'dueDate',
    label: 'Due date',
    ok: report.delay.plannedEnd != null,
    detail: report.delay.plannedEnd ?? 'No data found',
  });

  {
    // No status enum is fetched on this screen (unlike admin-web's
    // dueDate<today && status!=='completed' rule) — closest real
    // equivalent from what IS fetched: past due AND the checklist isn't
    // fully resolved yet.
    const dueDate = report.delay.plannedEnd ? new Date(report.delay.plannedEnd) : null;
    const isOverdue = !!(dueDate && dueDate.getTime() < Date.now() && report.completion && report.completion.done < report.completion.total);
    results.push({ key: 'overdueStatus', label: 'Overdue status', ok: true, detail: isOverdue ? 'Overdue' : 'On track' });
  }

  return results;
}
