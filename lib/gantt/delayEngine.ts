import { addWorkingDaysSync, countWorkingDaysBetween } from '../workingDays';
import type { DependencyType } from '../flowchart/types';
import type { TaskStatus } from '../statusColors';

// Ported verbatim from admin-web's lib/utils/delay-engine.ts (the shared CPM
// engine both the Gantt bars AND the Gantt detail popup read from — see
// lib/gantt/data.ts's own comment on why this is computed ONCE per screen
// load here on mobile, then just looked up for a tap, rather than
// recomputed per-tap the way admin-web's own popup does it).
//
// ── ES/EF approach ──
// A task needs two independently-computed anchors:
//   Earliest Start (ES) — driven by FS/SS predecessors:
//     FS edge A→B: B.ES ≥ A.EF + 1 working day.
//     SS edge A→B: B.ES ≥ A.ES (same day or later is fine).
//   Earliest Finish (EF) — the LATER of:
//     (a) this task's own ES + its estimated duration, and
//     (b) any FF/SF-driven lower bound from predecessors:
//     FF edge A→B: B.EF ≥ A.EF.
//     SF edge A→B: B.EF ≥ A.ES.
// FS/SS edges only ever constrain ES; FF/SF edges only ever constrain EF.

// `taskId` here must be Task.id (the UUID primary key), NOT the
// human-readable business code (Task.task_id, e.g. "1a").
export interface DelayEngineTaskInput {
  taskId: string;
  plannedStartDate: Date | null;
  dueDate: Date | null;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
  status: TaskStatus;
}

export interface DelayEngineDependency {
  taskId: string;
  dependsOnTaskId: string;
  type: DependencyType;
}

export interface TaskDelayInfo {
  taskId: string;
  projectedStart: Date;
  projectedFinish: Date;
  inheritedDelayDays: number;
  ownDelayDays: number;
  totalDelayDays: number;
  drivingPrerequisiteTaskId: string | null;
  actualStartDiscrepancyDays: number | null;
}

// Working-day OFFSET between two dates — e.g. same day = 0, next working day
// = 1. Not the same as countWorkingDaysBetween's inclusive span (1 and 2 for
// those same two cases) — every delta in this file goes through this one
// definition rather than subtracting 1 by hand inconsistently.
function workingDayGap(from: Date, to: Date, blockedDates: Set<string>): number {
  if (to <= from) return 0;
  return Math.max(0, countWorkingDaysBetween(from, to, blockedDates) - 1);
}

function pickDrivingPrerequisite(
  prereqIds: string[],
  result: Map<string, TaskDelayInfo>,
  grounded: Map<string, boolean>,
  inheritedDelayDays: number
): string | null {
  const candidates = prereqIds.filter((id) => grounded.get(id));
  if (candidates.length === 0 || inheritedDelayDays <= 0) return null;
  let driving: string | null = null;
  let latestFinish: Date | null = null;
  for (const id of candidates.sort()) {
    const finish = result.get(id)!.projectedFinish;
    if (!latestFinish || finish > latestFinish) {
      latestFinish = finish;
      driving = id;
    }
  }
  return driving;
}

