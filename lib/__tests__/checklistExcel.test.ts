jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../reports/generalParameterReport', () => ({ fetchBlockedDates: jest.fn() }));
import * as XLSX from 'xlsx';
import { buildChecklistWorkbook } from '../flowchart/excelExport';
import type { FlowchartTask } from '../flowchart/types';

const task = (id: string, dates: Partial<FlowchartTask>): FlowchartTask =>
  ({
    id,
    taskId: id,
    taskName: `Task ${id}`,
    workName: 'Civil Works',
    plannedStartDate: null,
    dueDate: null,
    actualStartDate: null,
    actualEndDate: null,
    manualPositionX: null,
    manualPositionY: null,
    ...dates,
  }) as FlowchartTask;

function sheetRows(tasks: FlowchartTask[]) {
  const book = buildChecklistWorkbook(tasks, new Map());
  return XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Checklist, { header: 1, raw: true, defval: '' });
}

describe('Checklist Excel (56 Tasks / Current Status)', () => {
  it('has Planned Start/End and Actual Start/End columns, in that order', () => {
    const [headers] = sheetRows([task('A', {})]);
    expect(headers.slice(3, 7)).toEqual(['Planned Start Date', 'Planned End Date', 'Actual Start Date', 'Actual End Date']);
  });

  it('fills the dates a task has and leaves the rest empty', () => {
    const [, full, partial, none] = sheetRows([
      task('A', { plannedStartDate: '2026-10-24', dueDate: '2026-10-28', actualStartDate: '2026-10-27', actualEndDate: '2026-11-02', manualPositionY: 1 }),
      task('B', { plannedStartDate: '2026-11-04', dueDate: '2026-11-07', actualStartDate: '2026-11-05', manualPositionY: 2 }),
      task('C', { manualPositionY: 3 }),
    ]);
    const day = (v: unknown) => (v instanceof Date ? `${v.getFullYear()}-${v.getMonth() + 1}-${v.getDate()}` : v);
    expect(full.slice(3, 7).map(day)).toEqual(['2026-10-24', '2026-10-28', '2026-10-27', '2026-11-2']);
    expect(partial.slice(3, 7).map(day)).toEqual(['2026-11-4', '2026-11-7', '2026-11-5', '']);
    expect(none.slice(3, 7)).toEqual(['', '', '', '']);
  });
});
