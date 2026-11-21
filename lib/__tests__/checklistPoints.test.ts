jest.mock('../supabase', () => ({ supabase: {} }));

import { joinPoints, pointsText, splitPoints } from '../flowchart/checklistNotes';

describe('checklist points (Past Works)', () => {
  it('reads an old single answer as one point', () => {
    expect(splitPoints('Concrete Supply Delayed')).toEqual(['Concrete Supply Delayed']);
    expect(splitPoints('')).toEqual([]);
    expect(splitPoints(null)).toEqual([]);
  });

  it('splits one point per line and drops blanks', () => {
    expect(splitPoints('Delay in Material supply\n\n  Shortage of work force  ')).toEqual(['Delay in Material supply', 'Shortage of work force']);
  });

  it('joins points one per line, dropping empty ones', () => {
    expect(joinPoints(['A', '', '  B  ', '   '])).toBe('A\nB');
    expect(joinPoints([])).toBe('');
  });

  it('round-trips', () => {
    const pts = ['Crane breakdown', 'Pump not available'];
    expect(splitPoints(joinPoints(pts))).toEqual(pts);
  });

  it('shows several points as a bullet list, one as it is', () => {
    expect(pointsText('Only one')).toBe('Only one');
    expect(pointsText('A\nB')).toBe('• A\n• B');
    expect(pointsText('')).toBe('');
  });
});
