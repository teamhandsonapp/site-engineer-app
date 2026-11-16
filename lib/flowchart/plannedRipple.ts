import { addDays, daysBetween } from './projected';
import type { DependencyType } from './types';

// Planned dates follow the links (Flowchart 2, client request 2026-11-15).
// After a link type changes, the task it points to and every task after it
// get new PLANNED dates worked out from the planned dates of the tasks linked
// before them (actuals and delays are ignored; that's the blue projected chip):
//   FS  starts the day after the previous task's planned end
//   SS  starts the same day as the previous task's planned start
//   FF  ends the same day as the previous task's planned end
//   SF  ends the same day as the previous task's planned start
// The latest of these wins; each task keeps its own number of days. A task
// with no planned dates, or nothing dated linked before it, is left as is.

interface PlanTask { id: string; plannedStartDate: string | null; dueDate: string | null }
interface PlanEdge { taskId: string; dependsOnTaskId: string; type: DependencyType; soft?: boolean }

/** New planned dates for `fromId` and everything after it — only the tasks that actually change. */
export function ripplePlannedDates(tasks: PlanTask[], edges: PlanEdge[], fromId: string): Map<string, { start: string; end: string }> {
  const live = edges.filter((e) => !e.soft);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const preds = new Map<string, PlanEdge[]>();
  const next = new Map<string, string[]>();
  for (const e of live) {
    preds.set(e.taskId, [...(preds.get(e.taskId) ?? []), e]);
    next.set(e.dependsOnTaskId, [...(next.get(e.dependsOnTaskId) ?? []), e.taskId]);
  }
  // Everything reachable from fromId (including itself).
  const affected = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) for (const n of next.get(queue.shift() as string) ?? []) if (!affected.has(n)) { affected.add(n); queue.push(n); }

  const memo = new Map<string, { start: string; end: string } | null>();
  const visiting = new Set<string>();
  const dates = (id: string): { start: string; end: string } | null => {
    if (memo.has(id)) return memo.get(id) ?? null;
    const t = byId.get(id);
    const own = t?.plannedStartDate && t.dueDate ? { start: t.plannedStartDate, end: t.dueDate } : null;
    if (!affected.has(id) || !own || visiting.has(id)) return own;
    visiting.add(id);
    const len = daysBetween(own.start, own.end);
    let start: string | null = null;
    for (const e of preds.get(id) ?? []) {
      const p = dates(e.dependsOnTaskId);
      if (!p) continue;
      const s = e.type === 'SS' ? p.start : e.type === 'FF' ? addDays(p.end, -len) : e.type === 'SF' ? addDays(p.start, -len) : addDays(p.end, 1);
      if (!start || s > start) start = s;
    }
    visiting.delete(id);
    const out = start ? { start, end: addDays(start, len) } : own;
    memo.set(id, out);
    return out;
  };

  const changed = new Map<string, { start: string; end: string }>();
  for (const id of affected) {
    const t = byId.get(id);
    const d = dates(id);
    if (t && d && (d.start !== t.plannedStartDate || d.end !== t.dueDate)) changed.set(id, d);
  }
  return changed;
}
