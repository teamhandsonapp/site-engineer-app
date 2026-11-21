import type { FlowchartParallelEdge, FlowchartSeriesEdge, FlowchartTask } from './types';

// Past Tasks "Date Order" view (2026-11-20, client): the finished work in
// STACKS — one column per stack, the stack name on top, its tasks below in
// actual-date order with an arrow from each task to the next. Display only:
// nothing here is saved.
//
// - Stacks are fixed by task code (client's marked-up A3 print, 2026-11-20).
//   A task in no stack (e.g. one added later) goes in an "Other" stack last.
// - Within a stack: actual start (else actual end), then actual end, then
//   task number. Tasks with no actual date go last, in task-number order,
//   with no arrows.
// - Each stack is ONE column, one task below the other (2026-11-20, client).
// - Each stack is linked top to bottom (2026-11-20, client): drawn exactly
//   like a real link, but display-only — never saved, never push dates
//   (projected.ts skips soft links), never warn. FS / SS / FF by the actual
//   dates (2026-11-21, see stackLink).


export interface PastTaskStack {
  label: string;
  taskCodes: string[];
}

export const PAST_TASK_STACKS: PastTaskStack[] = [
  {
    label: 'Main Structure',
    taskCodes: [
      'PT-02', 'PT-06', 'PT-07', 'PT-09', 'PT-10', 'PT-12', 'PT-13', 'PT-14', 'PT-15', 'PT-16', 'PT-17', 'PT-18', 'PT-19',
      'PT-20', 'PT-21', 'PT-22', 'PT-23', 'PT-24', 'PT-25', 'PT-26', 'PT-27', 'PT-30',
    ],
  },
  { label: 'Hot Kitchen', taskCodes: ['PT-05'] },
  { label: 'West Side External', taskCodes: ['PT-03', 'PT-08', 'PT-11'] },
  { label: 'Curved Wall @ North', taskCodes: ['PT-01', 'PT-04'] },
];
const OTHER_STACK = 'Other';

// Stored-grid spacing. layout.ts turns every distinct x / y into its own
// column / row (70px clustering). COL_STEP matches the Flowchart 2 grid
// (card 205 + gap 26) so the Current Status copy below lines up with it.
const COL_STEP = 231;
const ROW_STEP = 200;

const byTaskNumber = (a: FlowchartTask, b: FlowchartTask) => a.taskId.localeCompare(b.taskId, undefined, { numeric: true });
const actualStart = (t: FlowchartTask) => t.actualStartDate ?? t.actualEndDate ?? null;
const actualEnd = (t: FlowchartTask) => t.actualEndDate ?? t.actualStartDate ?? null;

function byActualDate(a: FlowchartTask, b: FlowchartTask): number {
  const sa = actualStart(a), sb = actualStart(b);
  if (sa !== sb) return sa === null ? 1 : sb === null ? -1 : sa.localeCompare(sb);
  const ea = actualEnd(a), eb = actualEnd(b);
  if (ea !== eb) return ea === null ? 1 : eb === null ? -1 : ea.localeCompare(eb);
  return byTaskNumber(a, b);
}

// The link into stack[k] (2026-11-21, client): its type follows the actual
// dates, so tasks that ran at the same time aren't drawn as one-after-another.
// - Same start as the task above → SS (identical dates = parallel, also SS).
// - Same finish as the task above → FF.
// - Started while the task above was still running → SS.
// - Otherwise (it started after the task above finished) → FS.
export function stackLink(stack: FlowchartTask[], k: number): { from: FlowchartTask; type: 'FS' | 'SS' | 'FF' } | null {
  const above = stack[k - 1];
  if (!above) return null;
  // Always from the card right above: a same-column link is drawn straight
  // (behind any card in between), so a link skipping cards would look wrong.
  const type = linkTypeByDates(above, stack[k]);
  return type ? { from: above, type } : null;
}

