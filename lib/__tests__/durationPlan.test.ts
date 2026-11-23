import { planFromDuration } from '../flowchart/durationPlan';

describe('planFromDuration', () => {
  it('takes the latest start from the linked tasks', () => {
    const preds = [
      { name: 'Staff block', type: 'SS' as const, plannedStartDate: '2026-12-21', dueDate: '2027-01-15' },
      { name: 'Entry curved wall', type: 'FS' as const, plannedStartDate: '2026-12-21', dueDate: '2027-01-10' },
    ];
    expect(planFromDuration(10, preds)).toEqual({ start: '2027-01-11', end: '2027-01-20', from: 'Entry curved wall (FS)' });
  });

  it('is null without days or dated links', () => {
    expect(planFromDuration(0, [])).toBeNull();
    expect(planFromDuration(5, [{ name: 'x', type: 'FS', plannedStartDate: null, dueDate: null }])).toBeNull();
  });
});