// Pure function: no I/O, no internal Date.now()/new Date() — `today` is an
// explicit input, so the same four inputs always produce the same output.
export function computeProjectDelays(
  tasks: DelayEngineTaskInput[],
  dependencies: DelayEngineDependency[],
  blockedDates: Set<string>,
  today: Date
): Map<string, TaskDelayInfo> {
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

  const prereqsOf = new Map<string, { id: string; type: DependencyType }[]>();
  const dependentsOf = new Map<string, string[]>();
  for (const t of tasks) {
    prereqsOf.set(t.taskId, []);
    dependentsOf.set(t.taskId, []);
  }
  for (const d of dependencies) {
    if (!taskMap.has(d.taskId) || !taskMap.has(d.dependsOnTaskId)) continue;
    prereqsOf.get(d.taskId)!.push({ id: d.dependsOnTaskId, type: d.type });
    dependentsOf.get(d.dependsOnTaskId)!.push(d.taskId);
  }

  // ── Kahn's algorithm — deterministic tie-break via sorted queue ──
  const inDegree = new Map<string, number>();
  for (const t of tasks) inDegree.set(t.taskId, prereqsOf.get(t.taskId)!.length);

  const order: string[] = [];
  const queue = tasks.map((t) => t.taskId).filter((id) => inDegree.get(id) === 0);
  while (queue.length > 0) {
    queue.sort();
    const id = queue.shift()!;
    order.push(id);
    for (const dependent of dependentsOf.get(id)!) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  if (order.length !== tasks.length) {
    const stuck = tasks.map((t) => t.taskId).filter((id) => !order.includes(id));
    throw new Error(
      `computeProjectDelays: cycle detected in task dependency graph — ` +
      `unable to topologically sort ${stuck.length} task(s): ${stuck.join(', ')}`
    );
  }

  // Fallback anchor for a task with no plannedStartDate, no actualStartDate,
  // and no prerequisites — falls back to the earliest date found anywhere
  // in the input so the return type stays a real Date without fabricating
  // "today".
  const allKnownDates = tasks
    .flatMap((t) => [t.plannedStartDate, t.dueDate, t.actualStartDate, t.actualEndDate])
    .filter((d): d is Date => !!d);
  const projectAnchor = allKnownDates.length > 0
    ? allKnownDates.reduce((a, b) => (a < b ? a : b))
    : new Date(Date.UTC(2000, 0, 1));

  const result = new Map<string, TaskDelayInfo>();

  // A task is "grounded" if its projectedFinish traces back to at least one
  // real date on the record (its own, or transitively a grounded
  // prerequisite's). An ungrounded task's projectedFinish must NOT be
  // allowed to push a downstream task's start or be blamed as "driving" a
  // delay — otherwise a chain of never-scheduled tasks fabricates delay
  // purely from chain length.
  const grounded = new Map<string, boolean>();

  for (const taskId of order) {
    const task = taskMap.get(taskId)!;
    const prereqs = prereqsOf.get(taskId)!;
    const prereqIds = prereqs.map((p) => p.id);
    const hasOwnAnchor = !!(task.plannedStartDate || task.dueDate || task.actualStartDate || task.actualEndDate);
    grounded.set(taskId, hasOwnAnchor || prereqIds.some((p) => grounded.get(p)));

    if (task.status === 'completed') {
      // Ground truth is actualEndDate when it's been captured; falls
      // through a fallback chain of real dates rather than computing a
      // speculative projection for a task that's actually done.
      const projectedFinish = task.actualEndDate ?? task.dueDate ?? task.plannedStartDate ?? null;
      if (projectedFinish === null) {
        result.set(taskId, {
          taskId, projectedStart: projectAnchor, projectedFinish: projectAnchor,
          inheritedDelayDays: 0, ownDelayDays: 0, totalDelayDays: 0,
          drivingPrerequisiteTaskId: null, actualStartDiscrepancyDays: null,
        });
        continue;
      }
      const projectedStart = task.actualStartDate ?? task.plannedStartDate ?? projectedFinish;
      const inheritedDelayDays = task.plannedStartDate
        ? workingDayGap(task.plannedStartDate, projectedStart, blockedDates)
        : 0;
      const totalDelayDays = task.dueDate
        ? workingDayGap(task.dueDate, projectedFinish, blockedDates)
        : 0;
      result.set(taskId, {
        taskId, projectedStart, projectedFinish,
        inheritedDelayDays,
        ownDelayDays: Math.max(0, totalDelayDays - inheritedDelayDays),
        totalDelayDays,
        drivingPrerequisiteTaskId: pickDrivingPrerequisite(prereqIds, result, grounded, inheritedDelayDays),
        actualStartDiscrepancyDays: null,
      });
      continue;
    }

    // Not completed. Only grounded prerequisites contribute a pushed
    // start/finish — an ungrounded one's dates are fictitious.
    interface Candidate { value: Date; sourceId: string | null }
    const maxCandidate = (candidates: Candidate[]): Candidate =>
      candidates.reduce((best, c) => (c.value > best.value ? c : best));

    // ── Earliest Start (ES) — FS/SS predecessors only ──
    const esCandidates: Candidate[] = [];
    if (task.plannedStartDate) esCandidates.push({ value: task.plannedStartDate, sourceId: null });
    for (const p of prereqs) {
      if (!grounded.get(p.id)) continue;
      if (p.type === 'FS') {
        const dayAfterFinish = (() => {
          const f = result.get(p.id)!.projectedFinish;
          return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate() + 1));
        })();
        esCandidates.push({ value: addWorkingDaysSync(dayAfterFinish, 1, blockedDates), sourceId: p.id });
      } else if (p.type === 'SS') {
        esCandidates.push({ value: result.get(p.id)!.projectedStart, sourceId: p.id });
      }
      // FF/SF don't constrain this task's START at all.
    }
    const esWinner = esCandidates.length > 0 ? maxCandidate(esCandidates) : null;
    const earliestPossibleStart = esWinner?.value ?? null;

    let projectedStart: Date;
    let actualStartDiscrepancyDays: number | null = null;
    let esDrivingSourceId: string | null = null;

    if (task.actualStartDate) {
      projectedStart = task.actualStartDate;
      if (earliestPossibleStart) {
        const gapForward = workingDayGap(earliestPossibleStart, task.actualStartDate, blockedDates);
        const gapBackward = workingDayGap(task.actualStartDate, earliestPossibleStart, blockedDates);
        actualStartDiscrepancyDays = gapForward > 0 ? gapForward : -gapBackward;
      }
    } else if (earliestPossibleStart) {
      projectedStart = earliestPossibleStart;
      esDrivingSourceId = esWinner!.sourceId;
    } else {
      projectedStart = task.dueDate ?? projectAnchor;
    }

    const plannedDurationDays = (task.plannedStartDate && task.dueDate)
      ? countWorkingDaysBetween(task.plannedStartDate, task.dueDate, blockedDates)
      : 1;

    const selfDerivedFinish = addWorkingDaysSync(projectedStart, plannedDurationDays, blockedDates);

    // ── Earliest Finish (EF) ──
    const efCandidates: Candidate[] = [{ value: selfDerivedFinish, sourceId: null }];
    for (const p of prereqs) {
      if (!grounded.get(p.id)) continue;
      if (p.type === 'FF') {
        efCandidates.push({ value: result.get(p.id)!.projectedFinish, sourceId: p.id });
      } else if (p.type === 'SF') {
        efCandidates.push({ value: result.get(p.id)!.projectedStart, sourceId: p.id });
      }
    }
    const efWinner = maxCandidate(efCandidates);
    let projectedFinish = efWinner.value;

    // A not-yet-completed task already past its own projected finish as of
    // `today` hasn't actually finished — bump forward so "overdue and still
    // not done" shows up as delayed immediately, cascading downstream.
    if (today > projectedFinish) {
      projectedFinish = addWorkingDaysSync(today, 1, blockedDates);
    }

    const inheritedDelayDays = task.plannedStartDate
      ? workingDayGap(task.plannedStartDate, projectedStart, blockedDates)
      : 0;
    const totalDelayDays = task.dueDate
      ? workingDayGap(task.dueDate, projectedFinish, blockedDates)
      : 0;

    const drivingPrerequisiteTaskId = totalDelayDays > 0
      ? (efWinner.sourceId ?? esDrivingSourceId ?? null)
      : null;

    result.set(taskId, {
      taskId, projectedStart, projectedFinish,
      inheritedDelayDays,
      ownDelayDays: Math.max(0, totalDelayDays - inheritedDelayDays),
      totalDelayDays,
      drivingPrerequisiteTaskId,
      actualStartDiscrepancyDays,
    });
  }

  return result;
}

