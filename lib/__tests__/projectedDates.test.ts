import { computeProjectedDates, runningDelayDays } from '../flowchart/projected';

// West side row on Flowchart 2 (planned dates as on the board), FS all the way.
const row = [
  ['lt', '2026-11-01', '2026-11-04'],
  ['soil', '2026-11-05', '2026-11-11'],
  ['drain', '2026-11-12', '2026-11-17'],
  ['pcc', '2026-11-18', '2026-11-20'],
].map(([id, s, e]) => ({ id, plannedStartDate: s, dueDate: e, actualStartDate: null, actualEndDate: null, expectedStartDate: null as string | null }));
const fs = (from: string, to: string) => ({ dependsOnTaskId: from, taskId: to, type: 'FS' as const });
const edges = [fs('lt', 'soil'), fs('soil', 'drain'), fs('drain', 'pcc')];
const EARLY = '2026-10-01'; // "today" before the plan, so nothing is overdue

describe('computeProjectedDates', () => {
  it('matches the plan when nothing is late', () => {
    const p = computeProjectedDates(row, edges, EARLY);
    expect(p.get('pcc')).toEqual({ start: '2026-11-18', end: '2026-11-20', delayDays: 0 });
  });

  it('pushes a 15-day delay on the first task down the whole FS chain, keeping each length', () => {
    const tasks = row.map((t) => (t.id === 'lt' ? { ...t, expectedStartDate: '2026-11-16' } : t));
    const p = computeProjectedDates(tasks, edges, EARLY);
    expect(p.get('lt')).toEqual({ start: '2026-11-16', end: '2026-11-19', delayDays: 15 });
    expect(p.get('soil')).toEqual({ start: '2026-11-20', end: '2026-11-26', delayDays: 15 });
    expect(p.get('pcc')).toEqual({ start: '2026-12-03', end: '2026-12-05', delayDays: 15 });
  });

  it('uses a real Actual Start over the Expected Start', () => {
    const tasks = row.map((t) => (t.id === 'lt' ? { ...t, expectedStartDate: '2026-11-16', actualStartDate: '2026-11-10' } : t));
    expect(computeProjectedDates(tasks, edges, EARLY).get('soil')?.start).toBe('2026-11-14');
  });

  it('moves a not-started overdue task to today and counts the days waiting', () => {
    const p = computeProjectedDates(row, edges, '2026-11-14');
    expect(p.get('lt')).toMatchObject({ start: '2026-11-14', end: '2026-11-17', missedStart: '2026-11-01' });
    expect(runningDelayDays(p.get('lt'))).toBe(14);
    expect(p.get('soil')?.start).toBe('2026-11-18');
  });
});
