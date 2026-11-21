import { PAST_MILESTONES, pastMilestoneLabel } from '../flowchart/pastMilestones';

describe('Past Tasks report milestones', () => {
  it('has the 4 client milestones in order, 58 tasks, each task in one milestone only', () => {
    expect(PAST_MILESTONES.map((m) => [m.name, m.taskCodes.length])).toEqual([
      ['+3\'-6" slab', 16],
      ['Mezzanine slab', 9],
      ['PCC works', 12],
      ['Roof beam', 21],
    ]);
    const all = PAST_MILESTONES.flatMap((m) => m.taskCodes);
    expect(new Set(all).size).toBe(58);
  });
  it('labels them Milestone 1–4', () => {
    expect(pastMilestoneLabel('PCC works')).toBe('Milestone 3 – PCC works');
  });
});

jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
// eslint-disable-next-line import/first
import { sheetReportHtml } from '../flowchart/sheetReport';

describe('milestone report PDF header', () => {
  it('shows the milestone on its own line right under the main title', () => {
    const html = sheetReportHtml([], 'ROAST @ Kokapet', 'All tasks', null, null, null, null, 'Milestone 1 – +3\'-6" slab');
    expect(html).toMatch(/<h1>ROAST @ Kokapet — Project Status<\/h1><div class="ms">Milestone 1 – \+3'-6&quot;? slab<\/div>|<h1>ROAST @ Kokapet — Project Status<\/h1><div class="ms">Milestone 1 – \+3'-6" slab<\/div>/);
  });
  it('has no milestone line when none is picked', () => {
    expect(sheetReportHtml([], 'ROAST @ Kokapet', 'All tasks')).not.toContain('class="ms"');
  });
});

// eslint-disable-next-line import/first
import { reportFileName } from '../flowchart/sheetReport';

describe('milestone report file name', () => {
  const day = new Date(2026, 10, 21);
  it('names the PDF after the milestone', () => {
    expect(reportFileName('ROAST @ Kokapet', null, 'All', [], 'Milestone 1 – +3\'-6" slab', day)).toBe("ROAST @ Kokapet - Milestone 1 - +3'-6 slab Report - 21 Nov 2026");
    expect(reportFileName('ROAST @ Kokapet', 'Architect', 'Completed', [], 'Milestone 4 – Roof beam', day)).toBe('ROAST @ Kokapet - Milestone 4 - Roof beam Report - Architect - Completed Tasks - 21 Nov 2026');
  });
  it('keeps the old name without a milestone', () => {
    expect(reportFileName('ROAST @ Kokapet', null, 'All', [], null, day)).toBe('ROAST @ Kokapet - Project Status - All Tasks Dependencies - 21 Nov 2026');
  });
});
