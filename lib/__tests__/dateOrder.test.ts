import { buildDateOrderBoard } from '../flowchart/dateOrder';
import type { FlowchartTask } from '../flowchart/types';

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

// Real Past Tasks shapes: PT-01/PT-02 have no planned dates; the rest do.
const TASKS = [
  task('PT-01', { actualStartDate: '2026-07-24', actualEndDate: '2026-07-26' }),
  task('PT-02', { actualStartDate: '2026-07-29', actualEndDate: '2026-08-01' }),
  task('PT-20', { plannedStartDate: '2026-09-09', dueDate: '2026-09-13', actualStartDate: '2026-09-04', actualEndDate: '2026-09-20' }),
  task('PT-21', { plannedStartDate: '2026-09-15', dueDate: '2026-09-19', actualStartDate: '2026-09-05', actualEndDate: '2026-09-14' }),
  task('PT-22', { plannedStartDate: '2026-09-10', dueDate: '2026-09-15', actualStartDate: '2026-09-15', actualEndDate: '2026-09-21' }),
  task('PT-24', { plannedStartDate: '2026-09-20', dueDate: '2026-09-27', actualStartDate: '2026-09-24', actualEndDate: '2026-10-21' }),
  task('PT-25', { plannedStartDate: '2026-09-09', dueDate: '2026-09-10', actualStartDate: '2026-09-15', actualEndDate: '2026-09-29' }),
];

const board = buildDateOrderBoard(TASKS);
const left = board.tasks.filter((t) => !t.id.endsWith('~actual'));
const right = board.tasks.filter((t) => t.id.endsWith('~actual'));
// Rows top to bottom, each row left to right, as task codes.
const rowsOf = (cards: FlowchartTask[]) => {
  const ys = [...new Set(cards.map((t) => t.manualPositionY!))].sort((a, b) => a - b);
  return ys.map((y) => cards.filter((t) => t.manualPositionY === y).sort((a, b) => a.manualPositionX! - b.manualPositionX!).map((t) => t.taskId));
};

describe('Past Tasks date order', () => {
  it('shows every task once on each side', () => {
    expect(left).toHaveLength(TASKS.length);
    expect(right).toHaveLength(TASKS.length);
    expect(new Set(board.tasks.map((t) => t.id)).size).toBe(TASKS.length * 2);
  });

  it('left side: planned start order; same day side by side; no-planned-date tasks last, never by actual date', () => {
    expect(rowsOf(left)).toEqual([
      ['PT-25', 'PT-20'], // both planned Sep 9 — PT-25 ends first (Sep 10)
      ['PT-22'],
      ['PT-21'],
      ['PT-24'],
      ['PT-01', 'PT-02'], // "No planned dates" group, task-number order
    ]);
    expect(left.find((t) => t.taskId === 'PT-25')!.sectionTitle).toBe('By planned start date');
    expect(left.find((t) => t.taskId === 'PT-01')!.sectionTitle).toBe('No planned dates');
  });

  it('right side: actual start order', () => {
    expect(rowsOf(right)).toEqual([['PT-01'], ['PT-02'], ['PT-20'], ['PT-21'], ['PT-22', 'PT-25'], ['PT-24']]);
    expect(right.find((t) => t.taskId === 'PT-01')!.sectionTitle).toBe('By actual start date');
  });

  it('right side sits clear of the left side', () => {
    const leftMaxX = Math.max(...left.map((t) => t.manualPositionX!));
    const rightMinX = Math.min(...right.map((t) => t.manualPositionX!));
    expect(rightMinX - leftMaxX).toBeGreaterThanOrEqual(1500); // layout.ts section break
  });

  it('arrows join each date row to the next, are display-only, and skip the undated group', () => {
    const plannedArrows = board.edges.filter((e) => e.id.startsWith('order:planned:')).map((e) => `${e.dependsOnTaskId}>${e.taskId}`);
    expect(plannedArrows).toEqual([
      'uuid-PT-25>uuid-PT-22',
      'uuid-PT-20>uuid-PT-22',
      'uuid-PT-22>uuid-PT-21',
      'uuid-PT-21>uuid-PT-24',
    ]);
    const actualArrows = board.edges.filter((e) => e.id.startsWith('order:actual:')).map((e) => `${e.dependsOnTaskId}>${e.taskId}`.replace(/uuid-|~actual/g, ''));
    expect(actualArrows).toEqual(['PT-01>PT-02', 'PT-02>PT-20', 'PT-20>PT-21', 'PT-21>PT-22', 'PT-21>PT-25', 'PT-22>PT-24', 'PT-25>PT-24']);
    expect(board.edges.every((e) => e.soft && e.hideLabel)).toBe(true);
  });
});
