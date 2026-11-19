jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
import { summarizeChecklist, summarizeDprToday, summarizeWorkers } from '../homeToday';
import type { DprTask } from '../dprEntries';

function task(id: string, over: Partial<DprTask> = {}): DprTask {
  return {
    id,
    taskCode: id,
    taskName: `Task ${id}`,
    workName: 'Civil Works',
    workId: 'w1',
    status: 'in_progress',
    plannedStartDate: '2026-11-10',
    plannedEndDate: '2026-11-30',
    actualStartDate: '2026-11-10',
    actualEndDate: null,
    quantityItemId: null,
    quantityDone: null,
    quantityUnit: null,
    scheduledToday: true,
    ...over,
  };
}

describe('Home: today', () => {
  it("counts today's DPR like the DPR screen's Today list, leaving out pre-construction tasks", () => {
    const tasks = [
      task('a'),
      task('b'),
      task('c', { scheduledToday: false }), // planned for later: not today
      task('d', { status: 'draft' }), // checklist not done: no DPR yet
      task('e', { status: 'blocked' }),
    ];
    const urgent = [task('c', { scheduledToday: false }), task('a')]; // pushed to this engineer
    const entries = { a: { dprSubmittedAtISO: '2026-11-19T05:00:00Z' }, c: { dprSubmittedAtISO: null } };
    expect(summarizeDprToday(tasks, urgent, entries)).toEqual({ due: 3, submitted: 1 });
  });

  it('has nothing due when no task is active today', () => {
    expect(summarizeDprToday([task('a', { scheduledToday: false })], [], {})).toEqual({ due: 0, submitted: 0 });
  });

  it('counts mandatory checklist items not yet Issued or Not Required, and the tasks they hold back', () => {
    expect(
      summarizeChecklist([
        { task_id: 't1', is_mandatory: true, completion: null }, // no answer yet
        { task_id: 't1', is_mandatory: true, completion: [{ status: 'PENDING' }] },
        { task_id: 't1', is_mandatory: true, completion: { status: 'YES' } }, // Issued
        { task_id: 't2', is_mandatory: null, completion: { status: 'NO' } }, // Not Required
        { task_id: 't2', is_mandatory: true, completion: { status: 'PROCEED' } }, // legacy Issued
        { task_id: 't3', is_mandatory: false, completion: null }, // optional item
        { task_id: 't4', is_mandatory: true, completion: [{ status: 'WAITING' }] },
      ])
    ).toEqual({ pendingItems: 3, tasksWaiting: 2 });
  });

  it("counts workers present and absent; anyone else isn't marked yet", () => {
    expect(summarizeWorkers(['m1', 'm2', 'm3', 'm4'], { m1: 'present', m2: 'absent', m3: 'present' })).toEqual({ present: 2, absent: 1, total: 4 });
    expect(summarizeWorkers([], {})).toEqual({ present: 0, absent: 0, total: 0 });
  });
});
