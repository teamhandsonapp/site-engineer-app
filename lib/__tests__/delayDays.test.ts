jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
// Days next to every delay (2026-11-22): saved in delay_days; the app keeps
// working on a database where that column hasn't been added yet.
const mockUpserts: Record<string, unknown>[] = [];
let mockHasDays = true;
const mockMissingDays = { code: 'PGRST204', message: "Could not find the 'delay_days' column of 'task_checklist_notes' in the schema cache" };
jest.mock('../supabase', () => ({
  supabase: {
    from: () => ({
      upsert: (row: Record<string, unknown>) => {
        mockUpserts.push(row);
        return Promise.resolve(!mockHasDays && 'delay_days' in row ? { error: mockMissingDays } : { error: null });
      },
    }),
  },
}));
import { cleanDelayDays, EMPTY_CHECKLIST_NOTES, fieldDays, notePointsText, parseDays, saveChecklistNotes, type ChecklistNotes } from '../flowchart/checklistNotes';
import { milestoneReportHtml, milestoneSummary } from '../flowchart/milestoneReport';
import { sheetReportRows } from '../flowchart/sheetReport';

const notes = (n: Partial<ChecklistNotes>): ChecklistNotes => ({ ...EMPTY_CHECKLIST_NOTES, ...n });

beforeEach(() => {
  mockUpserts.length = 0;
});

describe('delay days', () => {
  it('parses the days box: whole days only, empty = none', () => {
    expect(parseDays('5')).toBe(5);
    expect(parseDays('')).toBeNull();
    expect(parseDays('0')).toBeNull();
    expect(parseDays('12d')).toBe(12);
  });

  it('adds up a field over its points; points without days count nothing', () => {
    const n = notes({ contractorDelay: 'Workers late\nLabour strike', delayDays: { contractorDelay: [5, 3] } });
    expect(fieldDays(n, 'contractorDelay')).toBe(8);
    expect(fieldDays(n, 'architect')).toBeNull();
    expect(notePointsText(n, 'contractorDelay')).toBe('• Workers late (5 days)\n• Labour strike (3 days)');
    expect(notePointsText(notes({ client: 'Approval' }), 'client')).toBe('Approval');
  });

  it('drops empty fields and trailing empties before saving', () => {
    expect(cleanDelayDays({ contractorDelay: [5, null], client: [null] })).toEqual({ contractorDelay: [5] });
    expect(cleanDelayDays({})).toBeNull();
  });

  it('saves the days with the delays', async () => {
    mockHasDays = true;
    await saveChecklistNotes('t', notes({ contractorDelay: 'Workers late', delayDays: { contractorDelay: [4] } }), null);
    expect(mockUpserts[0].delay_days).toEqual({ contractorDelay: [4] });
  });

  it('before the SQL is run: delays without days still save', async () => {
    mockHasDays = false;
    await saveChecklistNotes('t', notes({ contractorDelay: 'Workers late' }), null);
    expect(mockUpserts.map((r) => 'delay_days' in r)).toEqual([true, false]);
  });

  it('before the SQL is run: days given → says what is needed', async () => {
    mockHasDays = false;
    await expect(saveChecklistNotes('t', notes({ contractorDelay: 'x', delayDays: { contractorDelay: [2] } }), null)).rejects.toThrow(/database update/);
  });

  it('milestone report: days per reason (both stages) and per equipment entry', () => {
    const tasks = [
      { id: 'A', taskId: 'PT-01', taskName: 'A', workName: 'Civil Works', plannedStartDate: '2026-08-01', dueDate: '2026-08-05', actualStartDate: '2026-08-01', actualEndDate: '2026-08-15' },
      { id: 'B', taskId: 'PT-02', taskName: 'B', workName: 'Civil Works', plannedStartDate: '2026-08-01', dueDate: '2026-08-05', actualStartDate: '2026-08-01', actualEndDate: '2026-08-09' },
    ];
    const pre = new Map([
      ['A', notes({ contractorDelay: 'Workers late', delayDays: { contractorDelay: [6] } })],
      ['B', notes({ contractorDelay: 'Few masons', equipmentDelay: 'Compactor', delayDays: { contractorDelay: [2], equipmentDelay: [3] } })],
    ]);
    const con = new Map([['A', notes({ contractorDelay: 'Rain week', delayDays: { contractorDelay: [4] } })]]);
    const s = milestoneSummary(sheetReportRows(tasks as never, pre, '2026-11-22', con), '2026-11-22');
    expect(s.reasons.find((r) => r.reason === 'Workers delay')).toMatchObject({ tasks: 2, days: 12 });
    expect(s.equipment).toEqual([{ code: 'PT-02', stage: 'Pre-con', text: 'Compactor', delayDays: 4, days: 3 }]);
    expect(milestoneReportHtml(s, 'ROAST', 'M1')).toContain('12 days');
  });
});
