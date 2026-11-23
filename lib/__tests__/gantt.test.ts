jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('expo-print', () => ({}));
jest.mock('../flowchart/excelExport', () => ({ saveWorkbook: jest.fn() }));
import { EMPTY_CHECKLIST_NOTES } from '../flowchart/checklistNotes';
import { buildGantt, layoutGantt, linkGeometry, type GanttTask } from '../flowchart/gantt';
import type { FlowchartSeriesEdge } from '../flowchart/types';

const TODAY = '2026-11-17';
const task = (id: string, p: Partial<GanttTask>): GanttTask => ({
  id,
  taskId: id,
  taskName: `Task ${id}`,
  workName: 'Civil Works',
  plannedStartDate: null,
  dueDate: null,
  actualStartDate: null,
  actualEndDate: null,
  expectedStartDate: null,
  ...p,
});
const fs = (from: string, to: string, type: FlowchartSeriesEdge['type'] = 'FS'): FlowchartSeriesEdge => ({ id: `${from}>${to}`, taskId: to, dependsOnTaskId: from, type });
const rowOf = (g: ReturnType<typeof buildGantt>, id: string) => g.groups.flatMap((x) => x.rows).find((r) => r.id === id)!;

describe('gantt rows', () => {
  it('finished task: whole bar is actual, with the Pre-con / Const / Total line', () => {
    // Planned Oct 26–30, actual Oct 27–Nov 5 → Pre-con 1d, Const 5d, Total 6d.
    const t = task('CIV-04', { plannedStartDate: '2026-10-26', dueDate: '2026-10-30', actualStartDate: '2026-10-27', actualEndDate: '2026-11-05' });
    const r = rowOf(buildGantt([t], [t], [], new Map(), TODAY), 'CIV-04');
    expect(r.status).toBe('Completed');
    expect(r.plan).toEqual({ start: '2026-10-26', end: '2026-10-30' });
    expect(r.done).toEqual({ start: '2026-10-27', end: '2026-11-05' });
    expect(r.left).toBeNull();
    expect(r.progress).toBe(100);
    expect(r.durationDays).toBe(5);
    expect(r.varianceDays).toBe(6);
    expect(r.label).toBe('Pre-con: 1d · Const: 5d · Total: 6d');
  });

  it('running task: dark up to today, light for the projected days left', () => {
    // Planned Nov 12–21 (10 days), started Nov 14 → projected finish Nov 23.
    const t = task('CIV-06', { plannedStartDate: '2026-11-12', dueDate: '2026-11-21', actualStartDate: '2026-11-14' });
    const r = rowOf(buildGantt([t], [t], [], new Map(), TODAY), 'CIV-06');
    expect(r.status).toBe('In progress');
    expect(r.done).toEqual({ start: '2026-11-14', end: TODAY });
    expect(r.left).toEqual({ start: '2026-11-18', end: '2026-11-23' });
    expect(r.bar).toEqual({ start: '2026-11-14', end: '2026-11-23' });
    expect(r.varianceDays).toBe(2);
    expect(r.progress).toBe(40); // 4 of 10 days
  });

  it('late, not started: projected bar starts today, labelled with the delay and who it waits on', () => {
    const t = task('CIV-18', { plannedStartDate: '2026-11-04', dueDate: '2026-11-18' });
    const notes = new Map([['CIV-18', { ...EMPTY_CHECKLIST_NOTES, architect: 'Detailed Layouts Delayed' }]]);
    const r = rowOf(buildGantt([t], [t], [], notes, TODAY), 'CIV-18');
    expect(r.status).toBe('Pending');
    expect(r.done).toBeNull();
    expect(r.left).toEqual({ start: TODAY, end: '2026-12-01' });
    expect(r.label).toBe('13d delay · Architect');
    expect(r.reasons).toEqual([{ who: 'Architect', text: 'Detailed Layouts Delayed' }]);
  });

  it('upcoming task pushed by an FS link starts the day after the task before it', () => {
    const a = task('A', { plannedStartDate: '2026-11-20', dueDate: '2026-11-25', actualStartDate: '2026-11-17' });
    const b = task('B', { plannedStartDate: '2026-11-22', dueDate: '2026-11-24' });
    const g = buildGantt([a, b], [a, b], [fs('A', 'B')], new Map(), TODAY);
    expect(rowOf(g, 'B').left).toEqual({ start: '2026-11-23', end: '2026-11-25' });
    expect(rowOf(g, 'B').label).toBe('Projected +1d');
    expect(g.links).toEqual([{ id: 'A>B', from: 'A', to: 'B', type: 'FS', soft: false }]);
  });

  it('groups by the board outlines, the rest under Other works', () => {
    const g = buildGantt([task('CIV-02', { plannedStartDate: '2026-10-25', dueDate: '2026-10-28' }), task('HVC-01', { plannedStartDate: '2026-12-08', dueDate: '2026-12-21' })], [], [], new Map(), TODAY);
    expect(g.groups.map((x) => x.label)).toEqual(['Structural Civil Works', 'Other works']);
    expect(buildGantt([task('X-1', {})], [], [], new Map(), TODAY).groups[0].label).toBe('All tasks');
  });
});

describe('gantt drawing', () => {
  it('FS link: straight elbow when there is room, round between the rows when not', () => {
    const roomy = linkGeometry('FS', { x0: 0, x1: 50, y: 15 }, { x0: 100, x1: 150, y: 49, top: 34, rowH: 34 });
    expect(roomy.d).toBe('M50 15 L56 15 L56 49 L95 49');
    const tight = linkGeometry('FS', { x0: 0, x1: 50, y: 15 }, { x0: 50, x1: 90, y: 49, top: 34, rowH: 34 });
    expect(tight.d).toBe('M50 15 L56 15 L56 36 L44 36 L44 49 L45 49');
  });

  it('FF link arrives at the end of the bar from the right', () => {
    const ff = linkGeometry('FF', { x0: 0, x1: 50, y: 15 }, { x0: 20, x1: 50, y: 49, top: 34, rowH: 34 });
    expect(ff.d).toBe('M50 15 L56 15 L56 49 L55 49');
    expect(ff.arrow).toBe('50,49 55,45.5 55,52.5');
  });

  it('lays out one line per group and task, and hides finished tasks on request', () => {
    const done = task('CIV-02', { plannedStartDate: '2026-10-25', dueDate: '2026-10-28', actualStartDate: '2026-10-25', actualEndDate: '2026-10-28' });
    const open = task('CIV-05', { plannedStartDate: '2026-10-29', dueDate: '2026-11-04' });
    const data = buildGantt([done, open], [done, open], [fs('CIV-02', 'CIV-05')], new Map(), TODAY);
    const opts = { dayW: 20, rowH: 34, labelPad: 200, hideCompleted: false, collapsed: new Set<string>(), showPlan: true, showLinks: true };
    const all = layoutGantt(data, opts);
    expect(all.lines.map((l) => l.kind)).toEqual(['group', 'task', 'task']);
    expect(all.height).toBe(3 * 34);
    expect(all.links).toHaveLength(1);
    expect(all.todayX).toBe((Date.parse('2026-11-17') - Date.parse(data.start)) / 86_400_000 * 20);
    const open1 = layoutGantt(data, { ...opts, hideCompleted: true });
    expect(open1.lines.map((l) => l.kind)).toEqual(['group', 'task']);
    expect(open1.links).toHaveLength(0); // its partner is hidden
    expect(layoutGantt(data, { ...opts, collapsed: new Set([data.groups[0].key]) }).lines).toHaveLength(1);
  });
});
