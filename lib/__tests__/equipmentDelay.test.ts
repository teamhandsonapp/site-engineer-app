jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
// Equipment delays (Past Tasks, 2026-11-21): the app must keep working on a
// database where the equipment_delay column hasn't been added yet.
const mockCalls: { select?: string; upsert?: Record<string, unknown> }[] = [];
let mockHasColumn = false;
const mockMissing = { code: '42703', message: 'column task_checklist_notes.equipment_delay does not exist' };
jest.mock('../supabase', () => ({
  supabase: {
    from: () => ({
      select: (select: string) => {
        mockCalls.push({ select });
        const res = !mockHasColumn && select.includes('equipment_delay') ? { data: null, error: mockMissing } : { data: { task_id: 't', architect: 'Late dwgs', ...(mockHasColumn ? { equipment_delay: 'Crane down' } : {}) }, error: null };
        return { eq: () => ({ maybeSingle: () => Promise.resolve(res) }) };
      },
      upsert: (row: Record<string, unknown>) => {
        mockCalls.push({ upsert: row });
        return Promise.resolve(!mockHasColumn && 'equipment_delay' in row ? { error: mockMissing } : { error: null });
      },
    }),
  },
}));
import { EMPTY_CHECKLIST_NOTES, fetchChecklistNotes, saveChecklistNotes, STAGED_NOTE_FIELDS, CHECKLIST_NOTE_FIELDS } from '../flowchart/checklistNotes';
import { reasonEntries, sheetReportRows } from '../flowchart/sheetReport';

beforeEach(() => {
  mockCalls.length = 0;
});

describe('Equipment delays', () => {
  it('is on the Past Tasks tabs only', () => {
    expect(STAGED_NOTE_FIELDS.map((f) => f.label)).toContain('Equipment delays');
    expect(CHECKLIST_NOTE_FIELDS.map((f) => f.label)).not.toContain('Equipment delays');
  });

  it('reads with the column once it exists', async () => {
    mockHasColumn = true;
    expect((await fetchChecklistNotes('t'))?.equipmentDelay).toBe('Crane down');
  });

  it('before the SQL is run: reads still work (without the column)', async () => {
    mockHasColumn = false;
    const n = await fetchChecklistNotes('t');
    expect(n?.architect).toBe('Late dwgs');
    expect(n?.equipmentDelay).toBe('');
    expect(mockCalls).toHaveLength(2);
  });

  it('before the SQL is run: saving the other points still works', async () => {
    mockHasColumn = false;
    await saveChecklistNotes('t', { ...EMPTY_CHECKLIST_NOTES, architect: 'x' }, null);
    expect(mockCalls.map((c) => c.upsert && 'equipment_delay' in c.upsert)).toEqual([true, false]);
  });

  it('before the SQL is run: writing an Equipment delay says what is needed', async () => {
    mockHasColumn = false;
    await expect(saveChecklistNotes('t', { ...EMPTY_CHECKLIST_NOTES, equipmentDelay: 'Crane down' }, null)).rejects.toThrow(/database update/);
  });

  it('shows in the report reasons as "Equipment"', () => {
    const rows = sheetReportRows(
      [{ id: 'a', taskId: 'PT-01', taskName: 'A', workName: 'Civil Works', plannedStartDate: null, dueDate: null, actualStartDate: null, actualEndDate: null }],
      new Map([['a', { ...EMPTY_CHECKLIST_NOTES, equipmentDelay: 'Crane down' }]]),
      '2026-11-21'
    );
    expect(reasonEntries(rows[0])).toEqual([{ who: 'Equipment', text: 'Crane down' }]);
  });
});
