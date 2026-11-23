jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
import { EMPTY_CHECKLIST_NOTES, type ChecklistNotes } from '../flowchart/checklistNotes';
import {
  asConstructionRows,
  hasAnyReason,
  partyRowsStaged,
  reportParties,
  sheetReportHtml,
  sheetReportRows,
  stagedWaitingOn,
} from '../flowchart/sheetReport';

// Past Works report (2026-11-21, client): every task (Past Tasks + the copied
// Current Status tasks); a task with both Pre-construction and Construction
// delays shows them separately everywhere.
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

const tasks = [task('both', 'PT-20'), task('pre', 'PT-21'), task('con', 'CIV-07'), task('none', 'CIV-08')];
const pre = new Map([
  ['both', notes({ architect: 'Drawings late' })],
  ['pre', notes({ architect: 'Revised GFC' })],
]);
const construction = new Map([
  ['both', notes({ contractorDelay: 'Labour shortage' })],
  ['con', notes({ leadTime: 'Concrete Supply Delayed' })],
]);
const rows = sheetReportRows(tasks, pre, '2026-11-21', construction);

describe('Past Works report: Pre-construction and Construction separately', () => {
  it('status box "waiting on": each stage counted on its own, then no reason in either', () => {
    const w = stagedWaitingOn(rows);
    expect(w.pre).toEqual([{ who: 'Architect', tasks: 2 }]);
    expect(w.construction.map((x) => x.who).sort()).toEqual(['Civil contractor — Workers', 'Material Procurement Status']);
    expect(w.none).toBe(1); // only CIV-08
    // A task with a Construction reason only is NOT "no reason".
    expect(hasAnyReason(rows.find((r) => r.taskCode === 'CIV-07')!)).toBe(true);
  });

  it('REPORT FOR lists people from both stages', () => {
    expect(reportParties(rows)).toEqual(expect.arrayContaining(['Architect', 'Civil contractor — Workers', 'Material Procurement Status']));
  });

  it('party report keeps that party in each stage separately', () => {
    const workers = partyRowsStaged(rows, 'Civil contractor — Workers');
    expect(workers.map((r) => r.taskCode)).toEqual(['PT-20']);
    expect(workers[0].notes.architect).toBe(''); // Pre-construction: Architect dropped
    expect(workers[0].constructionNotes!.contractorDelay).toBe('Labour shortage');
  });

  it('PDF status boxes show the two stages under their own headings', () => {
    const html = sheetReportHtml(rows, 'P', 'All', null, null, null, asConstructionRows(rows));
    expect(html).toContain('<div class="wst">Pre-construction delays</div>');
    expect(html).toContain('<div class="wst">Construction delays</div>');
    expect(html).toContain('Construction — Dependencies for');
  });
});
