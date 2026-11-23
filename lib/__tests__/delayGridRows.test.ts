// More than one delay per cause in the delay table (2026-11-23).
import { cellDays, cellNotes, DELAY_GRID_TABLES, rowCellId, tableRows } from '../flowchart/delayGrid';
import { stageCauses } from '../flowchart/milestoneReport';
import { EMPTY_CHECKLIST_NOTES } from '../flowchart/checklistNotes';

describe('delay table rows', () => {
  const grid = { 'contractor.workersShortage': 3, 'contractor.workersShortage#2': 2, 'drawings.mep#3': 4 };
  const notes = { 'contractor.workersShortage': 'Festival', 'contractor.workersShortage#2': 'Rain' };

  it('adds up every row of a cause and keeps the reasons in row order', () => {
    expect(rowCellId('contractor.workersShortage', 1)).toBe('contractor.workersShortage');
    expect(rowCellId('contractor.workersShortage', 2)).toBe('contractor.workersShortage#2');
    expect(cellDays(grid, 'contractor.workersShortage')).toBe(5);
    expect(cellDays(grid, 'contractor.workersDelay')).toBe(0);
    expect(cellNotes(notes, 'contractor.workersShortage')).toEqual(['Festival', 'Rain']);
  });

  it('counts the rows a table has', () => {
    const contractor = DELAY_GRID_TABLES.find((t) => t.key === 'contractor')!;
    const drawings = DELAY_GRID_TABLES.find((t) => t.key === 'drawings')!;
    expect(tableRows(contractor, grid, notes)).toBe(2);
    expect(tableRows(drawings, grid)).toBe(3);
  });

  it('reports one reason per cause with all rows added', () => {
    const causes = stageCauses({ ...EMPTY_CHECKLIST_NOTES, delayGrid: grid, delayGridNotes: notes });
    const shortage = causes.find((c) => c.id === 'grid:contractor.workersShortage')!;
    expect(shortage.days).toBe(5);
    expect(shortage.texts).toEqual(['Festival', 'Rain']);
    expect(causes.find((c) => c.id === 'grid:drawings.mep')!.days).toBe(4);
  });
});
