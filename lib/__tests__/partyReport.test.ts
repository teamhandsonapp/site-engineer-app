jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('expo-print', () => ({}));
jest.mock('../flowchart/excelExport', () => ({ saveWorkbook: jest.fn() }));
import { EMPTY_CHECKLIST_NOTES } from '../flowchart/checklistNotes';
import { partyRows, reasonEntries, reportParties, type SheetReportRow } from '../flowchart/sheetReport';

const row = (taskCode: string, notes: Partial<SheetReportRow['notes']>): SheetReportRow => ({
  no: 1, taskCode, taskName: taskCode, department: 'Civil Works', status: 'Pending',
  plannedDates: '', actualDates: '', delay: '5d delay', delayed: true, delayDays: 5,
  notes: { ...EMPTY_CHECKLIST_NOTES, ...notes },
});

describe('party report', () => {
  const rows = [
    row('CIV-26', { architect: 'Detailed Layouts Delayed', consultant: 'Structural Layouts Delayed' }),
    row('CIV-11', { consultant: 'MEP Detailed Layouts Delayed' }),
    row('CIV-99', {}),
  ];
  it('keeps only tasks waiting on the party, with only that party\'s reason', () => {
    const a = partyRows(rows, 'Architect');
    expect(a.map((r) => r.taskCode)).toEqual(['CIV-26']);
    expect(reasonEntries(a[0])).toEqual([{ who: 'Architect', text: 'Detailed Layouts Delayed' }]);
    expect(partyRows(rows, 'Consultant (Structural)').map((r) => r.taskCode)).toEqual(['CIV-26']);
    expect(partyRows(rows, 'Consultant (MEP)').map((r) => r.taskCode)).toEqual(['CIV-11']);
  });
  it('lists parties Architect first', () => {
    expect(reportParties(rows)).toEqual(['Architect', 'Consultant (MEP)', 'Consultant (Structural)']);
  });
});

import { reportFileName } from '../flowchart/sheetReport';
describe('report file name', () => {
  it('follows the filters', () => {
    const n = reportFileName('ROAST @ Kokapet', 'Architect', 'Upcoming', []);
    expect(n).toMatch(/^ROAST @ Kokapet - Architect - Upcoming Tasks Dependencies - \d{1,2} \w{3} \d{4}$/);
    expect(reportFileName('P', null, 'All', ['Civil Works'])).toMatch(/^P - Project Status - All Tasks Dependencies \(Civil Works\) - /);
    expect(reportFileName('P', 'Contractor / Vendor Finalization', 'Pending', [])).not.toContain('/');
  });
});

import { toggleStatus } from '../flowchart/sheetReport';
describe('combined statuses (Pending + Upcoming in one report)', () => {
  it('turns statuses on and off, in the usual order', () => {
    expect(toggleStatus([], 'Upcoming')).toEqual(['Upcoming']);
    expect(toggleStatus(['Upcoming'], 'Pending')).toEqual(['Pending', 'Upcoming']);
    expect(toggleStatus(['Pending', 'Upcoming'], 'Upcoming')).toEqual(['Pending']);
    expect(toggleStatus(['Pending'], 'Pending')).toEqual([]);
  });
  it('All, or all four picked, means no status filter', () => {
    expect(toggleStatus(['Pending', 'Upcoming'], 'All')).toEqual([]);
    expect(toggleStatus(['Pending', 'In progress', 'Upcoming'], 'Completed')).toEqual([]);
  });
  it('names the file after both statuses', () => {
    expect(reportFileName('ROAST @ Kokapet', 'Architect', 'Pending & Upcoming', [])).toMatch(
      /^ROAST @ Kokapet - Architect - Pending & Upcoming Tasks Dependencies - \d{1,2} \w{3} \d{4}$/
    );
  });
});
