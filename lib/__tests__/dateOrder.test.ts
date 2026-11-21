import { appendBoardBelow, BELOW_GAP, buildDateOrderBoard, swapStacks } from '../flowchart/dateOrder';
import type { FlowchartTask } from '../flowchart/types';
import { computeProjectedDates } from '../flowchart/projected';

const task = (code: string, p: Partial<FlowchartTask> = {}): FlowchartTask => ({
  id: `uuid-${code}`,
  taskId: code,
  taskName: `Task ${code}`,
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
  manualPositionX: 12345,
  manualPositionY: 67890,
  roomType: null,
  floorLevel: null,
  milestoneId: null,
  ...p,
});

const TASKS = [
  task('PT-01', { actualStartDate: '2026-07-24', actualEndDate: '2026-07-26' }), // Curved Wall
  task('PT-04', { actualStartDate: '2026-07-27', actualEndDate: '2026-07-28' }), // Curved Wall
  task('PT-05', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-31' }), // Hot Kitchen
  task('PT-03', { actualStartDate: '2026-07-26', actualEndDate: '2026-07-28' }), // West Side
  task('PT-07', { actualStartDate: '2026-07-28', actualEndDate: '2026-08-01' }), // Main
  task('PT-06', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-30' }), // Main
  task('PT-20', { plannedStartDate: '2026-09-09', dueDate: '2026-09-15', actualStartDate: '2026-09-04', actualEndDate: '2026-09-20' }),
  task('PT-21', { plannedStartDate: '2026-09-15', dueDate: '2026-09-19', actualStartDate: '2026-09-05', actualEndDate: '2026-09-14' }),
  task('PT-99'), // in no stack, no dates
];

const board = buildDateOrderBoard(TASKS);
const stacks = () => {
  const xs = [...new Set(board.tasks.map((t) => t.manualPositionX!))].sort((a, b) => a - b);
  return xs.map((x) => board.tasks.filter((t) => t.manualPositionX === x).sort((a, b) => a.manualPositionY! - b.manualPositionY!));
};

describe('Past Tasks date order (stacks)', () => {
  it('shows every task exactly once, under its real id', () => {
    expect(board.tasks.map((t) => t.id).sort()).toEqual(TASKS.map((t) => t.id).sort());
  });

  it('one column per stack, stack name on top, tasks by actual date; unlisted tasks in "Other" last', () => {
    expect(stacks().map((col) => [col[0].sectionTitle, ...col.map((t) => t.taskId)])).toEqual([
      ['Main Structure', 'PT-06', 'PT-07', 'PT-20', 'PT-21'], // PT-06 & PT-07 both Jul 28 — PT-06 ends first
      ['Hot Kitchen', 'PT-05'],
      ['West Side External', 'PT-03'],
      ['Curved Wall @ North', 'PT-01', 'PT-04'],
      ['Other', 'PT-99'],
    ]);
    expect(board.tasks.filter((t) => t.sectionTitle).length).toBe(5);
  });

  it('a long stack stays ONE column, one task below the other', () => {
    const codes = ['PT-06', 'PT-07', 'PT-09', 'PT-10', 'PT-12', 'PT-13', 'PT-14', 'PT-15', 'PT-16', 'PT-17', 'PT-18', 'PT-19', 'PT-20', 'PT-21', 'PT-22', 'PT-23', 'PT-24', 'PT-25', 'PT-26', 'PT-27', 'PT-30'];
    const b = buildDateOrderBoard(codes.map((c, i) => task(c, { actualStartDate: `2026-08-${String(i + 1).padStart(2, '0')}` })));
    expect(new Set(b.tasks.map((t) => t.manualPositionX)).size).toBe(1);
    expect(b.tasks.filter((t) => t.sectionTitle).map((t) => t.sectionTitle)).toEqual(['Main Structure']);
    expect(b.edges).toHaveLength(20);
  });

  it('PT-02 and PT-09 are Main Structure', () => {
    const b = buildDateOrderBoard([task('PT-09', { actualStartDate: '2026-08-03' }), task('PT-02', { actualStartDate: '2026-07-29' })]);
    // PT-02 (Jul 29) heads the stack, PT-09 (Aug 3) right below it in the same column.
    expect(b.tasks.find((t) => t.taskId === 'PT-02')!.sectionTitle).toBe('Main Structure');
    expect(new Set(b.tasks.map((t) => t.manualPositionX)).size).toBe(1);
    expect(b.tasks.some((t) => t.sectionTitle === 'Other')).toBe(false);
  });

  it('arrows run down each stack, are display-only, and never cross stacks', () => {
    const arrows = board.edges.map((e) => `${e.dependsOnTaskId}>${e.taskId}`.replace(/uuid-/g, ''));
    expect(arrows).toEqual(['PT-06>PT-07', 'PT-07>PT-20', 'PT-20>PT-21', 'PT-01>PT-04']);
    // Type by actual dates; drawn like a real link (chip), display-only (soft: no date push, no warning).
    expect(board.edges.map((e) => e.type)).toEqual(['SS', 'FS', 'SS', 'FS']);
    expect(board.edges.every((e) => e.soft && e.drawAsLink && !e.hideLabel)).toBe(true);
  });

  it('last Main Structure task links to the first task of the Current Status copy (real link, type by dates)', () => {
    const pts = buildDateOrderBoard([
      task('PT-27', { actualStartDate: '2026-10-01', actualEndDate: '2026-10-10' }),
      task('PT-30', { plannedStartDate: '2026-09-19', dueDate: '2026-09-27', actualStartDate: '2026-10-22', actualEndDate: '2026-10-26' }),
      task('PT-01', { actualStartDate: '2026-07-24', actualEndDate: '2026-07-26' }),
    ]);
    const cs = [
      task('CIV-07', { sectionTitle: 'Walls / Mezzanine', manualPositionX: 0, manualPositionY: 0, plannedStartDate: '2026-09-17', dueDate: '2026-09-21', actualStartDate: '2026-10-25', actualEndDate: '2026-11-05' }),
      task('CIV-08', { manualPositionX: 0, manualPositionY: 148, plannedStartDate: '2026-11-06', dueDate: '2026-11-10' }),
    ];
    const all = appendBoardBelow(pts, { tasks: cs, seriesEdges: [], parallelEdges: [] });
    const bridge = all.edges.filter((e) => e.id.startsWith('bridge:'));
    // FS, real (not soft), no planned-date warning.
    expect(bridge.map((e) => [e.dependsOnTaskId, e.taskId, e.type, !!e.soft, e.noWarning])).toEqual([['uuid-PT-30', 'uuid-CIV-07', 'FS', false, true]]);
    // Not started yet: its projected dates follow PT-30's finish.
    const later = appendBoardBelow(pts, { tasks: [{ ...cs[0], actualStartDate: null, actualEndDate: null }], seriesEdges: [], parallelEdges: [] });
    const p = computeProjectedDates(later.tasks, later.edges, '2026-10-01');
    expect(p.get('uuid-CIV-07')).toMatchObject({ start: '2026-10-27', end: '2026-10-31' });
  });

  it('real PT-01..PT-30 dates: SS / FF where tasks overlapped, FS where one started after the one above finished', () => {
    const real: [string, string, string][] = [
      ['PT-01', '07-24', '07-26'], ['PT-02', '07-29', '08-01'], ['PT-03', '07-26', '07-28'], ['PT-04', '07-27', '07-28'],
      ['PT-05', '07-28', '07-31'], ['PT-06', '07-28', '07-30'], ['PT-07', '07-28', '08-01'], ['PT-08', '07-26', '08-02'],
      ['PT-09', '08-03', '08-10'], ['PT-10', '08-04', '08-10'], ['PT-11', '08-04', '08-07'], ['PT-12', '08-04', '08-10'],
      ['PT-13', '08-11', '08-15'], ['PT-14', '08-12', '08-15'], ['PT-15', '08-16', '08-21'], ['PT-16', '08-16', '08-21'],
      ['PT-17', '08-24', '08-29'], ['PT-18', '08-22', '09-01'], ['PT-19', '08-22', '09-01'], ['PT-20', '09-04', '09-20'],
      ['PT-21', '09-05', '09-14'], ['PT-22', '09-15', '09-21'], ['PT-23', '09-16', '09-21'], ['PT-24', '09-24', '10-21'],
      ['PT-25', '09-28', '09-29'], ['PT-26', '09-30', '10-10'], ['PT-27', '10-01', '10-10'], ['PT-30', '10-22', '10-26'],
    ];
    const b = buildDateOrderBoard(real.map(([c, s, e]) => task(c, { actualStartDate: `2026-${s}`, actualEndDate: `2026-${e}` })));
    const links = b.edges.map((e) => `${e.dependsOnTaskId.replace('uuid-', '')}>${e.taskId.replace('uuid-', '')} ${e.type}`);
    expect(links).toEqual([
      'PT-06>PT-07 SS', 'PT-07>PT-02 FF', 'PT-02>PT-09 FS', 'PT-09>PT-10 FF', 'PT-10>PT-12 SS', 'PT-12>PT-13 FS',
      'PT-13>PT-14 FF', 'PT-14>PT-15 FS', 'PT-15>PT-16 SS', 'PT-16>PT-18 FS', 'PT-18>PT-19 SS', 'PT-19>PT-17 SS',
      'PT-17>PT-20 FS', 'PT-20>PT-21 SS', 'PT-21>PT-22 FS', 'PT-22>PT-23 FF', 'PT-23>PT-24 FS', 'PT-24>PT-25 SS',
      'PT-25>PT-26 FS', 'PT-26>PT-27 FF', 'PT-27>PT-30 FS',
      'PT-03>PT-08 SS', 'PT-08>PT-11 FS',
      'PT-01>PT-04 FS',
    ]);
  });

  it('Current Status copy sits below the stacks: same layout, own links only, nothing linked to the stacks', () => {
    const cs = [task('CIV-01', { manualPositionX: 500, manualPositionY: 300 }), task('CIV-02', { manualPositionX: 731, manualPositionY: 448 })];
    const link = { id: 'l1', dependsOnTaskId: 'uuid-CIV-01', taskId: 'uuid-CIV-02', type: 'FS' as const };
    const all = appendBoardBelow(board, { tasks: cs, seriesEdges: [link], parallelEdges: [] });
    expect(all.tasks).toHaveLength(board.tasks.length + 2);
    const pastBottom = Math.max(...board.tasks.map((t) => t.manualPositionY!));
    const c1 = all.tasks.find((t) => t.taskId === 'CIV-01')!;
    const c2 = all.tasks.find((t) => t.taskId === 'CIV-02')!;
    expect([c1.manualPositionX, c1.manualPositionY]).toEqual([0, pastBottom + BELOW_GAP]);
    expect([c2.manualPositionX! - c1.manualPositionX!, c2.manualPositionY! - c1.manualPositionY!]).toEqual([231, 148]); // layout kept
    expect(all.edges.filter((e) => !e.soft)).toEqual([link]);
    expect(appendBoardBelow(board, null).tasks).toEqual(board.tasks);
  });

  it('Past Tasks copy: Walls / Mezzanine, Wall No. 4, Casting / Columns, Hot Kitchen; Lift shaft and links untouched', () => {
    const at = (code: string, col: number, row: number, title: string | null = null) =>
      task(code, { manualPositionX: col * 231, manualPositionY: row * 148, sectionTitle: title });
    const cs = [
      at('CIV-02', 0, 0, 'Hot Kitchen'), at('CIV-05', 0, 1),
      at('CIV-03', 1, 0, 'Casting / Columns'), at('CIV-01', 1, 1),
      at('CIV-07', 2, 0, 'Walls / Mezzanine'), at('CIV-08', 2, 1), at('CIV-12', 2, 2),
      at('CIV-09', 3, 0, 'Wall No. 4'), at('CIV-13', 3, 1),
      at('CIV-04', 4, 0, 'Lift shaft'), at('CIV-10', 4, 1),
      at('CIV-39', 0, 12, 'Staff block'), // another group lower in the same column: stays
    ];
    const col = (out: FlowchartTask[], code: string) => out.find((t) => t.taskId === code)!.manualPositionX! / 231;
    const out = swapStacks(cs, ['Walls / Mezzanine', 'Wall No. 4', 'Casting / Columns', 'Hot Kitchen']);
    expect(['CIV-07', 'CIV-08', 'CIV-12'].map((c) => col(out, c))).toEqual([0, 0, 0]);
    expect(['CIV-09', 'CIV-13'].map((c) => col(out, c))).toEqual([1, 1]);
    expect(['CIV-03', 'CIV-01'].map((c) => col(out, c))).toEqual([2, 2]);
    expect(['CIV-02', 'CIV-05'].map((c) => col(out, c))).toEqual([3, 3]);
    expect(['CIV-04', 'CIV-10', 'CIV-39'].map((c) => col(out, c))).toEqual([4, 4, 0]);
    expect(out.map((t) => t.manualPositionY)).toEqual(cs.map((t) => t.manualPositionY)); // rows unchanged
    expect(out.map((t) => t.id)).toEqual(cs.map((t) => t.id)); // same tasks, so every link still connects

    const link = { id: 'l1', dependsOnTaskId: 'uuid-CIV-02', taskId: 'uuid-CIV-05', type: 'FS' as const };
    const all = appendBoardBelow({ tasks: [], edges: [] }, { tasks: cs, seriesEdges: [link], parallelEdges: [] });
    expect(all.edges).toEqual([link]);
    // Missing stack (renamed): board left exactly as it is.
    expect(swapStacks(cs, ['Walls / Mezzanine', 'Nope'])).toEqual(cs);
  });

  it('Estimated (blue) dates in the copy are the same as on Current Status; stack arrows change nothing', () => {
    const cs = [
      task('CIV-07', { plannedStartDate: '2026-10-30', dueDate: '2026-10-30', actualStartDate: '2026-10-25', actualEndDate: '2026-11-05', manualPositionX: 0, manualPositionY: 0 }),
      task('CIV-08', { plannedStartDate: '2026-10-31', dueDate: '2026-11-03', manualPositionX: 0, manualPositionY: 148 }),
      task('CIV-12', { plannedStartDate: '2026-11-04', dueDate: '2026-11-06', manualPositionX: 0, manualPositionY: 296 }),
    ];
    const links = [
      { id: 'a', dependsOnTaskId: 'uuid-CIV-07', taskId: 'uuid-CIV-08', type: 'FS' as const },
      { id: 'b', dependsOnTaskId: 'uuid-CIV-08', taskId: 'uuid-CIV-12', type: 'FS' as const },
    ];
    const onCurrentStatus = computeProjectedDates(cs, links);
    const all = appendBoardBelow(board, { tasks: cs, seriesEdges: links, parallelEdges: [] });
    const onPastTasks = computeProjectedDates(all.tasks, all.edges);
    for (const t of cs) expect(onPastTasks.get(t.id)).toEqual(onCurrentStatus.get(t.id));
    expect(onPastTasks.get('uuid-CIV-12')).toBeDefined();
    // The stacks' FS arrows are display-only: past tasks project exactly as with no arrows at all.
    const noArrows = computeProjectedDates(board.tasks, []);
    for (const t of board.tasks) expect(onPastTasks.get(t.id)).toEqual(noArrows.get(t.id));
  });
});
