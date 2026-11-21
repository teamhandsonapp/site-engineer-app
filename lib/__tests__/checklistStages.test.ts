jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
import { EMPTY_CHECKLIST_NOTES, isMissingTableError, type ChecklistNotes } from '../flowchart/checklistNotes';
import { asConstructionRows, sheetReportHtml, sheetReportRows, summarizeReport } from '../flowchart/sheetReport';

// Past Tasks (2026-11-21): Pre-construction and Construction delays are
// written and reported separately.
const task = (id: string, code: string) => ({
  id,
  taskId: code,
  taskName: `Task ${code}`,
  workName: 'Civil Works',
  plannedStartDate: '2026-09-01',
  dueDate: '2026-09-05',
  actualStartDate: null,
  actualEndDate: null,
});
const notes = (n: Partial<ChecklistNotes>): ChecklistNotes => ({ ...EMPTY_CHECKLIST_NOTES, ...n });

describe('checklist stages in the report', () => {
  const tasks = [task('a', 'PT-01'), task('b', 'PT-02')];
  const pre = new Map([['a', notes({ architect: 'Drawings late' })]]);
  const construction = new Map([['b', notes({ contractorDelay: 'Labour shortage' })]]);

  it('keeps the two stages apart', () => {
    const rows = sheetReportRows(tasks, pre, '2026-11-21', construction);
    const preWho = summarizeReport(rows).reasons.map((r) => r.who);
    const conWho = summarizeReport(asConstructionRows(rows)).reasons.map((r) => r.who);
    expect(preWho).toEqual(['Architect']);
    expect(conWho).toEqual(['Civil contractor — Workers']);
  });

  it('no construction map → rows exactly as before', () => {
    const rows = sheetReportRows(tasks, pre, '2026-11-21');
    expect(rows.every((r) => !('constructionNotes' in r))).toBe(true);
  });

  it('PDF has separate Pre-construction and Construction sections', () => {
    const rows = sheetReportRows(tasks, pre, '2026-11-21', construction);
    const html = sheetReportHtml(rows, 'P', 'All', null, null, null, asConstructionRows(rows));
    expect(html).toContain('Pre-construction — Dependencies for');
    expect(html).toContain('Construction — Dependencies for');
    expect(html).toContain('Labour shortage');
    // Other boards: unchanged titles.
    expect(sheetReportHtml(rows, 'P', 'All')).not.toContain('Pre-construction —');
  });

  it('recognises "table not set up yet"', () => {
    expect(isMissingTableError({ code: 'PGRST205', message: "Could not find the table 'public.task_construction_notes'" })).toBe(true);
    expect(isMissingTableError({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});