/** FS / SS / FF from two tasks' actual dates (see stackLink); null when either hasn't started. */
export function linkTypeByDates(from: FlowchartTask, to: FlowchartTask): 'FS' | 'SS' | 'FF' | null {
  const sT = actualStart(to), eT = actualEnd(to);
  const sA = actualStart(from), eA = actualEnd(from);
  if (sT === null || sA === null) return null;
  if (sT === sA) return 'SS';
  if (eT !== null && eT === eA) return 'FF';
  if (eA !== null && sT < eA) return 'SS';
  return 'FS';
}

export function buildDateOrderBoard(tasks: FlowchartTask[]): { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[] } {
  const stackOf = new Map<string, string>();
  for (const s of PAST_TASK_STACKS) for (const code of s.taskCodes) stackOf.set(code, s.label);
  const labels = [...PAST_TASK_STACKS.map((s) => s.label), OTHER_STACK];

  const out: FlowchartTask[] = [];
  const edges: FlowchartSeriesEdge[] = [];
  let col = 0;
  for (const label of labels) {
    const stack = tasks.filter((t) => (stackOf.get(t.taskId.trim()) ?? OTHER_STACK) === label).sort(byActualDate);
    if (stack.length === 0) continue;
    // One copy per task, so cards keep their real id (tap opens the real task).
    stack.forEach((t, i) =>
      out.push({
        ...t,
        manualPositionX: col * COL_STEP,
        manualPositionY: i * ROW_STEP,
        sectionTitle: i === 0 ? label : null,
        dividerBelow: false,
      })
    );
    for (let i = 0; i + 1 < stack.length; i++) {
      const link = stackLink(stack, i + 1);
      if (!link) continue;
      edges.push({
        id: `order:actual:${link.from.id}>${stack[i + 1].id}`,
        dependsOnTaskId: link.from.id,
        taskId: stack[i + 1].id,
        type: link.type,
        soft: true,
        drawAsLink: true,
      });
    }
    col++;
  }
  return { tasks: out, edges };
}

// Past Tasks (2026-11-20, client): a view-only COPY of the Current Status
// board drawn below the stacks — same layout and its own links, nothing
// linked to the stacks, nothing moved or saved. A stored gap of 1500+ is a
// section break (layout.ts), so the two parts stay visibly apart.
export const BELOW_GAP = 1600;

export function appendBoardBelow(
  above: { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[] },
  board: { tasks: FlowchartTask[]; seriesEdges: FlowchartSeriesEdge[]; parallelEdges: FlowchartParallelEdge[] } | null
): { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[]; parallelEdges: FlowchartParallelEdge[] } {
  if (!board || board.tasks.length === 0) return { ...above, parallelEdges: [] };
  const taken = new Set(above.tasks.map((t) => t.id));
  const copy = swapStacks(board.tasks.filter((t) => !taken.has(t.id)), PAST_COPY_STACK_ORDER);
  const ids = new Set(copy.map((t) => t.id));
  const placed = copy.filter((t) => t.manualPositionX != null && t.manualPositionY != null);
  const minX = placed.length ? Math.min(...placed.map((t) => t.manualPositionX!)) : 0;
  const minY = placed.length ? Math.min(...placed.map((t) => t.manualPositionY!)) : 0;
  const bottom = above.tasks.length ? Math.max(...above.tasks.map((t) => t.manualPositionY ?? 0)) : -BELOW_GAP;
  const top = bottom + BELOW_GAP;
  const moved = copy.map((t) =>
    t.manualPositionX != null && t.manualPositionY != null
      ? { ...t, manualPositionX: t.manualPositionX - minX, manualPositionY: t.manualPositionY - minY + top }
      : t
  );
  return {
    tasks: [...above.tasks, ...moved],
    edges: [
      ...above.edges,
      ...board.seriesEdges.filter((e) => ids.has(e.taskId) && ids.has(e.dependsOnTaskId)),
      ...bridgeEdge(above.tasks, moved),
    ],
    parallelEdges: board.parallelEdges.filter((e) => ids.has(e.taskAId) && ids.has(e.taskBId)),
  };
}

