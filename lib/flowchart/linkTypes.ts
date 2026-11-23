// The 4 Flowchart link (dependency) types — one place for their line style,
// wording, and the checks around them. A = predecessor (where the arrow
// starts, task_dependencies.depends_on_task_id), B = successor (where the
// arrow ends, task_dependencies.task_id).

import type { DependencyType, FlowchartSeriesEdge, FlowchartTask } from './types';

export const LINK_TYPE_ORDER: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

// Line styles: FS solid · SS double · FF dotted · SF dashed. One colour so
// the STYLE is what tells them apart (plus the label chip).
export const LINK_COLOR = '#D97706';
export const LINK_WARNING_COLOR = '#DC2626';
export const LINK_STYLE: Record<DependencyType, { dash?: string; double?: boolean; cap?: 'round' | 'butt' }> = {
  FS: {},
  SS: { double: true },
  FF: { dash: '0.1,5', cap: 'round' },
  SF: { dash: '9,5' },
};

export const LINK_INFO: Record<DependencyType, { name: string; meaning: string; short: string }> = {
  FS: { name: 'Finish to Start', meaning: 'B starts only after A finishes', short: 'Next one starts after this finishes' },
  SS: { name: 'Start to Start', meaning: 'B starts when A starts (in parallel)', short: 'Both start together' },
  FF: { name: 'Finish to Finish', meaning: 'B finishes when A finishes', short: 'Both finish together' },
  SF: { name: 'Start to Finish', meaning: "B can't finish until A starts", short: "Next one can't finish until this starts" },
};

/** Plain-English sentence with the real task names. */
export function explainLink(type: DependencyType, a: string, b: string): string {
  switch (type) {
    case 'FS':
      return `${b} starts after ${a} finishes`;
    case 'SS':
      return `${b} starts when ${a} starts`;
    case 'FF':
      return `${b} finishes when ${a} finishes`;
    case 'SF':
      return `${b} can't finish until ${a} starts`;
  }
}

/** Why a new A -> B link can't be made, or null when it's fine. */
export function linkProblem(edges: FlowchartSeriesEdge[], source: string, target: string, ignoreEdgeId?: string): string | null {
  if (source === target) return "A task can't be linked to itself.";
  const live = edges.filter((e) => e.id !== ignoreEdgeId);
  if (live.some((e) => (e.dependsOnTaskId === source && e.taskId === target) || (e.dependsOnTaskId === target && e.taskId === source))) {
    return 'These two tasks are already linked. Tap the link label to change its type instead.';
  }
  // Circular: B -> … -> A already exists (following arrows forward from B).
  const next = new Map<string, string[]>();
  for (const e of live) next.set(e.dependsOnTaskId, [...(next.get(e.dependsOnTaskId) ?? []), e.taskId]);
  const seen = new Set<string>([target]);
  const queue = [target];
  while (queue.length) {
    const id = queue.shift() as string;
    if (id === source) return 'This would make a loop (A → B → … → A). Links must always flow one way.';
    for (const n of next.get(id) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return null;
}

const start = (t: FlowchartTask) => t.currentPlannedStartDate ?? t.plannedStartDate;
const end = (t: FlowchartTask) => t.currentDueDate ?? t.dueDate;
const fmt = (d: string) => {
  const [, m, day] = d.split('-').map(Number);
  return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
};

/** When the planned dates break the link, a plain-English explanation; else null. Dates are never changed. */
export function linkDateWarning(type: DependencyType, a: FlowchartTask, b: FlowchartTask): string | null {
  const aS = start(a), aE = end(a), bS = start(b), bE = end(b);
  switch (type) {
    case 'FS':
      return aE && bS && bS < aE ? `${b.taskName} is planned to start on ${fmt(bS)}, before ${a.taskName} finishes on ${fmt(aE)}.` : null;
    case 'SS':
      return aS && bS && bS < aS ? `${b.taskName} is planned to start on ${fmt(bS)}, before ${a.taskName} starts on ${fmt(aS)}.` : null;
    case 'FF':
      return aE && bE && bE < aE ? `${b.taskName} is planned to finish on ${fmt(bE)}, before ${a.taskName} finishes on ${fmt(aE)}.` : null;
    case 'SF':
      return aS && bE && bE < aS ? `${b.taskName} is planned to finish on ${fmt(bE)}, before ${a.taskName} starts on ${fmt(aS)}.` : null;
  }
}
