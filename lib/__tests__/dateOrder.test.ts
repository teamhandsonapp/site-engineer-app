import { appendBoardBelow, BELOW_GAP, buildDateOrderBoard, buildPastCopyBoard, PAST_COPY_BRIDGE_FROM, PAST_COPY_LEVEL_STACKS, PAST_TASK_STACKS, swapStacks } from '../flowchart/dateOrder';
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

describe('Past Tasks Copy — one column per level (2026-11-21)', () => {
  const copy = (code: string, s: string, e: string) => task(code.replace('PT-', 'PTC-'), { actualStartDate: `2026-${s}`, actualEndDate: `2026-${e}` });
  const levelBoard = buildDateOrderBoard(
    [copy('PT-22', '09-15', '09-21'), copy('PT-06', '07-28', '07-30'), copy('PT-14', '08-12', '08-15'), copy('PT-24', '09-24', '10-21'),
     copy('PT-30', '10-22', '10-26'), copy('PT-21', '09-05', '09-14'), copy('PT-09', '08-03', '08-10'), copy('PT-25', '09-28', '09-29')],
    PAST_COPY_LEVEL_STACKS
  );
  const columns = () => {
    const xs = [...new Set(levelBoard.tasks.map((t) => t.manualPositionX!))].sort((a, b) => a - b);
    return xs.map((x) => levelBoard.tasks.filter((t) => t.manualPositionX === x).sort((a, b) => a.manualPositionY! - b.manualPositionY!));
  };

  it('PTC codes go to their level column, left to right LL (No level on top, Mezz under), L, ML, UL, in date order', () => {
    expect(columns().map((c) => [c[0].sectionTitle, c.map((t) => t.taskId)])).toEqual([
      ['No level', ['PTC-25', 'PTC-06', 'PTC-09', 'PTC-24', 'PTC-30']],
      [PAST_COPY_LEVEL_STACKS[1].label, ['PTC-14']],
      [PAST_COPY_LEVEL_STACKS[2].label, ['PTC-21']],
      [PAST_COPY_LEVEL_STACKS[3].label, ['PTC-22']],
    ]);
    expect(levelBoard.tasks.find((t) => t.taskId === 'PTC-06')!.sectionTitle).toBe(PAST_COPY_LEVEL_STACKS[0].label);
    // No level sits above the columns, a section break between.
    const y = (c: string) => levelBoard.tasks.find((t) => t.taskId === c)!.manualPositionY!;
    expect(y('PTC-06') - y('PTC-25')).toBe(BELOW_GAP);
    expect(levelBoard.tasks.find((t) => t.taskId === 'PTC-24')!.sectionTitle).toBe(PAST_COPY_LEVEL_STACKS[4].label);
  });

  it('every copied task has exactly one level, and the crossed-out PT-02 / PT-17 are in none', () => {
    const codes = PAST_COPY_LEVEL_STACKS.flatMap((s) => s.taskCodes);
    const past = PAST_TASK_STACKS.flatMap((s) => s.taskCodes);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.filter((c) => c.startsWith('PT-')).sort()).toEqual(past.filter((c) => c !== 'PT-02' && c !== 'PT-17').sort());
    expect(codes.filter((c) => !c.startsWith('PT-')).sort()).toEqual(['CIV-01', 'CIV-03', 'CIV-09', 'CIV-13', 'CIV-22']);
  });

  it('the Mezz column (PT-30) links on to CIV-07 in the Current Status copy', () => {
    const cs = [task('CIV-07', { sectionTitle: 'Walls / Mezzanine', manualPositionX: 0, manualPositionY: 0 })];
    const all = appendBoardBelow(levelBoard, { tasks: cs, seriesEdges: [], parallelEdges: [] }, PAST_COPY_BRIDGE_FROM);
    expect(all.edges.filter((e) => e.id.startsWith('bridge:')).map((e) => [e.dependsOnTaskId, e.taskId])).toEqual([['uuid-PTC-30', 'uuid-CIV-07']]);
  });
});

