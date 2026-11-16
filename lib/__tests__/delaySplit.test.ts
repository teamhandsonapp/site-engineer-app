import { delaySplit, formatDelaySplit } from '../flowchart/delaySplit';

describe('delaySplit', () => {
  it('splits Lift shaft 1st lift, every day counted', () => {
    const s = delaySplit({ plannedStart: '2026-10-26', plannedEnd: '2026-10-30', actualStart: '2026-10-27', actualEnd: '2026-11-05' });
    expect(s).toEqual({ start: 1, work: 5, total: 6 });
    expect(formatDelaySplit(s!)).toEqual(['Pre-con: 1d · Const: 5d · Total: 6d']);
  });

  it('is null until the task is finished', () => {
    expect(delaySplit({ plannedStart: '2026-10-26', plannedEnd: '2026-10-30', actualStart: '2026-10-27', actualEnd: null })).toBeNull();
  });
});
