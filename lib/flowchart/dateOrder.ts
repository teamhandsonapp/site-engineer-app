import type { FlowchartSeriesEdge, FlowchartTask } from './types';

// Past Tasks "Date Order" view (2026-11-20, client): every task shown twice,
// side by side — LEFT in planned-date order, RIGHT in actual-date order —
// with an arrow from each date to the next, so the two sequences can be
// compared. Display only: nothing here is saved.
//
// - Left uses planned dates ONLY (planned start, else planned end). It never
//   falls back to actual dates; tasks with no planned date sit in a
//   "No planned dates" group at the bottom, in task-number order, no arrows.
// - Right uses actual dates only (actual start, else actual end), same rule.
// - Tasks starting the same day share a row (no arrow between them — neither
//   came first), ordered by their end date, then task number.
// - Arrows are soft links: drawn only, never push dates (projected.ts skips
//   soft links) and never warn. They mean "next by date", not "depends on".

export const PLANNED_ORDER_COLOR = '#D97706';
export const ACTUAL_ORDER_COLOR = '#DC2626';

// Right-hand copies need their own id (the canvas keys cards and links by id).
const ACTUAL_COPY_SUFFIX = '~actual';

// Stored-grid spacing. layout.ts turns every distinct x / y into its own
// column / row (so the exact steps don't matter beyond its 70px clustering),
// and draws a stored gap of 1500+ as a wider section break — used between
// the two sides.
const COL_STEP = 300;
const ROW_STEP = 200;
const SIDE_GAP = 1500;
// Columns for an undated group when no same-day row is wider.
const UNDATED_COLS = 3;

type DateOf = (t: FlowchartTask) => string | null;

const byTaskNumber = (a: FlowchartTask, b: FlowchartTask) => a.taskId.localeCompare(b.taskId, undefined, { numeric: true });

interface SideOrder {
  rows: FlowchartTask[][];
  undated: FlowchartTask[];
}

export function orderByDate(tasks: FlowchartTask[], startOf: DateOf, endOf: DateOf): SideOrder {
  const byStart = new Map<string, FlowchartTask[]>();
  const undated: FlowchartTask[] = [];
  for (const t of tasks) {
    const key = startOf(t);
    if (key === null) undated.push(t);
    else byStart.set(key, [...(byStart.get(key) ?? []), t]);
  }
  const rows = [...byStart.keys()].sort().map((key) =>
    byStart.get(key)!.sort((a, b) => {
      const ea = endOf(a);
      const eb = endOf(b);
      if (ea !== eb) return ea === null ? 1 : eb === null ? -1 : ea.localeCompare(eb);
      return byTaskNumber(a, b);
    })
  );
  return { rows, undated: undated.sort(byTaskNumber) };
}

const plannedStart: DateOf = (t) => t.plannedStartDate ?? t.dueDate ?? null;
const plannedEnd: DateOf = (t) => t.dueDate ?? t.plannedStartDate ?? null;
const actualStart: DateOf = (t) => t.actualStartDate ?? t.actualEndDate ?? null;
const actualEnd: DateOf = (t) => t.actualEndDate ?? t.actualStartDate ?? null;

function placeSide(
  order: SideOrder,
  x0: number,
  idOf: (t: FlowchartTask) => string,
  titles: { dated: string; undated: string },
  side: 'planned' | 'actual',
  color: string
): { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[]; cols: number } {
  const widest = Math.max(0, ...order.rows.map((r) => r.length));
  const cols = Math.max(1, widest, Math.min(UNDATED_COLS, order.undated.length));
  const out: FlowchartTask[] = [];
  const place = (t: FlowchartTask, row: number, col: number, sectionTitle: string | null) =>
    out.push({
      ...t,
      id: idOf(t),
      manualPositionX: x0 + col * COL_STEP,
      manualPositionY: row * ROW_STEP,
      sectionTitle,
      dividerBelow: false,
    });

  order.rows.forEach((row, r) => row.forEach((t, c) => place(t, r, c, r === 0 && c === 0 ? titles.dated : null)));
  // One empty row between the dated rows and the undated group.
  const firstUndatedRow = order.rows.length === 0 ? 0 : order.rows.length + 1;
  order.undated.forEach((t, i) =>
    place(t, firstUndatedRow + Math.floor(i / cols), i % cols, i === 0 ? titles.undated : null)
  );

  const edges: FlowchartSeriesEdge[] = [];
  for (let r = 0; r + 1 < order.rows.length; r++) {
    for (const from of order.rows[r]) {
      for (const to of order.rows[r + 1]) {
        edges.push({
          id: `order:${side}:${idOf(from)}>${idOf(to)}`,
          dependsOnTaskId: idOf(from),
          taskId: idOf(to),
          type: 'FS',
          soft: true,
          color,
          hideLabel: true,
        });
      }
    }
  }
  return { tasks: out, edges, cols };
}

export function buildDateOrderBoard(tasks: FlowchartTask[]): { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[] } {
  const left = placeSide(
    orderByDate(tasks, plannedStart, plannedEnd),
    0,
    (t) => t.id,
    { dated: 'By planned start date', undated: 'No planned dates' },
    'planned',
    PLANNED_ORDER_COLOR
  );
  const right = placeSide(
    orderByDate(tasks, actualStart, actualEnd),
    (left.cols - 1) * COL_STEP + SIDE_GAP,
    (t) => `${t.id}${ACTUAL_COPY_SUFFIX}`,
    { dated: 'By actual start date', undated: 'No actual dates' },
    'actual',
    ACTUAL_ORDER_COLOR
  );
  return { tasks: [...left.tasks, ...right.tasks], edges: [...left.edges, ...right.edges] };
}