describe('Past Tasks Copy — Current Status tasks lifted into the level columns (2026-11-22)', () => {
  const pc = (code: string, p: Partial<FlowchartTask> = {}) => task(`PC-${code}`, p);
  const status = {
    tasks: [
      pc('CIV-07', { sectionTitle: 'Walls / Mezzanine', manualPositionX: 693, manualPositionY: 0 }),
      pc('CIV-03', { sectionTitle: 'Casting / Columns', manualPositionX: 462, manualPositionY: 0, actualStartDate: '2026-10-27', actualEndDate: '2026-11-05' }),
      pc('CIV-01', { manualPositionX: 462, manualPositionY: 148, actualStartDate: '2026-10-27', actualEndDate: '2026-11-05' }),
      pc('CIV-06', { manualPositionX: 462, manualPositionY: 296 }),
      pc('FAB-01', { manualPositionX: 462, manualPositionY: 444 }),
    ],
    seriesEdges: [
      { id: 'd1', dependsOnTaskId: 'uuid-PC-CIV-03', taskId: 'uuid-PC-CIV-01', type: 'FF' as const },
      { id: 'd2', dependsOnTaskId: 'uuid-PC-CIV-01', taskId: 'uuid-PC-CIV-06', type: 'FS' as const },
      { id: 'd3', dependsOnTaskId: 'uuid-PC-CIV-06', taskId: 'uuid-PC-FAB-01', type: 'SS' as const },
    ],
    parallelEdges: [],
  };
  const past = [
    task('PTC-24', { actualStartDate: '2026-09-24', actualEndDate: '2026-10-21' }),
    task('PTC-30', { actualStartDate: '2026-10-22', actualEndDate: '2026-10-26' }),
  ];
  const all = buildPastCopyBoard(past, status);
  const byCode = new Map(all.tasks.map((t) => [t.taskId, t]));

  it('CIV-03 goes to L and CIV-01 to Mezz (under PTC-30); the rest stay below', () => {
    const mezz = all.tasks
      .filter((t) => t.manualPositionX === byCode.get('PTC-24')!.manualPositionX && t.manualPositionY! < BELOW_GAP)
      .map((t) => t.taskId);
    expect(mezz).toEqual(['PTC-24', 'PTC-30', 'PC-CIV-01']);
    expect(byCode.get('PC-CIV-03')!.manualPositionY).toBeLessThan(BELOW_GAP);
    expect(byCode.get('PC-CIV-06')!.manualPositionY).toBeGreaterThanOrEqual(BELOW_GAP);
  });

  it('the next card takes the lifted heading and the stack moves up', () => {
    const civ06 = byCode.get('PC-CIV-06')!;
    expect(civ06.sectionTitle).toBe('Casting / Columns');
    expect(byCode.get('PC-FAB-01')!.manualPositionY! - civ06.manualPositionY!).toBe(148);
    // In the board below (Walls / Mezzanine has moved up under Mezz).
    expect(civ06.manualPositionY).toBeGreaterThan(byCode.get('PC-CIV-07')!.manualPositionY!);
  });

  it('only short links inside one group are drawn (not CIV-03 → CIV-01 or CIV-01 → CIV-06); PT-30 still links on to CIV-07', () => {
    const real = all.edges.filter((e) => !e.soft && !e.id.startsWith('bridge:')).map((e) => e.id).sort();
    expect(real).toEqual(['d3']);
    expect(all.edges.filter((e) => e.id.startsWith('bridge:')).map((e) => [e.dependsOnTaskId, e.taskId])).toEqual([['uuid-PTC-30', 'uuid-PC-CIV-07']]);
  });
});

