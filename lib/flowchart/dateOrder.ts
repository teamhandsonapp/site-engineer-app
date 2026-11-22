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
  /** These go at the bottom of the column in exactly this order (not by date). */
  tail?: string[];
  /** No column of its own: drawn under this other column (by label), one empty
   *  row below its last card. No arrow joins the two. */
  under?: string;
  /** One empty column to its left (a gap between groups of columns). */
  gapBefore?: boolean;
  /** No column of its own: drawn at the very top-left, above all the columns,
   *  one empty row between it and them. */
  onTop?: boolean;
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

/** Past Tasks Copy codes → the original ones (PTC-06 → PT-06, PC-CIV-09 → CIV-09),
 *  so stacks / levels / milestones keyed by code work on both boards. */
export const pastTaskCode = (code: string) => code.trim().replace(/^PTC-/, 'PT-').replace(/^PC-/, '');

// Past Tasks Copy (2026-11-21, client's marked-up A3 print): one column per
// LEVEL instead of the stacks above, left to right from the lowest level up.
// Codes are the Past Tasks ones (the copy's PTC-xx are read as PT-xx).
// - Marked on the print: PT-06/09/10/12/13/16/18/19 LL; PT-14/15/20 L;
//   PT-21/23/26 ML; PT-22/27 UL; PT-24/30 Mezz.
// - Not marked, level from the task name: PT-03/04/08/11 L (−4'6"),
//   PT-05/07 ML (−2'0"). PT-01 (Curved wall, "till 76"") and PT-25 (PCC at
//   three levels) have no single level → "No level".
// - Crossed out (not copied): PT-02 (repeats PT-07) and PT-17.
// - Current Status tasks marked on the second print (2026-11-22): CIV-09 ML;
//   CIV-01 Mezz. Then (client) CIV-03, CIV-13, CIV-22 and the Wall No. 4
//   glazing group GLZ-01/02/03 → ML; the glazing group then moved to the very
//   bottom of the board (PAST_COPY_AT_BOTTOM). Lifted out of the copy below into
//   these columns (buildPastCopyBoard).
export const PAST_COPY_LEVEL_STACKS: PastTaskStack[] = [
  { label: `LL  (−7'6")`, taskCodes: ['PT-06', 'PT-09', 'PT-10', 'PT-12', 'PT-13', 'PT-16', 'PT-18', 'PT-19'] },
  { label: `L  (−4'6")`, taskCodes: ['PT-03', 'PT-04', 'PT-08', 'PT-11', 'PT-14', 'PT-15', 'PT-20'] },
  {
    label: `ML  (−2'0")`,
    // Client (2026-11-22): LL + L stay left; ML, UL, No level move right, with a gap between.
    gapBefore: true,
    taskCodes: ['PT-05', 'PT-07', 'PT-21', 'PT-23', 'PT-26', 'CIV-09', 'CIV-03', 'CIV-13', 'CIV-22'],
    // Client (2026-11-22): CIV-03, CIV-13, CIV-22 at the bottom of the column, in this order.
    tail: ['CIV-03', 'CIV-13', 'CIV-22'],
  },
  { label: `UL  (+3'6")`, taskCodes: ['PT-22', 'PT-27'] },
  // Client (2026-11-22): the whole Mezz column sits under the LL column, with a gap, not linked to it.
  { label: `Mezz  (+5'6")`, taskCodes: ['PT-24', 'PT-30', 'CIV-01'], under: `LL  (−7'6")` },
  // Client (2026-11-22): on top of the board, above the columns, with a gap.
  { label: 'No level', taskCodes: ['PT-01', 'PT-25'], onTop: true },
];
/** Past Tasks Copy: PT-30 links on to the Current Status copy below (→ CIV-07). By code,
 *  as CIV-01 now sits below PT-30 in the Mezz column. */
export const PAST_COPY_BRIDGE_FROM: BridgeFrom = { code: 'PT-30' };

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