// Ported from admin-web's lib/data/gantt-delay.ts computeGroundedIds() — a
// task is "grounded" if it (or a prerequisite, transitively) has a real
// anchor date. A Gantt bar for an ungrounded task would be pure fiction, so
// callers must check this before drawing one.
export function computeGroundedIds(
  tasks: DelayEngineTaskInput[],
  dependencies: DelayEngineDependency[]
): Set<string> {
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));
  const prereqsOf = new Map<string, string[]>();
  const dependentsOf = new Map<string, string[]>();
  for (const t of tasks) {
    prereqsOf.set(t.taskId, []);
    dependentsOf.set(t.taskId, []);
  }
  for (const d of dependencies) {
    if (!taskMap.has(d.taskId) || !taskMap.has(d.dependsOnTaskId)) continue;
    prereqsOf.get(d.taskId)!.push(d.dependsOnTaskId);
    dependentsOf.get(d.dependsOnTaskId)!.push(d.taskId);
  }

  const inDegree = new Map<string, number>();
  for (const t of tasks) inDegree.set(t.taskId, prereqsOf.get(t.taskId)!.length);
  const order: string[] = [];
  const queue = tasks.map((t) => t.taskId).filter((id) => inDegree.get(id) === 0);
  while (queue.length > 0) {
    queue.sort();
    const id = queue.shift()!;
    order.push(id);
    for (const dependent of dependentsOf.get(id)!) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  // If this doesn't fully sort, computeProjectDelays() itself will throw
  // when it runs over the same input — no need to duplicate that check.

  const grounded = new Map<string, boolean>();
  for (const taskId of order) {
    const task = taskMap.get(taskId)!;
    const hasOwnAnchor = !!(task.plannedStartDate || task.dueDate || task.actualStartDate || task.actualEndDate);
    const prereqIds = prereqsOf.get(taskId)!;
    grounded.set(taskId, hasOwnAnchor || prereqIds.some((p) => grounded.get(p)));
  }
  return new Set([...grounded.entries()].filter(([, g]) => g).map(([id]) => id));
}
