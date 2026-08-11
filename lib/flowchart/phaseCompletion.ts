import type { FlowchartSeriesEdge, FlowchartTask } from './types';

// Exact port of admin-web's TaskDependencyGraph.tsx (taskIdColumnNumber /
// PHASE_BOUNDARY_COLUMNS / PHASE_SECTIONS / phaseCompletions) — keep these
// two files' phase boundaries in sync if either changes. This project's
// 311 real tasks are all under a single Work (CIVIL); this phase split is
// entirely by taskId's own leading number, not by Work — "Civil" covers
// every task up to column 11, "Structure Internal Works" starts at 12.
function taskIdColumnNumber(taskId: string | null | undefined): number {
  const match = taskId?.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : Infinity;
}

interface PhaseSection {
  label: string;
  minCol: number;
  maxCol: number;
}

const PHASE_BOUNDARY_COLUMNS: { label: string; afterColumnNumber: number }[] = [
  { label: 'Structure Internal Works', afterColumnNumber: 11 },
];

const PHASE_SECTIONS: PhaseSection[] = [
  { label: 'Civil', minCol: -Infinity, maxCol: PHASE_BOUNDARY_COLUMNS[0]?.afterColumnNumber ?? Infinity },
  ...PHASE_BOUNDARY_COLUMNS.map((heading, i) => ({
    label: heading.label,
    minCol: heading.afterColumnNumber + 1,
    maxCol: PHASE_BOUNDARY_COLUMNS[i + 1]?.afterColumnNumber ?? Infinity,
  })),
];

export interface PhaseCompletion {
  label: string;
  plannedCompletion: string | null;
  projectedCompletion: string;
  isDelayed: boolean;
  lastTaskName: string | null;
}

// For each phase (a taskId column range), finds its "leaf" tasks — nothing
// within the same phase depends on them via an FS link — and takes
// whichever leaf's own projected completion (actualEndDate ?? currentDueDate
// ?? dueDate) is LATEST. That's the phase's expected completion: a plain
// fact ("here's when the last task in this phase is due"), not a CPM
// projection — moves on its own the moment a new last task is added
// further down the sequence. Falls back to every section task (not just
// leaves) only if none qualify, so this never ends up with zero candidates
// for a phase that genuinely has tasks.
export function computePhaseCompletions(tasks: FlowchartTask[], seriesEdges: FlowchartSeriesEdge[]): PhaseCompletion[] {
  const hasFsDependent = new Set(
    seriesEdges.filter((e) => e.type === 'FS').map((e) => e.dependsOnTaskId)
  );

  const result: PhaseCompletion[] = [];
  for (const section of PHASE_SECTIONS) {
    const sectionTasks = tasks.filter((t) => {
      const col = taskIdColumnNumber(t.taskId);
      return col >= section.minCol && col <= section.maxCol;
    });
    if (sectionTasks.length === 0) continue;

    const leafTasks = sectionTasks.filter((t) => !hasFsDependent.has(t.id));
    const candidates = leafTasks.length > 0 ? leafTasks : sectionTasks;

    let best: { plannedCompletion: string | null; projectedCompletion: string; taskName: string } | null = null;
    for (const t of candidates) {
      const projectedCompletion = t.actualEndDate ?? t.currentDueDate ?? t.dueDate;
      if (!projectedCompletion) continue;
      if (!best || projectedCompletion > best.projectedCompletion) {
        best = { plannedCompletion: t.dueDate, projectedCompletion, taskName: t.taskName };
      }
    }
    if (!best) continue;

    result.push({
      label: section.label,
      plannedCompletion: best.plannedCompletion,
      projectedCompletion: best.projectedCompletion,
      isDelayed: !!(best.plannedCompletion && best.projectedCompletion > best.plannedCompletion),
      lastTaskName: best.taskName,
    });
  }
  return result;
}
