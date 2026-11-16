import { ripplePlannedDates } from '../flowchart/plannedRipple';

// PCC works -> Seating Wall -> External electrical conduiting (planned dates as on Flowchart 2).
const tasks = [
  { id: 'pcc', plannedStartDate: '2026-11-18', dueDate: '2026-11-20' },
  { id: 'seat', plannedStartDate: '2026-11-21', dueDate: '2026-11-27' },
  { id: 'cond', plannedStartDate: '2026-11-28', dueDate: '2026-11-30' },
];
const link = (from: string, to: string, type: 'FS' | 'SS' | 'FF' | 'SF') => ({ dependsOnTaskId: from, taskId: to, type });

describe('ripplePlannedDates', () => {
  it('moves the planned dates down the chain when FS becomes FF', () => {
    const r = ripplePlannedDates(tasks, [link('pcc', 'seat', 'FF'), link('seat', 'cond', 'FS')], 'seat');
    expect(r.get('seat')).toEqual({ start: '2026-11-14', end: '2026-11-20' });
    expect(r.get('cond')).toEqual({ start: '2026-11-21', end: '2026-11-23' });
    expect(r.has('pcc')).toBe(false);
  });

  it('changes nothing when the plan already matches the links', () => {
    expect(ripplePlannedDates(tasks, [link('pcc', 'seat', 'FS'), link('seat', 'cond', 'FS')], 'seat').size).toBe(0);
  });
});