// Past Tasks → Current Status (2026-11-21, client): the last task of the
// Main Structure stack (PT-30) links to the first task of the copy below
// (the head of its first stack, Walls / Mezzanine → CIV-07). Finish-to-Start:
// the Current Status work follows the finished Past Tasks. A real link (not
// soft), so projected dates flow through it; its planned-date check is off,
// as the old planned dates overlap (CIV-07 Sep 17 vs PT-30 Sep 19–27).
// On this board only — nothing is saved, Current Status has no such link.
export const BRIDGE_FROM_STACK = 'Main Structure';
function bridgeEdge(stacks: FlowchartTask[], copy: FlowchartTask[]): FlowchartSeriesEdge[] {
  const head = stacks.find((t) => t.sectionTitle === BRIDGE_FROM_STACK);
  const from = head ? stacks.filter((t) => t.manualPositionX === head.manualPositionX).sort((a, b) => b.manualPositionY! - a.manualPositionY!)[0] : undefined;
  const to = copy.find((t) => norm(t.sectionTitle) === norm(PAST_COPY_STACK_ORDER[0]));
  if (!from || !to) return [];
  return [{ id: `bridge:${from.id}>${to.id}`, dependsOnTaskId: from.id, taskId: to.id, type: 'FS', noWarning: true }];
}

// Past Tasks copy only (2026-11-20, client): these four stacks of the
// Current Status board trade places, left to right, in this order. Every
// other stack (Lift shaft …) keeps its place; Current Status is unchanged.
// Links are by task id, so they all stay exactly as they were.
export const PAST_COPY_STACK_ORDER = ['Walls / Mezzanine', 'Wall No. 4', 'Casting / Columns', 'Hot Kitchen'];

// Same column = within layout.ts's 70px clustering.
const SAME_COLUMN = 70;
// A stack ends at the next heading, a divider, or a gap this big (a separate group below).
const STACK_BREAK_GAP = 600;

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// A stack = its heading card plus the cards below it in the same column.
function stackMembers(tasks: FlowchartTask[], head: FlowchartTask): FlowchartTask[] {
  const column = tasks
    .filter((t) => t.manualPositionX != null && t.manualPositionY != null && Math.abs(t.manualPositionX - head.manualPositionX!) <= SAME_COLUMN && t.manualPositionY >= head.manualPositionY!)
    .sort((a, b) => a.manualPositionY! - b.manualPositionY!);
  const out = [head];
  for (const t of column) {
    if (t.id === head.id) continue;
    const prev = out[out.length - 1];
    if (t.sectionTitle || prev.dividerBelow || t.manualPositionY! - prev.manualPositionY! > STACK_BREAK_GAP) break;
    out.push(t);
  }
  return out;
}

export function swapStacks(tasks: FlowchartTask[], order: string[]): FlowchartTask[] {
  const heads = order.map((label) =>
    tasks.find((t) => norm(t.sectionTitle) === norm(label) && t.manualPositionX != null && t.manualPositionY != null)
  );
  if (heads.some((h) => !h)) return tasks; // a stack is missing or renamed: leave the board as it is
  const stacks = heads.map((h) => stackMembers(tasks, h!));
  // The columns these stacks use now, left to right; stack i moves to slot i.
  const slots = heads.map((h) => h!.manualPositionX!).sort((a, b) => a - b);
  const shift = new Map<string, number>();
  stacks.forEach((members, i) => members.forEach((t) => shift.set(t.id, slots[i] - heads[i]!.manualPositionX!)));
  return tasks.map((t) => (shift.has(t.id) ? { ...t, manualPositionX: t.manualPositionX! + shift.get(t.id)! } : t));
}
