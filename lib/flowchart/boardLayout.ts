// Move & link on the worked-out boards (2026-11-22, client): Past Tasks and
// Past Tasks Copy draw a layout built in code (dateOrder.ts). Cards dragged
// there and links made / removed there are kept per board (tables
// flowchart_board_positions / flowchart_board_links) and laid over that
// built layout here. Pure — no Supabase import, so tests can use it.
import type { FlowchartSeriesEdge, FlowchartTask } from './types';

export type BoardLinkRule = 'show' | 'hide';

export interface BoardLayout {
  /** task id → dragged-to position (the board's real, uncompressed space). */
  positions: Map<string, { x: number; y: number }>;
  /** linkKey(from, to) → rule. */
  links: Map<string, BoardLinkRule>;
}

export const EMPTY_BOARD_LAYOUT: BoardLayout = { positions: new Map(), links: new Map() };

export const linkKey = (fromTaskId: string, toTaskId: string) => `${fromTaskId}>${toTaskId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A link saved in task_dependencies (not a drawn-in column arrow like "order:…" / "bridge:…"). */
export const isSavedLinkId = (id: string) => UUID.test(id);

export function applyBoardLayout<B extends { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[] }>(
  board: B,
  layout: BoardLayout,
  savedLinks: FlowchartSeriesEdge[]
): B {
  if (layout.positions.size === 0 && layout.links.size === 0) return board;
  const tasks = board.tasks.map((t) => {
    const p = layout.positions.get(t.id);
    return p ? { ...t, manualPositionX: p.x, manualPositionY: p.y } : t;
  });
  const onBoard = new Set(tasks.map((t) => t.id));
  const seen = new Set<string>();
  const shown = savedLinks.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return layout.links.get(linkKey(e.dependsOnTaskId, e.taskId)) === 'show' && onBoard.has(e.taskId) && onBoard.has(e.dependsOnTaskId);
  });
  // A link made here replaces whatever was drawn between the same two cards.
  const shownPair = new Set(shown.flatMap((e) => [linkKey(e.dependsOnTaskId, e.taskId), linkKey(e.taskId, e.dependsOnTaskId)]));
  const shownIds = new Set(shown.map((e) => e.id));
  const edges = [
    ...board.edges.filter((e) => {
      const key = linkKey(e.dependsOnTaskId, e.taskId);
      if (layout.links.get(key) === 'hide') return false;
      return !shownPair.has(key) || shownIds.has(e.id);
    }),
    ...shown.filter((e) => !board.edges.some((b) => b.id === e.id)),
  ];
  return { ...board, tasks, edges };
}

/**
 * A dropped card lines up with the nearest column / row of the other cards
 * when it lands within half a step of it (worked-out boards only), so a
 * rough drag still sits neatly in a column instead of making a new one.
 */
export function snapToBoard(
  p: { x: number; y: number },
  others: { x: number; y: number }[],
  tolX: number,
  tolY: number
): { x: number; y: number } {
  const nearest = (v: number, values: number[], tol: number) => {
    let best = v;
    let dist = tol;
    for (const c of values) {
      const d = Math.abs(c - v);
      if (d <= dist) {
        dist = d;
        best = c;
      }
    }
    return best;
  };
  return { x: nearest(p.x, others.map((o) => o.x), tolX), y: nearest(p.y, others.map((o) => o.y), tolY) };
}