export function buildDateOrderBoard(
  tasks: FlowchartTask[],
  stacks: PastTaskStack[] = PAST_TASK_STACKS
): { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[] } {
  const stackOf = new Map<string, string>();
  for (const s of stacks) for (const code of s.taskCodes) stackOf.set(code, s.label);
  const labels = [...stacks.map((s) => s.label), OTHER_STACK];

  const columns: { label: string; stack: FlowchartTask[]; under: string | null; gap: boolean; onTop: boolean }[] = [];
  for (const label of labels) {
    const def = stacks.find((s) => s.label === label);
    const tail = def?.tail ?? [];
    const tailAt = (t: FlowchartTask) => tail.indexOf(pastTaskCode(t.taskId));
    const stack = tasks
      .filter((t) => (stackOf.get(pastTaskCode(t.taskId)) ?? OTHER_STACK) === label)
      .sort((a, b) => (tailAt(a) < 0 && tailAt(b) < 0 ? byActualDate(a, b) : tailAt(a) < 0 ? -1 : tailAt(b) < 0 ? 1 : tailAt(a) - tailAt(b)));
    if (stack.length > 0) columns.push({ label, stack, under: def?.under ?? null, gap: !!def?.gapBefore, onTop: !!def?.onTop });
  }
  // Own columns left to right; an "under" column goes below its column's last card,
  // one empty row between (its own column if that one has no tasks).
  const place = new Map<string, { col: number; top: number }>();
  let nextCol = 0;
  columns
    .filter((c) => !c.onTop && (!c.under || !columns.some((o) => o.label === c.under)))
    .forEach((c) => {
      if (c.gap && place.size > 0) nextCol++;
      place.set(c.label, { col: nextCol++, top: 0 });
    });
  for (const c of columns) if (c.onTop) place.set(c.label, { col: 0, top: 0 });
  // An on-top group pushes every column down by a section break (layout.ts draws a
  // stored gap of 1500+ as extra space; an empty row on its own would collapse).
  const onTopRows = Math.max(0, ...columns.filter((c) => c.onTop).map((c) => c.stack.length));
  const columnsTop = onTopRows > 0 ? (onTopRows - 1) * ROW_STEP + BELOW_GAP : 0;
  for (const c of columns) {
    if (place.has(c.label)) continue;
    const target = columns.find((o) => o.label === c.under)!;
    const at = place.get(target.label)!;
    place.set(c.label, { col: at.col, top: at.top + target.stack.length + 1 });
  }

  const out: FlowchartTask[] = [];
  const edges: FlowchartSeriesEdge[] = [];
  columns.forEach(({ label, stack }) => {
    const { col, top } = place.get(label)!;
    const base = columns.find((c) => c.label === label)!.onTop ? 0 : columnsTop;
    // One copy per task, so cards keep their real id (tap opens the real task).
    stack.forEach((t, i) =>
      out.push({
        ...t,
        manualPositionX: col * COL_STEP,
        manualPositionY: base + (top + i) * ROW_STEP,
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
  });
  return { tasks: out, edges };
}

// Past Tasks (2026-11-20, client): a view-only COPY of the Current Status
// board drawn below the stacks — same layout and its own links, nothing
// linked to the stacks, nothing moved or saved. A stored gap of 1500+ is a
// section break (layout.ts), so the two parts stay visibly apart.
export const BELOW_GAP = 1600;

export function appendBoardBelow(
  above: { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[] },
  board: { tasks: FlowchartTask[]; seriesEdges: FlowchartSeriesEdge[]; parallelEdges: FlowchartParallelEdge[] } | null,
  bridgeFrom: BridgeFrom = { stack: BRIDGE_FROM_STACK }
): { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[]; parallelEdges: FlowchartParallelEdge[] } {
  if (!board) return { ...above, parallelEdges: [] };
  if (board.tasks.length === 0) {
    // Everything was moved up: still keep the links between the moved cards.
    const up = new Set(above.tasks.map((t) => t.id));
    return {
      ...above,
      edges: [...above.edges, ...board.seriesEdges.filter((e) => up.has(e.taskId) && up.has(e.dependsOnTaskId))],
      parallelEdges: board.parallelEdges.filter((e) => up.has(e.taskAId) && up.has(e.taskBId)),
    };
  }
  const taken = new Set(above.tasks.map((t) => t.id));
  const copy = swapStacks(board.tasks.filter((t) => !taken.has(t.id)), PAST_COPY_STACK_ORDER);
  const ids = new Set(copy.map((t) => t.id));
  const placed = copy.filter((t) => t.manualPositionX != null && t.manualPositionY != null);
  const minX = placed.length ? Math.min(...placed.map((t) => t.manualPositionX!)) : 0;
  const minY = placed.length ? Math.min(...placed.map((t) => t.manualPositionY!)) : 0;
  const bottom = above.tasks.length ? Math.max(...above.tasks.map((t) => t.manualPositionY ?? 0)) : -BELOW_GAP;
  const top = bottom + BELOW_GAP;
  // Real links between the two parts are kept too (Past Tasks Copy lifts some
  // Current Status tasks up into its level columns, 2026-11-22). On Past Tasks
  // nothing is lifted, so this is the same as the copy's own links.
  const onBoard = new Set([...ids, ...above.tasks.map((t) => t.id)]);
  const realLinks = board.seriesEdges.filter((e) => onBoard.has(e.taskId) && onBoard.has(e.dependsOnTaskId));
  const realPair = new Set(realLinks.map((e) => `${e.dependsOnTaskId}>${e.taskId}`));
  const moved = copy.map((t) =>
    t.manualPositionX != null && t.manualPositionY != null
      ? { ...t, manualPositionX: t.manualPositionX - minX, manualPositionY: t.manualPositionY - minY + top }
      : t
  );
  return {
    tasks: [...above.tasks, ...moved],
    edges: [
      // A stack arrow where a real link already joins the same two cards is dropped.
      ...above.edges.filter((e) => !(e.soft && realPair.has(`${e.dependsOnTaskId}>${e.taskId}`))),
      ...realLinks,
      ...bridgeEdge(above.tasks, moved, bridgeFrom),
    ],
    parallelEdges: board.parallelEdges.filter((e) => onBoard.has(e.taskAId) && onBoard.has(e.taskBId)),
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
export type BridgeFrom = { stack: string } | { code: string };
function bridgeEdge(stacks: FlowchartTask[], copy: FlowchartTask[], fromWhere: BridgeFrom): FlowchartSeriesEdge[] {
  let from: FlowchartTask | undefined;
  if ('code' in fromWhere) from = stacks.find((t) => pastTaskCode(t.taskId) === fromWhere.code);
  else {
    const head = stacks.find((t) => t.sectionTitle === fromWhere.stack);
    from = head ? stacks.filter((t) => t.manualPositionX === head.manualPositionX).sort((a, b) => b.manualPositionY! - a.manualPositionY!)[0] : undefined;
  }
  // CIV-07 heads Walls / Mezzanine; on Past Tasks Copy that stack sits up among the columns.
  const to = [...copy, ...stacks].find((t) => norm(t.sectionTitle) === norm(PAST_COPY_STACK_ORDER[0]));
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

// Past Tasks Copy (2026-11-22, client): the level columns (its Past Tasks plus
// the Current Status tasks marked with a level), and below them its own copy
// of the Current Status board without the lifted tasks. Where a lifted task
// was a stack's heading, the next card in that stack takes the heading and the
// rest of the stack moves up into the space.
// Client (2026-11-22): the glazing group goes below the whole board (below
// the Current Status copy too), on its own, in this order.
// Client (2026-11-22): CIV-06 (roof beam, west + north) right beside CIV-29 (roof
// beam, east) in the Walls / Mezzanine stack, same row.
// Then (client): kept apart from CIV-29 — same row, further right (three empty columns between).
export const PAST_COPY_BESIDE: { code: string; beside: string; columns: number }[] = [
  { code: 'CIV-06', beside: 'CIV-29', columns: 4 },
];
// Links the client wants drawn on Past Tasks Copy even though they run between
// groups (2026-11-22): CIV-22 → CIV-29 (FS, as on Current Status).
export const PAST_COPY_SHOW_LINKS: [string, string][] = [['CIV-22', 'CIV-29']];
// Placed by two other cards: across from `xOf` (its column) and level with `yOf` (its row).
// PTC-25A / PTC-25B (new tasks, copies of PTC-25; client 2026-11-22): on top, in PTC-25's
// row, right above the ML column (PTC-05) and the UL column (PTC-22).
// Then (client): PTC-25 itself moved down above PTC-24 (PAST_COPY_ABOVE), so they sit level with PTC-01.
export const PAST_COPY_PLACE: { code: string; xOf: string; yOf: string }[] = [
  // PTC-04 out of the L column, on top above it, not linked (client 2026-11-22).
  { code: 'PT-04', xOf: 'PT-03', yOf: 'PT-01' },
  { code: 'PT-25A', xOf: 'PT-05', yOf: 'PT-01' },
  { code: 'PT-25B', xOf: 'PT-22', yOf: 'PT-01' },
];
// Put directly above another card, in its column; that card and the ones under it
// move down a row. PTC-25 above PTC-24 (top of the Mezz group), client 2026-11-22.
export const PAST_COPY_ABOVE: { code: string; above: string }[] = [{ code: 'PT-25', above: 'PT-24' }];
export const PAST_COPY_AT_BOTTOM = { label: 'Glazing', taskCodes: ['GLZ-01', 'GLZ-02', 'GLZ-03'] };
// Client (2026-11-22): the Current Status copy's whole "Walls / Mezzanine" stack moves
// up under the Mezz group (left column), one empty row between, as one stack.
export const PAST_COPY_STACK_UNDER_MEZZ = 'Walls / Mezzanine';
// Client (2026-11-22): in that stack, CIV-07, CIV-08, CIV-12 (linked FF) side by side
// in one row; the rest of the stack carries on below CIV-07.
// Then CIV-17 | CIV-29 (FF) in the next row: CIV-29 stays in the stack's column and
// CIV-17 goes to its LEFT (client, 2026-11-22); CIV-06 is beside CIV-29 on the right.
// `anchor` = the card that stays in the stack's column; the others line up around it.
export const PAST_COPY_WM_ROWS: { codes: string[]; anchor: string }[] = [
  { codes: ['CIV-07', 'CIV-08', 'CIV-12'], anchor: 'CIV-07' },
  { codes: ['CIV-17', 'CIV-29'], anchor: 'CIV-29' },
];
// Client (2026-11-22): the copy's whole "Hot Kitchen" stack moves up to the right of
// the UL column, one empty column between, level with the column tops.
export const PAST_COPY_STACK_RIGHT_OF_UL = 'Hot Kitchen';
// Only its six civil tasks (ELE-04, ELE-06, NET-01, FUR-01 sit right under it on
// Current Status but are not Hot Kitchen — client, 2026-11-22).
export const PAST_COPY_HOT_KITCHEN_CODES = ['CIV-02', 'CIV-05', 'CIV-19', 'CIV-24', 'CIV-21', 'CIV-26'];

export function buildPastCopyBoard(
  pastTasks: FlowchartTask[],
  statusBoard: { tasks: FlowchartTask[]; seriesEdges: FlowchartSeriesEdge[]; parallelEdges: FlowchartParallelEdge[] } | null,
  /** Links saved between Past Tasks Copy's own tasks (e.g. the client's PTC-19 → PTC-24, 2026-11-22). */
  ownLinks: FlowchartSeriesEdge[] = []
): { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[]; parallelEdges: FlowchartParallelEdge[] } {
  const levelCodes = new Set(PAST_COPY_LEVEL_STACKS.flatMap((s) => s.taskCodes));
  const lifted = (statusBoard?.tasks ?? []).filter((t) => levelCodes.has(pastTaskCode(t.taskId)));
  const bottomAt = (t: FlowchartTask) => PAST_COPY_AT_BOTTOM.taskCodes.indexOf(pastTaskCode(t.taskId));
  const atBottom = [...pastTasks, ...(statusBoard?.tasks ?? [])].filter((t) => bottomAt(t) >= 0).sort((a, b) => bottomAt(a) - bottomAt(b));
  const bottomIds = new Set(atBottom.map((t) => t.id));
  pastTasks = pastTasks.filter((t) => !bottomIds.has(t.id));
  const besideCodes = new Set([...PAST_COPY_BESIDE, ...PAST_COPY_PLACE, ...PAST_COPY_ABOVE].map((b) => b.code));
  const columns = buildDateOrderBoard([...pastTasks.filter((t) => !besideCodes.has(pastTaskCode(t.taskId))), ...lifted], PAST_COPY_LEVEL_STACKS);
  for (const b of PAST_COPY_ABOVE) {
    const t = pastTasks.find((x) => pastTaskCode(x.taskId) === b.code);
    const under = columns.tasks.find((c) => pastTaskCode(c.taskId) === b.above);
    if (!t || !under) continue;
    const x = under.manualPositionX!, y = under.manualPositionY!;
    columns.tasks = columns.tasks.map((c) =>
      c.manualPositionX === x && c.manualPositionY! >= y ? { ...c, manualPositionY: c.manualPositionY! + ROW_STEP } : c
    );
    columns.tasks.push({ ...t, manualPositionX: x, manualPositionY: y, sectionTitle: null, dividerBelow: false });
  }
  // The Walls / Mezzanine stack, taken whole (same order, its heading) from the copy below.
  // Links inside a moved stack are always drawn (its row is side by side, see below).
  const groups: Set<string>[] = [];
  const liftedIds = new Set([...lifted.map((t) => t.id), ...bottomIds]);
  const statusTasks = statusBoard?.tasks ?? [];
  const wmHead = statusTasks.find(
    (t) => norm(t.sectionTitle) === norm(PAST_COPY_STACK_UNDER_MEZZ) && t.manualPositionX != null && t.manualPositionY != null && !liftedIds.has(t.id)
  );
  const mezzHead = columns.tasks.find((t) => t.sectionTitle === PAST_COPY_LEVEL_STACKS[4].label);
  const wm = wmHead && mezzHead ? stackMembers(statusTasks, wmHead).filter((t) => !liftedIds.has(t.id)) : [];
  if (wm.length > 0) {
    const x = mezzHead!.manualPositionX!;
    // A section break (see buildDateOrderBoard), so the gap shows even with no card beside it.
    const top = Math.max(...columns.tasks.filter((t) => t.manualPositionX === x).map((t) => t.manualPositionY!)) + BELOW_GAP;
    // Each listed row side by side (in list order), then the rest one under the other.
    const rows = PAST_COPY_WM_ROWS.map((row) => ({
      cards: row.codes.map((c) => wm.find((t) => pastTaskCode(t.taskId) === c)).filter((t): t is FlowchartTask => !!t),
      anchor: row.anchor,
    })).filter((r) => r.cards.length > 0);
    const anchorAt = (r: (typeof rows)[number]) => Math.max(0, r.cards.findIndex((t) => pastTaskCode(t.taskId) === r.anchor));
    const rowOf = (t: FlowchartTask) => rows.findIndex((r) => r.cards.includes(t));
    const below = wm.filter((t) => rowOf(t) < 0);
    wm.forEach((t, i) => {
      const r = rowOf(t);
      const k = below.indexOf(t);
      columns.tasks.push({
        ...t,
        manualPositionX: r >= 0 ? x + (rows[r].cards.indexOf(t) - anchorAt(rows[r])) * COL_STEP : x,
        manualPositionY: top + (r >= 0 ? r : rows.length + k) * ROW_STEP,
        sectionTitle: i === 0 ? wmHead!.sectionTitle : null,
        dividerBelow: false,
      });
      liftedIds.add(t.id);
    });
    groups.push(new Set(wm.map((t) => t.id)));
  }
  const hkHead = statusTasks.find(
    (t) => norm(t.sectionTitle) === norm(PAST_COPY_STACK_RIGHT_OF_UL) && t.manualPositionX != null && t.manualPositionY != null && !liftedIds.has(t.id)
  );
  const ulHead = columns.tasks.find((t) => t.sectionTitle === PAST_COPY_LEVEL_STACKS[3].label);
  const hkAt = (t: FlowchartTask) => PAST_COPY_HOT_KITCHEN_CODES.indexOf(pastTaskCode(t.taskId));
  const hk = hkHead && ulHead ? statusTasks.filter((t) => hkAt(t) >= 0 && !liftedIds.has(t.id)).sort((a, b) => hkAt(a) - hkAt(b)) : [];
  hk.forEach((t, i) => {
    columns.tasks.push({
      ...t,
      manualPositionX: ulHead!.manualPositionX! + 2 * COL_STEP,
      manualPositionY: ulHead!.manualPositionY! + i * ROW_STEP,
      sectionTitle: i === 0 ? hkHead!.sectionTitle : null,
      dividerBelow: false,
    });
    liftedIds.add(t.id);
  });
  for (const b of PAST_COPY_BESIDE) {
    const t = [...pastTasks, ...statusTasks].find((x) => pastTaskCode(x.taskId) === b.code && !liftedIds.has(x.id));
    const next = columns.tasks.find((c) => pastTaskCode(c.taskId) === b.beside);
    if (!t || !next) continue;
    columns.tasks.push({ ...t, manualPositionX: next.manualPositionX! + b.columns * COL_STEP, manualPositionY: next.manualPositionY, sectionTitle: null, dividerBelow: false });
    liftedIds.add(t.id);
  }
  for (const b of PAST_COPY_PLACE) {
    const t = [...pastTasks, ...statusTasks].find((x) => pastTaskCode(x.taskId) === b.code && !liftedIds.has(x.id));
    const colOf = columns.tasks.find((c) => pastTaskCode(c.taskId) === b.xOf);
    const rowOf = columns.tasks.find((c) => pastTaskCode(c.taskId) === b.yOf);
    if (!t || !colOf || !rowOf) continue;
    columns.tasks.push({ ...t, manualPositionX: colOf.manualPositionX, manualPositionY: rowOf.manualPositionY, sectionTitle: null, dividerBelow: false });
    liftedIds.add(t.id);
  }
  const shown = new Set(columns.tasks.map((t) => t.id));
  const own = ownLinks.filter((e) => shown.has(e.taskId) && shown.has(e.dependsOnTaskId));
  const ownPair = new Set(own.map((e) => `${e.dependsOnTaskId}>${e.taskId}`));
  // A column arrow where a saved link already joins the same two cards is dropped.
  const above = { tasks: columns.tasks, edges: [...columns.edges.filter((e) => !ownPair.has(`${e.dependsOnTaskId}>${e.taskId}`)), ...own] };
  const rest = statusBoard ? { ...statusBoard, tasks: closeLiftedGaps(statusBoard.tasks, liftedIds) } : null;
  const board = appendBoardBelow(above, rest, PAST_COPY_BRIDGE_FROM);
  // The client's links: saved on this board, including ones between its own tasks and
  // its Current Status copy (e.g. PTC-27 → PC-CIV-22 FF) — always drawn.
  const pastIds = new Set(pastTasks.map((t) => t.id));
  const codeOf = new Map([...pastTasks, ...(statusBoard?.tasks ?? [])].map((t) => [t.id, pastTaskCode(t.taskId)]));
  const showLink = (e: FlowchartSeriesEdge) =>
    PAST_COPY_SHOW_LINKS.some(([from, to]) => codeOf.get(e.dependsOnTaskId) === from && codeOf.get(e.taskId) === to);
  const ownIds = new Set([
    ...ownLinks.map((e) => e.id),
    ...(statusBoard?.seriesEdges ?? []).filter((e) => pastIds.has(e.taskId) || pastIds.has(e.dependsOnTaskId)).map((e) => e.id),
    ...(statusBoard?.seriesEdges ?? []).filter((e) => showLink(e)).map((e) => e.id),
  ]);
  if (atBottom.length === 0) return tidyLinks(board, ownIds, groups);
  // Below everything, far enough to be its own section (layout.ts), one card under the other.
  const top = Math.max(0, ...board.tasks.map((t) => t.manualPositionY ?? 0)) + BELOW_GAP;
  const placed = atBottom.map((t, i) => ({
    ...t,
    manualPositionX: 0,
    manualPositionY: top + i * ROW_STEP,
    sectionTitle: i === 0 ? PAST_COPY_AT_BOTTOM.label : null,
    dividerBelow: false,
  }));
  // Their own links (to each other and to anything still on the board) come with them.
  const onBoard = new Set([...board.tasks.map((t) => t.id), ...bottomIds]);
  const theirLinks = [...(statusBoard?.seriesEdges ?? []), ...ownLinks].filter(
    (e) => (bottomIds.has(e.taskId) || bottomIds.has(e.dependsOnTaskId)) && onBoard.has(e.taskId) && onBoard.has(e.dependsOnTaskId)
  );
  return tidyLinks({ tasks: [...board.tasks, ...placed], edges: [...board.edges, ...theirLinks], parallelEdges: board.parallelEdges }, ownIds, groups);
}

function closeLiftedGaps(tasks: FlowchartTask[], liftedIds: Set<string>): FlowchartTask[] {
  const change = new Map<string, Partial<FlowchartTask>>();
  for (const head of tasks) {
    if (!liftedIds.has(head.id) || !head.sectionTitle || head.manualPositionX == null || head.manualPositionY == null) continue;
    const remaining = stackMembers(tasks, head).filter((t) => !liftedIds.has(t.id));
    if (remaining.length === 0) continue;
    const up = remaining[0].manualPositionY! - head.manualPositionY;
    remaining.forEach((t, i) =>
      change.set(t.id, { manualPositionY: t.manualPositionY! - up, ...(i === 0 ? { sectionTitle: head.sectionTitle } : {}) })
    );
  }
  return tasks.filter((t) => !liftedIds.has(t.id)).map((t) => (change.has(t.id) ? { ...t, ...change.get(t.id) } : t));
}

// Past Tasks Copy (2026-11-22, client: "remove all the linkages, it's making a
// confusion"): only short links inside one column/group are drawn — the column
// arrows, a stack's own links between nearby cards — plus the client's saved
// links (PTC-18/19/20 → …) and PT-30 → CIV-07. Long lines running between
// columns or groups are left off this board (nothing is deleted).
function tidyLinks(
  board: { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[]; parallelEdges: FlowchartParallelEdge[] },
  keepIds: Set<string>,
  groups: Set<string>[] = []
): { tasks: FlowchartTask[]; edges: FlowchartSeriesEdge[]; parallelEdges: FlowchartParallelEdge[] } {
  const pos = new Map(board.tasks.map((t) => [t.id, t]));
  const near = (a: string, b: string) => {
    const ta = pos.get(a), tb = pos.get(b);
    if (!ta || !tb || ta.manualPositionX == null || tb.manualPositionX == null) return false;
    return Math.abs(ta.manualPositionX - tb.manualPositionX) <= SAME_COLUMN && Math.abs(ta.manualPositionY! - tb.manualPositionY!) < STACK_BREAK_GAP;
  };
  return {
    ...board,
    edges: board.edges.filter(
      (e) =>
        e.soft ||
        keepIds.has(e.id) ||
        e.id.startsWith('bridge:') ||
        near(e.dependsOnTaskId, e.taskId) ||
        groups.some((g) => g.has(e.dependsOnTaskId) && g.has(e.taskId))
    ),
    parallelEdges: board.parallelEdges.filter((e) => near(e.taskAId, e.taskBId)),
  };
}
