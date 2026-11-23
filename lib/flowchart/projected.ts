import type { FlowchartSeriesEdge, FlowchartTask } from './types';

// Projected dates (the blue chip on Flowchart 2, 2026-11-14).
//
// Each task keeps its planned length (calendar days, every day counted) and
// is pushed later by its links:
//   FS  starts the day after the previous task's projected end
//   SS  starts no earlier than the previous task's projected start
//   FF  ends no earlier than the previous task's projected end
//   SF  ends no earlier than the previous task's projected start
// A task starts from its Expected Start if one is entered, else its Planned
// Start; slack between tasks absorbs a delay. A real Actual Start always
// wins (it is fact), and a real Actual End fixes the end.
// Nothing here is saved — it is worked out fresh from the current dates and
// links every time the board renders.

export interface ProjectedRange {
  start: string; // 'YYYY-MM-DD'
  end: string;
  delayDays: number; // projected start − planned start (0 when on time)
  /** Not started and its start date has passed: the start it should have had
   *  (start was then moved to today). */
  missedStart?: string;
}

type ProjectableTask = { taskId?: string } & Pick<FlowchartTask, 'id' | 'plannedStartDate' | 'dueDate' | 'actualStartDate' | 'actualEndDate' | 'expectedStartDate'>;
type Edge = Pick<FlowchartSeriesEdge, 'taskId' | 'dependsOnTaskId' | 'type'> & { soft?: boolean };

const DAY_MS = 86_400_000;
const toMs = (k: string) => Date.parse(`${k}T00:00:00Z`);
const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (k: string, n: number) => toKey(toMs(k) + n * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY_MS);
const maxKey = (a: string, b: string) => (a >= b ? a : b);

export function computeProjectedDates(tasks: ProjectableTask[], edges: Edge[], today = todayKey()): Map<string, ProjectedRange> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const preds = new Map<string, Edge[]>();
  for (const e of edges) {
    if (e.soft) continue; // soft link: reference only, never pushes dates
    if (!byId.has(e.taskId) || !byId.has(e.dependsOnTaskId)) continue;
    (preds.get(e.taskId) ?? preds.set(e.taskId, []).get(e.taskId)!).push(e);
  }

  const result = new Map<string, ProjectedRange | null>();
  const visiting = new Set<string>();

  function solve(id: string): ProjectedRange | null {
    if (result.has(id)) return result.get(id)!;
    if (visiting.has(id)) return null; // circular chain — ignore the loop
    visiting.add(id);
    const t = byId.get(id)!;
    const planStart = t.plannedStartDate ?? t.dueDate;
    const planEnd = t.dueDate ?? t.plannedStartDate;
    let out: ProjectedRange | null = null;

    if (planStart && planEnd) {
      const length = Math.max(0, daysBetween(planStart, planEnd));
      if (t.actualStartDate) {
        const end = t.actualEndDate ?? addDays(t.actualStartDate, length);
        out = { start: t.actualStartDate, end, delayDays: daysBetween(planStart, t.actualStartDate) };
      } else {
        let start = t.expectedStartDate ?? planStart;
        for (const e of preds.get(id) ?? []) {
          const p = solve(e.dependsOnTaskId);
          if (!p) continue;
          if (e.type === 'SS') start = maxKey(start, p.start);
          else if (e.type === 'FF') start = maxKey(start, addDays(p.end, -length));
          else if (e.type === 'SF') start = maxKey(start, addDays(p.start, -length));
          else start = maxKey(start, addDays(p.end, 1)); // FS (default)
        }
        // A task that hasn't started can't start in the past: move it to today
        // (tomorrow it becomes tomorrow), and everything after it moves too.
        let missedStart: string | undefined;
        if (start < today) {
          missedStart = start;
          start = today;
        }
        out = { start, end: addDays(start, length), delayDays: daysBetween(planStart, start), ...(missedStart ? { missedStart } : {}) };
      }
    }

    visiting.delete(id);
    result.set(id, out);
    return out;
  }

  const final = new Map<string, ProjectedRange>();
  for (const t of tasks) {
    const r = solve(t.id);
    if (r) final.set(t.id, r);
  }
  return final;
}

// Shown on every linked Flowchart 2 task (2026-11-14) — a task with no links
// in or out would only repeat its planned dates, unless it is already late
// (not started, start date passed). Hidden on a finished task, whose real
// dates are already in the red chip.
export function shouldShowProjected(task: ProjectableTask, p: ProjectedRange | undefined, linked: boolean): p is ProjectedRange {
  return !!p && !task.actualEndDate && (linked || !!p.missedStart);
}

// "Not started" running delay — every Flowchart 2 task (2026-11-15; was a
// 4-task trial): no Actual Start and the start date has passed → the
// projected start moves to today, everything linked after it moves too, and
// the card says how many days it has been waiting.

export function todayKey(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function runningDelayDays(p: ProjectedRange | null | undefined): number {
  // Counts both ends: should have started Nov 6, today Nov 14 → 9 days.
  return p?.missedStart ? daysBetween(p.missedStart, p.start) + 1 : 0;
}
