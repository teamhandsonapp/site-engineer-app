import { applyBoardLayout, EMPTY_BOARD_LAYOUT, isSavedLinkId, linkKey, snapToBoard, type BoardLayout } from '../flowchart/boardLayout';
import type { FlowchartSeriesEdge, FlowchartTask } from '../flowchart/types';

const task = (id: string, x: number, y: number): FlowchartTask => ({
  id,
  taskId: id.toUpperCase(),
  taskName: `Task ${id}`,
  description: null,
  plannedStartDate: null,
  dueDate: null,
  actualStartDate: null,
  actualEndDate: null,
  currentPlannedStartDate: null,
  currentDueDate: null,
  cascadeDelayDays: null,
  accountabilityType: null,
  workAccountabilityType: null,
  taskTypeId: null,
  workId: null,
  workName: 'Civil Works',
  manualPositionX: x,
  manualPositionY: y,
  roomType: null,
  floorLevel: null,
  milestoneId: null,
});

const SAVED_ID = '11111111-2222-3333-4444-555555555555';
const board = {
  tasks: [task('a', 0, 0), task('b', 0, 200), task('c', 231, 0)],
  edges: [{ id: 'order:actual:a>b', dependsOnTaskId: 'a', taskId: 'b', type: 'FS', soft: true, drawAsLink: true }] as FlowchartSeriesEdge[],
};
const layout = (p: Partial<BoardLayout>): BoardLayout => ({ positions: new Map(), links: new Map(), ...p });

describe('applyBoardLayout (moves and links kept per board)', () => {
  it('no saved changes → the worked-out board as it is', () => {
    expect(applyBoardLayout(board, EMPTY_BOARD_LAYOUT, [])).toBe(board);
  });

  it('a dragged card takes its saved position; the others stay', () => {
    const out = applyBoardLayout(board, layout({ positions: new Map([['b', { x: 462, y: 400 }]]) }), []);
    expect(out.tasks.find((t) => t.id === 'b')).toMatchObject({ manualPositionX: 462, manualPositionY: 400 });
    expect(out.tasks.find((t) => t.id === 'a')).toMatchObject({ manualPositionX: 0, manualPositionY: 0 });
  });

  it('a hidden column arrow is not drawn', () => {
    const out = applyBoardLayout(board, layout({ links: new Map([[linkKey('a', 'b'), 'hide']]) }), []);
    expect(out.edges).toEqual([]);
  });

  it('a link made here is always drawn, and replaces the arrow between the same two cards', () => {
    const saved: FlowchartSeriesEdge[] = [
      { id: SAVED_ID, dependsOnTaskId: 'b', taskId: 'a', type: 'FF' },
      { id: '99999999-2222-3333-4444-555555555555', dependsOnTaskId: 'a', taskId: 'c', type: 'FS' }, // no rule → not added
    ];
    const out = applyBoardLayout(board, layout({ links: new Map([[linkKey('b', 'a'), 'show']]) }), saved);
    expect(out.edges.map((e) => e.id)).toEqual([SAVED_ID]);
  });

  it('a shown link to a card not on this board is left out', () => {
    const saved: FlowchartSeriesEdge[] = [{ id: SAVED_ID, dependsOnTaskId: 'a', taskId: 'zzz', type: 'FS' }];
    const out = applyBoardLayout(board, layout({ links: new Map([[linkKey('a', 'zzz'), 'show']]) }), saved);
    expect(out.edges.map((e) => e.id)).toEqual(['order:actual:a>b']);
  });
});

describe('snapToBoard', () => {
  const others = [{ x: 0, y: 0 }, { x: 231, y: 200 }];
  it('lines up with the nearest column / row within the tolerance', () => {
    expect(snapToBoard({ x: 250, y: 190 }, others, 120, 80)).toEqual({ x: 231, y: 200 });
  });
  it('stays where dropped when nothing is close', () => {
    expect(snapToBoard({ x: 500, y: 100 }, others, 120, 80)).toEqual({ x: 500, y: 100 });
  });
});

it('isSavedLinkId tells saved links from drawn-in arrows', () => {
  expect(isSavedLinkId(SAVED_ID)).toBe(true);
  expect(isSavedLinkId('order:actual:a>b')).toBe(false);
  expect(isSavedLinkId('bridge:a>b')).toBe(false);
});
