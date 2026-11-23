/// <reference types="jest" />
// The pure rules don't touch the network; stub the Supabase client import.
jest.mock('../supabase', () => ({ supabase: {} }));

import { computeProgressStatus, type StatusInput } from '../taskProgressStatus';

// Fixed dates. 2026-11-13 is a Friday; 2026-11-15 is a Sunday.
const TODAY = '2026-11-13';
const base: StatusInput = {
  today: TODAY,
  taskStatus: 'ready',
  plannedStart: '2026-11-10',
  plannedEnd: '2026-11-20',
  actualStart: null,
  entries: [],
};
const filled = (date: string, percent = 10) => ({ date, percent, filled: true });

describe('computeProgressStatus', () => {
  it('Yet to Start: planned start in the future, not started', () => {
    const r = computeProgressStatus({ ...base, plannedStart: '2026-11-16' });
    expect(r.status).toBe('yet_to_start');
    expect(r.reason).toBe('Yet to Start: planned to start 16 Nov');
  });

  it('Yet to Start: planned to start today (today is not late yet)', () => {
    expect(computeProgressStatus({ ...base, plannedStart: TODAY }).status).toBe('yet_to_start');
  });

  it('Yet to Start: no planned start', () => {
    expect(computeProgressStatus({ ...base, plannedStart: null }).status).toBe('yet_to_start');
  });

  it('Delayed: planned start has passed, not started', () => {
    const r = computeProgressStatus({ ...base, plannedStart: '2026-11-11' });
    expect(r.status).toBe('delayed');
    expect(r.reason).toBe('Delayed: planned to start 11 Nov, not started yet');
  });

  it('On Hold: 4 DPR days, 2 filled, the next 2 passed and empty', () => {
    // Started 9 Nov (Mon). Days to yesterday (12 Nov): 9,10,11,12 -> 9,10 filled.
    const r = computeProgressStatus({
      ...base,
      plannedStart: '2026-11-09',
      actualStart: '2026-11-09',
      entries: [filled('2026-11-09'), filled('2026-11-10')],
    });
    expect(r.status).toBe('on_hold');
    expect(r.missingDates).toEqual(['2026-11-11', '2026-11-12']);
    expect(r.reason).toBe('On Hold: DPRs missing for 11 Nov, 12 Nov');
  });

  it('In Progress: every day up to yesterday filled, under 100%', () => {
    const r = computeProgressStatus({
      ...base,
      actualStart: '2026-11-10',
      entries: ['2026-11-10', '2026-11-11', '2026-11-12'].map((d) => filled(d)),
    });
    expect(r.status).toBe('in_progress');
    expect(r.progress).toBe(30);
    expect(r.overdue).toBe(false);
  });

  it("today is not counted as missing until the day is over", () => {
    // Filled up to yesterday, nothing for today -> still In Progress.
    const r = computeProgressStatus({ ...base, actualStart: '2026-11-12', entries: [filled('2026-11-12')] });
    expect(r.status).toBe('in_progress');
  });

  it('On Hold goes back to In Progress once the missing DPRs are filled', () => {
    const start = { ...base, plannedStart: '2026-11-09', actualStart: '2026-11-09' };
    const hold = computeProgressStatus({ ...start, entries: [filled('2026-11-09'), filled('2026-11-10')] });
    expect(hold.status).toBe('on_hold');
    const fixed = computeProgressStatus({ ...start, entries: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].map((d) => filled(d)) });
    expect(fixed.status).toBe('in_progress');
  });

  it('Completed: cumulative progress reaches 100%', () => {
    const r = computeProgressStatus({ ...base, actualStart: '2026-11-10', entries: [filled('2026-11-10', 60), filled('2026-11-11', 40)] });
    expect(r.status).toBe('completed');
    expect(r.progress).toBe(100);
  });

  it('100% early: later planned days are not needed and not missing', () => {
    // Planned to 20 Nov, 100% on 10 Nov, nothing after -> Completed (not On Hold).
    const r = computeProgressStatus({ ...base, actualStart: '2026-11-10', entries: [filled('2026-11-10', 100)] });
    expect(r.status).toBe('completed');
    expect(r.missingDates).toEqual([]);
  });

  it('Completed check comes first (even if days are missing)', () => {
    expect(computeProgressStatus({ ...base, taskStatus: 'completed' }).status).toBe('completed');
  });

  it('Past planned end, all DPRs filled, under 100%: In Progress + Overdue', () => {
    const r = computeProgressStatus({
      ...base,
      plannedStart: '2026-11-09',
      plannedEnd: '2026-11-11',
      actualStart: '2026-11-09',
      entries: ['2026-11-09', '2026-11-10', '2026-11-11'].map((d) => filled(d, 20)),
    });
    expect(r.status).toBe('in_progress');
    expect(r.overdue).toBe(true);
    expect(r.reason).toContain('past the planned end (11 Nov)');
  });

  it('Started early with "+ Add task": expected days count from the actual start', () => {
    // Planned 20-25 Nov, actually started 12 Nov and reported that day.
    const r = computeProgressStatus({ ...base, plannedStart: '2026-11-20', plannedEnd: '2026-11-25', actualStart: '2026-11-12', entries: [filled('2026-11-12', 40)] });
    expect(r.status).toBe('in_progress');
  });

  it('Started early but a day after the actual start is empty -> On Hold', () => {
    const r = computeProgressStatus({ ...base, plannedStart: '2026-11-20', plannedEnd: '2026-11-25', actualStart: '2026-11-11', entries: [filled('2026-11-11', 40)] });
    expect(r.status).toBe('on_hold');
    expect(r.missingDates).toEqual(['2026-11-12']);
  });

  it('Sundays and holidays are never missing', () => {
    // Today Tue 17 Nov; started Sat 14 Nov. Sun 15 skipped, Mon 16 is a holiday.
    const r = computeProgressStatus({
      ...base,
      today: '2026-11-17',
      plannedStart: '2026-11-14',
      actualStart: '2026-11-14',
      entries: [filled('2026-11-14')],
      holidays: ['2026-11-16'],
    });
    expect(r.status).toBe('in_progress');
  });

  it('Saved-but-not-submitted DPRs do not count as filled', () => {
    const r = computeProgressStatus({
      ...base,
      actualStart: '2026-11-12',
      entries: [{ date: '2026-11-12', percent: 10, filled: false }],
    });
    expect(r.status).toBe('on_hold');
  });

  it('A filled DPR without an actual start still counts as started', () => {
    const r = computeProgressStatus({ ...base, plannedStart: '2026-11-12', entries: [filled('2026-11-12')] });
    expect(r.status).toBe('in_progress');
  });
});
