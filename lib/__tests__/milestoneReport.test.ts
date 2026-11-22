jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
import { EMPTY_CHECKLIST_NOTES, type ChecklistNotes } from '../flowchart/checklistNotes';
import { delayHeadline, milestoneReportHtml, milestoneSummary, rowParties } from '../flowchart/milestoneReport';
import { sheetReportRows } from '../flowchart/sheetReport';

const notes = (n: Partial<ChecklistNotes>): ChecklistNotes => ({ ...EMPTY_CHECKLIST_NOTES, ...n });
const task = (id: string, ps: string, pe: string, as: string | null, ae: string | null) => ({
  id,
  taskId: id,
  taskName: `Task ${id}`,
  workName: 'Civil Works',
  plannedStartDate: ps,
  dueDate: pe,
  actualStartDate: as,
  actualEndDate: ae,
});

describe('milestone report format', () => {
  // Planned Jul 28 → Aug 24 (28 days incl.); actual Jul 28 → Sep 1 (36 days); 8 days late.
  const tasks = [
    task('PT-06', '2026-07-28', '2026-07-30', '2026-07-28', '2026-07-30'),
    task('PT-16', '2026-08-14', '2026-08-18', '2026-08-16', '2026-08-21'),
    task('PT-18', '2026-08-19', '2026-08-24', '2026-08-22', '2026-09-01'),
  ];
  const pre = new Map([
    ['PT-16', notes({ contractorDelay: 'Shortage of Workforce', equipmentDelay: 'Compactor' })],
    ['PT-18', notes({ client: 'Approval pending' })],
  ]);
  const con = new Map([['PT-18', notes({ leadTime: 'RMC delayed' })]]);
  const rows = sheetReportRows(tasks, pre, '2026-11-21', con);
  const s = milestoneSummary(rows, '2026-11-21');

  it('cumulative planned and actual span, days counted inclusive, delay = actual end − planned end', () => {
    expect(s.tasks).toBe(3);
    expect([s.plannedStart, s.plannedEnd, s.plannedDays]).toEqual(['2026-07-28', '2026-08-24', 28]);
    expect([s.actualStart, s.actualEnd, s.actualDays]).toEqual(['2026-07-28', '2026-09-01', 36]);
    expect(s.delayDays).toBe(8);
    expect(delayHeadline(s)).toBe('Delayed by 8 days');
  });

  it('who: party only (Contractor / Client …), both stages, delayed tasks only', () => {
    expect(rowParties(rows.find((r) => r.taskCode === 'PT-18')!)).toEqual(['Contractor', 'Client']);
    expect(s.parties).toEqual([
      { party: 'Contractor', tasks: 2 },
      { party: 'Client', tasks: 1 },
    ]);
    expect(s.delayedTasks).toBe(2);
    expect(s.notWritten).toBe(0);
  });

  it('client format: planned end → actual end → difference; counts; delayed tasks per reason', () => {
    expect(s.onTime).toBe(1);
    expect(s.reasons.map((r) => [r.reason, r.tasks])).toEqual([
      ['Client approval', 1],
      ['Material Procurement Status', 1],
      ['Workers delay', 1],
      ['Equipment delays', 1],
    ]);
    expect(s.noReason).toBe(0);
    const html = milestoneReportHtml(s, 'ROAST', "Milestone 1 – +3'-6\" slab");
    expect(html).toContain('8 days late');
    expect(html).toContain('No. of tasks in milestone');
    expect(html).toContain('No. of tasks completed on time');
    expect(html).toContain('>Workers delay<');
    expect(html).not.toContain('Shortage of Workforce');
    expect(html).not.toContain('RMC delayed');
  });

  it('task list: every delay written, both stages, in one cell', () => {
    expect(s.lines.find((l) => l.code === 'PT-18')!.delays).toBe('Pre-con: Client approval · Const: Material Procurement Status');
    expect(s.lines.find((l) => l.code === 'PT-16')!.delays).toBe('Pre-con: Workers delay, Equipment delays');
    expect(s.lines.find((l) => l.code === 'PT-06')!.delays).toBe('');
    expect(milestoneReportHtml(s, 'ROAST', 'M1')).not.toContain('<h2>Tasks</h2>'); // no task list in the report
  });

  it('equipment delays: what was written, per task and stage, with the task delay', () => {
    expect(s.equipment).toEqual([{ code: 'PT-16', stage: 'Pre-con', text: 'Compactor', delayDays: 3, days: null }]);
    expect(milestoneReportHtml(s, 'ROAST', 'M1')).toContain('>Compactor<');
  });

  it('not finished yet: no actual end, delay so far past the planned end', () => {
    const open = sheetReportRows([...tasks, task('CIV-07', '2026-09-17', '2026-11-10', '2026-10-25', null)], new Map(), '2026-11-21');
    const o = milestoneSummary(open, '2026-11-21');
    expect(o.finished).toBe(false);
    expect(o.actualEnd).toBeNull();
    expect(o.delayDays).toBe(11);
    expect(delayHeadline(o)).toBe('11 days past the planned end so far');
    expect(o.notWritten).toBe(3); // PT-16, PT-18, CIV-07 late (PT-06 on time), none with a party written
  });
});
