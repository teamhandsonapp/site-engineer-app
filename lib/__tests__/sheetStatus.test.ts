import { sheetStatus } from '../flowchart/sheetStatus';

const plan = { plannedStartDate: '2026-10-26', dueDate: '2026-10-30' };

describe('sheetStatus', () => {
  it('finished: only the Completed column, with Pre-con/Const/Total', () => {
    const s = sheetStatus({ ...plan, actualStartDate: '2026-10-27', actualEndDate: '2026-11-05' }, '2026-11-15');
    expect(s.completed?.delay).toBe('Pre-con: 1d · Const: 5d · Total: 6d');
    expect(s.open).toBeNull();
  });

  it('not completed: Delayed with the delay count, or Upcoming', () => {
    expect(sheetStatus({ ...plan, actualStartDate: null, actualEndDate: null }, '2026-11-05').open).toEqual({ dates: 'Delayed', delay: '10d delay' });
    expect(sheetStatus({ ...plan, actualStartDate: null, actualEndDate: null }, '2026-10-20').open).toEqual({ dates: 'Upcoming', delay: null });
  });
});