describe('Past Tasks Copy — ML column order (2026-11-22)', () => {
  it('dated tasks first by date, then CIV-03, CIV-13, CIV-22; the glazing group is not in it', () => {
    const b = buildDateOrderBoard(
      [
        task('PC-CIV-22'),
        task('PC-CIV-03', { actualStartDate: '2026-10-27', actualEndDate: '2026-11-05' }),
        task('PC-CIV-13', { actualStartDate: '2026-11-04', actualEndDate: '2026-11-16' }),
        task('PC-CIV-09', { actualStartDate: '2026-10-26', actualEndDate: '2026-11-02' }),
        task('PTC-05', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-31' }),
      ],
      PAST_COPY_LEVEL_STACKS
    );
    expect([...b.tasks].sort((x, y) => x.manualPositionY! - y.manualPositionY!).map((t) => t.taskId)).toEqual([
      'PTC-05', 'PC-CIV-09', 'PC-CIV-03', 'PC-CIV-13', 'PC-CIV-22',
    ]);
  });
});

describe('Past Tasks Copy — Mezz column under the LL column (2026-11-22)', () => {
  it('sits under LL with one empty row between, no column of its own, no link from another column', () => {
    const b = buildDateOrderBoard(
      [
        task('PTC-06', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-30' }),
        task('PTC-09', { actualStartDate: '2026-08-03', actualEndDate: '2026-08-10' }),
        task('PTC-05', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-31' }),
        task('PTC-07', { actualStartDate: '2026-07-28', actualEndDate: '2026-08-01' }),
        task('PTC-01', { actualStartDate: '2026-07-24', actualEndDate: '2026-07-26' }),
        task('PTC-21', { actualStartDate: '2026-09-05', actualEndDate: '2026-09-14' }),
        task('PTC-22', { actualStartDate: '2026-09-15', actualEndDate: '2026-09-21' }),
        task('PTC-24', { actualStartDate: '2026-09-24', actualEndDate: '2026-10-21' }),
        task('PTC-30', { actualStartDate: '2026-10-22', actualEndDate: '2026-10-26' }),
      ],
      PAST_COPY_LEVEL_STACKS
    );
    const at = (code: string) => b.tasks.find((t) => t.taskId === code)!;
    const step = at('PTC-07').manualPositionY! - at('PTC-05').manualPositionY!;
    // LL has 2 tasks (rows 0, 1): Mezz starts at row 3, in LL's column.
    expect(at('PTC-24').manualPositionX).toBe(at('PTC-06').manualPositionX);
    expect(at('PTC-24').manualPositionY! - at('PTC-06').manualPositionY!).toBe(3 * step);
    expect(at('PTC-24').sectionTitle).toBe(PAST_COPY_LEVEL_STACKS[4].label);
    // Mezz has no column of its own: UL is the last column.
    expect(Math.max(...b.tasks.map((t) => t.manualPositionX!))).toBe(at('PTC-22').manualPositionX);
    const ll = new Set(['uuid-PTC-06', 'uuid-PTC-09']);
    expect(b.edges.some((e) => ll.has(e.dependsOnTaskId) && e.taskId === 'uuid-PTC-24')).toBe(false);
    const mezz = new Set(['uuid-PTC-24', 'uuid-PTC-30']);
    expect(b.edges.filter((e) => mezz.has(e.taskId) !== mezz.has(e.dependsOnTaskId))).toEqual([]);
  });
});

describe('Past Tasks Copy — its own saved links (2026-11-22)', () => {
  it('draws PTC-19 → PTC-20 FF and PTC-19 / PTC-20 → PTC-24 FS', () => {
    const tasks = [
      task('PTC-19', { actualStartDate: '2026-08-22', actualEndDate: '2026-09-01' }),
      task('PTC-20', { actualStartDate: '2026-09-04', actualEndDate: '2026-09-20' }),
      task('PTC-24', { actualStartDate: '2026-09-24', actualEndDate: '2026-10-21' }),
    ];
    const own = [
      { id: 'l1', dependsOnTaskId: 'uuid-PTC-19', taskId: 'uuid-PTC-20', type: 'FF' as const },
      { id: 'l2', dependsOnTaskId: 'uuid-PTC-19', taskId: 'uuid-PTC-24', type: 'FS' as const },
      { id: 'l3', dependsOnTaskId: 'uuid-PTC-20', taskId: 'uuid-PTC-24', type: 'FS' as const },
    ];
    const all = buildPastCopyBoard(tasks, null, own);
    expect(all.edges.filter((e) => !e.soft).map((e) => [e.id, e.type])).toEqual([['l1', 'FF'], ['l2', 'FS'], ['l3', 'FS']]);
  });
});

describe('Past Tasks Copy — glazing group below the whole board (2026-11-22)', () => {
  it('GLZ-01/02/03 sit under everything, in order, with their links', () => {
    const status = {
      tasks: [
        task('PC-CIV-07', { sectionTitle: 'Walls / Mezzanine', manualPositionX: 693, manualPositionY: 0 }),
        task('PC-CIV-08', { manualPositionX: 693, manualPositionY: 148 }),
        task('PC-GLZ-01', { sectionTitle: 'Wall No. 4', manualPositionX: 924, manualPositionY: 0 }),
        task('PC-GLZ-02', { manualPositionX: 924, manualPositionY: 148 }),
        task('PC-GLZ-03', { manualPositionX: 924, manualPositionY: 296 }),
      ],
      seriesEdges: [
        { id: 'g1', dependsOnTaskId: 'uuid-PC-GLZ-01', taskId: 'uuid-PC-GLZ-02', type: 'FS' as const },
        { id: 'g2', dependsOnTaskId: 'uuid-PC-GLZ-02', taskId: 'uuid-PC-GLZ-03', type: 'FS' as const },
      ],
      parallelEdges: [],
    };
    const all = buildPastCopyBoard([task('PTC-30', { actualStartDate: '2026-10-22', actualEndDate: '2026-10-26' })], status);
    const y = (code: string) => all.tasks.find((t) => t.taskId === code)!.manualPositionY!;
    const others = all.tasks.filter((t) => !t.taskId.includes('GLZ')).map((t) => t.manualPositionY!);
    expect(y('PC-GLZ-01')).toBeGreaterThan(Math.max(...others));
    expect(y('PC-GLZ-01') < y('PC-GLZ-02') && y('PC-GLZ-02') < y('PC-GLZ-03')).toBe(true);
    expect(all.tasks.find((t) => t.taskId === 'PC-GLZ-01')!.sectionTitle).toBe('Glazing');
    expect(all.tasks.filter((t) => t.taskId.includes('GLZ'))).toHaveLength(3);
    expect(all.edges.filter((e) => e.id === 'g1' || e.id === 'g2')).toHaveLength(2);
  });
});

describe('Past Tasks Copy — Walls / Mezzanine stack under the Mezz group (2026-11-22)', () => {
  it('moves the whole stack up into the left column, under Mezz with a gap, links kept, PT-30 still links to CIV-07', () => {
    const status = {
      tasks: [
        task('PC-CIV-07', { sectionTitle: 'Walls / Mezzanine', manualPositionX: 693, manualPositionY: 0 }),
        task('PC-CIV-08', { manualPositionX: 693, manualPositionY: 148 }),
        task('PC-CIV-12', { manualPositionX: 693, manualPositionY: 296 }),
        task('PC-ROF-01', { manualPositionX: 693, manualPositionY: 2516 }), // a separate group further down: stays
        task('PC-CIV-02', { sectionTitle: 'Hot Kitchen', manualPositionX: 231, manualPositionY: 0 }),
      ],
      seriesEdges: [
        { id: 'w1', dependsOnTaskId: 'uuid-PC-CIV-07', taskId: 'uuid-PC-CIV-08', type: 'FS' as const },
        { id: 'w2', dependsOnTaskId: 'uuid-PC-CIV-08', taskId: 'uuid-PC-CIV-12', type: 'FS' as const },
      ],
      parallelEdges: [],
    };
    const all = buildPastCopyBoard(
      [
        task('PTC-06', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-30' }),
        task('PTC-24', { actualStartDate: '2026-09-24', actualEndDate: '2026-10-21' }),
        task('PTC-30', { actualStartDate: '2026-10-22', actualEndDate: '2026-10-26' }),
      ],
      status
    );
    const at = (code: string) => all.tasks.find((t) => t.taskId === code)!;
    const step = at('PTC-30').manualPositionY! - at('PTC-24').manualPositionY!;
    expect(at('PC-CIV-07').manualPositionX).toBe(at('PTC-06').manualPositionX);
    expect(at('PC-CIV-07').manualPositionY).toBe(at('PTC-30').manualPositionY! + BELOW_GAP);
    expect(at('PC-CIV-07').sectionTitle).toBe('Walls / Mezzanine');
    // CIV-07, CIV-08, CIV-12 side by side in one row (client, 2026-11-22).
    expect([at('PC-CIV-08'), at('PC-CIV-12')].map((t) => t.manualPositionY! - at('PC-CIV-07').manualPositionY!)).toEqual([0, 0]);
    expect(at('PC-ROF-01').manualPositionY).toBeGreaterThan(BELOW_GAP);
    expect(all.edges.filter((e) => e.id === 'w1' || e.id === 'w2')).toHaveLength(2);
    expect(all.edges.filter((e) => e.id.startsWith('bridge:')).map((e) => [e.dependsOnTaskId, e.taskId])).toEqual([['uuid-PTC-30', 'uuid-PC-CIV-07']]);
  });
});

describe('Past Tasks Copy — gap between LL / L and ML / UL (2026-11-22)', () => {
  it('leaves one empty column between L and ML; the others stay side by side', () => {
    const b = buildDateOrderBoard(
      [
        task('PTC-06', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-30' }),
        task('PTC-03', { actualStartDate: '2026-07-26', actualEndDate: '2026-07-28' }),
        task('PTC-05', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-31' }),
        task('PTC-22', { actualStartDate: '2026-09-15', actualEndDate: '2026-09-21' }),
        task('PTC-01', { actualStartDate: '2026-07-24', actualEndDate: '2026-07-26' }),
      ],
      PAST_COPY_LEVEL_STACKS
    );
    const x = (code: string) => b.tasks.find((t) => t.taskId === code)!.manualPositionX!;
    const step = x('PTC-03') - x('PTC-06');
    expect([x('PTC-05') - x('PTC-03'), x('PTC-22') - x('PTC-05')]).toEqual([2 * step, step]);
    // No level is on top, at the left.
    expect(x('PTC-01')).toBe(x('PTC-06'));
  });
});

describe('Past Tasks Copy — No level on top (2026-11-22)', () => {
  it('PTC-01 and PTC-25 sit above the columns at the left, with a gap above the headings', () => {
    const b = buildDateOrderBoard(
      [
        task('PTC-06', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-30' }),
        task('PTC-09', { actualStartDate: '2026-08-03', actualEndDate: '2026-08-10' }),
        task('PTC-01', { actualStartDate: '2026-07-24', actualEndDate: '2026-07-26' }),
        task('PTC-25', { actualStartDate: '2026-09-28', actualEndDate: '2026-09-29' }),
      ],
      PAST_COPY_LEVEL_STACKS
    );
    const at = (code: string) => b.tasks.find((t) => t.taskId === code)!;
    const step = at('PTC-09').manualPositionY! - at('PTC-06').manualPositionY!;
    expect([at('PTC-01').manualPositionY, at('PTC-25').manualPositionY]).toEqual([0, step]);
    // Then a section break (drawn as extra space) before the columns.
    expect(at('PTC-06').manualPositionY! - at('PTC-25').manualPositionY!).toBe(BELOW_GAP);
    expect(at('PTC-01').sectionTitle).toBe('No level');
    expect(b.edges.some((e) => e.dependsOnTaskId === 'uuid-PTC-01' && e.taskId === 'uuid-PTC-25')).toBe(true);
  });
});

describe('Past Tasks Copy — Hot Kitchen stack right of UL (2026-11-22)', () => {
  it('moves the whole stack up, one empty column right of UL, level with the column tops', () => {
    const status = {
      tasks: [
        task('PC-CIV-02', { sectionTitle: 'Hot Kitchen', manualPositionX: 231, manualPositionY: 0 }),
        task('PC-CIV-05', { manualPositionX: 231, manualPositionY: 148 }),
        task('PC-ELE-04', { manualPositionX: 231, manualPositionY: 296 }), // sits under Hot Kitchen, not part of it
        task('PC-CIV-04', { sectionTitle: 'Lift shaft', manualPositionX: 1155, manualPositionY: 0 }),
      ],
      seriesEdges: [
        { id: 'h1', dependsOnTaskId: 'uuid-PC-CIV-02', taskId: 'uuid-PC-CIV-05', type: 'FS' as const },
        { id: 'x1', dependsOnTaskId: 'uuid-PC-CIV-05', taskId: 'uuid-PC-CIV-04', type: 'FS' as const }, // long cross link: not drawn
      ],
      parallelEdges: [],
    };
    const all = buildPastCopyBoard([task('PTC-22', { actualStartDate: '2026-09-15', actualEndDate: '2026-09-21' })], status);
    const at = (code: string) => all.tasks.find((t) => t.taskId === code)!;
    expect(at('PC-CIV-02').sectionTitle).toBe('Hot Kitchen');
    expect(at('PC-CIV-02').manualPositionY).toBe(at('PTC-22').manualPositionY);
    expect(at('PC-CIV-02').manualPositionX! - at('PTC-22').manualPositionX!).toBe(2 * 231);
    expect(at('PC-CIV-05').manualPositionX).toBe(at('PC-CIV-02').manualPositionX);
    expect(at('PC-CIV-04').manualPositionY).toBeGreaterThanOrEqual(BELOW_GAP);
    expect(all.edges.some((e) => e.id === 'h1')).toBe(true);
    expect(all.edges.some((e) => e.id === 'x1')).toBe(false);
    expect(at('PC-ELE-04').manualPositionY).toBeGreaterThanOrEqual(BELOW_GAP);
  });
});

describe('Past Tasks Copy — CIV-07, CIV-08, CIV-12 side by side (2026-11-22)', () => {
  it('puts the three in one row under the Mezz group; the rest of the stack continues below CIV-07; their links stay', () => {
    const status = {
      tasks: [
        task('PC-CIV-07', { sectionTitle: 'Walls / Mezzanine', manualPositionX: 693, manualPositionY: 0 }),
        task('PC-CIV-08', { manualPositionX: 693, manualPositionY: 148 }),
        task('PC-CIV-12', { manualPositionX: 693, manualPositionY: 296 }),
        task('PC-CIV-17', { manualPositionX: 693, manualPositionY: 444 }),
      ],
      seriesEdges: [
        { id: 'f1', dependsOnTaskId: 'uuid-PC-CIV-07', taskId: 'uuid-PC-CIV-08', type: 'FF' as const },
        { id: 'f2', dependsOnTaskId: 'uuid-PC-CIV-08', taskId: 'uuid-PC-CIV-12', type: 'FF' as const },
        { id: 'f3', dependsOnTaskId: 'uuid-PC-CIV-12', taskId: 'uuid-PC-CIV-17', type: 'FS' as const },
      ],
      parallelEdges: [],
    };
    const all = buildPastCopyBoard([task('PTC-24', { actualStartDate: '2026-09-24', actualEndDate: '2026-10-21' })], status);
    const at = (code: string) => all.tasks.find((t) => t.taskId === code)!;
    const row = ['PC-CIV-07', 'PC-CIV-08', 'PC-CIV-12'].map(at);
    expect(new Set(row.map((t) => t.manualPositionY)).size).toBe(1);
    expect(row.map((t) => t.manualPositionX! - row[0].manualPositionX!)).toEqual([0, 231, 462]);
    expect(at('PC-CIV-07').sectionTitle).toBe('Walls / Mezzanine');
    expect(at('PC-CIV-17').manualPositionX).toBe(at('PC-CIV-07').manualPositionX);
    expect(at('PC-CIV-17').manualPositionY! - at('PC-CIV-07').manualPositionY!).toBe(200);
    expect(all.edges.filter((e) => ['f1', 'f2', 'f3'].includes(e.id)).map((e) => e.id).sort()).toEqual(['f1', 'f2', 'f3']);
  });
});

describe('Past Tasks Copy — link between its own task and the Current Status copy (2026-11-22)', () => {
  it('PTC-27 → PC-CIV-22 FF is drawn even though the two are in different columns', () => {
    const status = {
      tasks: [task('PC-CIV-22'), task('PC-CIV-04', { sectionTitle: 'Lift shaft', manualPositionX: 1155, manualPositionY: 0 })],
      seriesEdges: [{ id: 'c1', dependsOnTaskId: 'uuid-PTC-27', taskId: 'uuid-PC-CIV-22', type: 'FF' as const }],
      parallelEdges: [],
    };
    const all = buildPastCopyBoard([task('PTC-27', { actualStartDate: '2026-10-01', actualEndDate: '2026-10-10' })], status);
    expect(all.edges.filter((e) => e.id === 'c1').map((e) => e.type)).toEqual(['FF']);
  });
});


describe('Past Tasks Copy — CIV-06 beside CIV-29 (2026-11-22)', () => {
  it('sits right of CIV-29 in the same row; Casting / Columns below keeps its heading on the next card', () => {
    const status = {
      tasks: [
        task('PC-CIV-07', { sectionTitle: 'Walls / Mezzanine', manualPositionX: 693, manualPositionY: 0 }),
        task('PC-CIV-29', { manualPositionX: 693, manualPositionY: 148 }),
        task('PC-CIV-06', { sectionTitle: 'Casting / Columns', manualPositionX: 462, manualPositionY: 0 }),
        task('PC-FAB-01', { manualPositionX: 462, manualPositionY: 148 }),
      ],
      seriesEdges: [],
      parallelEdges: [],
    };
    const all = buildPastCopyBoard([task('PTC-24', { actualStartDate: '2026-09-24', actualEndDate: '2026-10-21' })], status);
    const at = (code: string) => all.tasks.find((t) => t.taskId === code)!;
    expect(all.tasks.filter((t) => t.taskId === 'PC-CIV-06')).toHaveLength(1);
    expect(at('PC-CIV-06').manualPositionY).toBe(at('PC-CIV-29').manualPositionY);
    expect(at('PC-CIV-06').manualPositionX! - at('PC-CIV-29').manualPositionX!).toBe(4 * 231);
    expect(at('PC-FAB-01').sectionTitle).toBe('Casting / Columns');
  });
});

describe('Past Tasks Copy — CIV-17 left of CIV-29, CIV-06 right of it (2026-11-22)', () => {
  it('second row of the Walls / Mezzanine stack; the rest below', () => {
    const status = {
      tasks: [
        task('PC-CIV-07', { sectionTitle: 'Walls / Mezzanine', manualPositionX: 693, manualPositionY: 0 }),
        task('PC-CIV-08', { manualPositionX: 693, manualPositionY: 148 }),
        task('PC-CIV-12', { manualPositionX: 693, manualPositionY: 296 }),
        task('PC-CIV-17', { manualPositionX: 693, manualPositionY: 444 }),
        task('PC-CIV-29', { manualPositionX: 693, manualPositionY: 592 }),
        task('PC-CIV-34', { manualPositionX: 693, manualPositionY: 740 }),
        task('PC-CIV-06', { sectionTitle: 'Casting / Columns', manualPositionX: 462, manualPositionY: 0 }),
      ],
      seriesEdges: [],
      parallelEdges: [],
    };
    const all = buildPastCopyBoard([task('PTC-24', { actualStartDate: '2026-09-24', actualEndDate: '2026-10-21' })], status);
    const at = (code: string) => all.tasks.find((t) => t.taskId === code)!;
    const x0 = at('PC-CIV-07').manualPositionX!;
    const y0 = at('PC-CIV-07').manualPositionY!;
    const pos = (c: string) => [at(c).manualPositionX! - x0, at(c).manualPositionY! - y0];
    // CIV-29 stays in the stack's column; CIV-17 to its left, CIV-06 apart on the right (three empty columns).
    expect(['PC-CIV-17', 'PC-CIV-29', 'PC-CIV-06'].map(pos)).toEqual([[-231, 200], [0, 200], [924, 200]]);
    expect(pos('PC-CIV-34')).toEqual([0, 400]);
  });
});

describe('Past Tasks Copy — CIV-22 → CIV-29 shown (2026-11-22)', () => {
  it('draws that one link between groups; other long links stay hidden', () => {
    const status = {
      tasks: [
        task('PC-CIV-07', { sectionTitle: 'Walls / Mezzanine', manualPositionX: 693, manualPositionY: 0 }),
        task('PC-CIV-29', { manualPositionX: 693, manualPositionY: 148 }),
        task('PC-CIV-22'),
        task('PC-CIV-04', { sectionTitle: 'Lift shaft', manualPositionX: 1155, manualPositionY: 0 }),
      ],
      seriesEdges: [
        { id: 's1', dependsOnTaskId: 'uuid-PC-CIV-22', taskId: 'uuid-PC-CIV-29', type: 'FS' as const },
        { id: 's2', dependsOnTaskId: 'uuid-PC-CIV-29', taskId: 'uuid-PC-CIV-04', type: 'FS' as const },
      ],
      parallelEdges: [],
    };
    const all = buildPastCopyBoard([task('PTC-24', { actualStartDate: '2026-09-24', actualEndDate: '2026-10-21' })], status);
    expect(all.edges.filter((e) => e.id === 's1' || e.id === 's2').map((e) => [e.id, e.type])).toEqual([['s1', 'FS']]);
  });
});

describe('Past Tasks Copy — PTC-25A / 25B on top, PTC-25 above PTC-24 (2026-11-22)', () => {
  it('25A over ML and 25B over UL, level with PTC-01; PTC-25 sits right above PTC-24 and the Mezz group moves down a row', () => {
    const all = buildPastCopyBoard(
      [
        task('PTC-01', { actualStartDate: '2026-07-24', actualEndDate: '2026-07-26' }),
        task('PTC-25', { actualStartDate: '2026-09-28', actualEndDate: '2026-09-29' }),
        task('PTC-25A', { actualStartDate: '2026-09-28', actualEndDate: '2026-09-29' }),
        task('PTC-25B', { actualStartDate: '2026-09-28', actualEndDate: '2026-09-29' }),
        task('PTC-05', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-31' }),
        task('PTC-22', { actualStartDate: '2026-09-15', actualEndDate: '2026-09-21' }),
        task('PTC-06', { actualStartDate: '2026-07-28', actualEndDate: '2026-07-30' }),
        task('PTC-24', { actualStartDate: '2026-09-24', actualEndDate: '2026-10-21' }),
        task('PTC-30', { actualStartDate: '2026-10-22', actualEndDate: '2026-10-26' }),
      ],
      null
    );
    const at = (code: string) => all.tasks.find((t) => t.taskId === code)!;
    expect([at('PTC-25A'), at('PTC-25B')].map((t) => t.manualPositionY)).toEqual([at('PTC-01').manualPositionY, at('PTC-01').manualPositionY]);
    expect(at('PTC-25A').manualPositionX).toBe(at('PTC-05').manualPositionX);
    expect(at('PTC-25B').manualPositionX).toBe(at('PTC-22').manualPositionX);
    expect(at('PTC-25').manualPositionX).toBe(at('PTC-24').manualPositionX);
    expect(at('PTC-24').manualPositionY! - at('PTC-25').manualPositionY!).toBe(200);
    expect(at('PTC-30').manualPositionY! - at('PTC-24').manualPositionY!).toBe(200);
    expect(at('PTC-24').sectionTitle).toBe(PAST_COPY_LEVEL_STACKS[4].label);
    expect(all.tasks.filter((t) => t.taskId === 'PTC-25')).toHaveLength(1);
  });
});

describe('Past Tasks Copy — PTC-04 on top above the L column (2026-11-22)', () => {
  it('leaves the L column, sits level with PTC-01 above PTC-03, with no links', () => {
    const all = buildPastCopyBoard(
      [
        task('PTC-01', { actualStartDate: '2026-07-24', actualEndDate: '2026-07-26' }),
        task('PTC-03', { actualStartDate: '2026-07-26', actualEndDate: '2026-07-28' }),
        task('PTC-04', { actualStartDate: '2026-07-27', actualEndDate: '2026-07-28' }),
        task('PTC-11', { actualStartDate: '2026-08-04', actualEndDate: '2026-08-07' }),
      ],
      null
    );
    const at = (code: string) => all.tasks.find((t) => t.taskId === code)!;
    expect(at('PTC-04').manualPositionY).toBe(at('PTC-01').manualPositionY);
    expect(at('PTC-04').manualPositionX).toBe(at('PTC-03').manualPositionX);
    expect(all.edges.some((e) => e.taskId === 'uuid-PTC-04' || e.dependsOnTaskId === 'uuid-PTC-04')).toBe(false);
    // The L column closes up: PTC-11 now follows PTC-03.
    expect(at('PTC-11').manualPositionY! - at('PTC-03').manualPositionY!).toBe(200);
  });
});
