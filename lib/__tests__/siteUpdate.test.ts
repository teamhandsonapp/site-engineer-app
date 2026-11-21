jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
import * as XLSX from 'xlsx';
import { buildSiteUpdateWorkbook, sheetDate, SITE_UPDATE } from '../siteUpdate';

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

describe('Site Update sheet', () => {
  it('has the 15 tasks of the 09 Sep sheet (7 + 8)', () => {
    expect(SITE_UPDATE.groups.map((g) => g.rows.length)).toEqual([7, 8]);
  });

  it('every "Delayed By" equals planned → estimated, as printed', () => {
    for (const row of SITE_UPDATE.groups.flatMap((g) => g.rows)) {
      expect(-days(row.planned, row.estimated)).toBe(row.delayedBy);
    }
  });

  it('shows dates like the sheet (dd/mm/yy)', () => {
    expect(sheetDate('2026-08-17')).toBe('17/08/26');
  });

  it('Excel: both groups, all rows, shared remark cell for rows 4–8 of group 2', () => {
    const sheet = buildSiteUpdateWorkbook().Sheets['Site Update'];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: true });
    const text = rows.map((r) => r.join('|')).join('\n');
    expect(text).toContain('Milestones for +3\'-6" TO -2\'-6" levels');
    expect(text).toContain('Roof beam casting');
    expect(text).toContain('TEAM HANDS ON PVT LTD (PMC)');
    const remarkMerges = (sheet['!merges'] ?? []).filter((m) => m.s.c === 5 && m.e.c === 5);
    expect(remarkMerges).toHaveLength(1);
    expect(remarkMerges[0].e.r - remarkMerges[0].s.r).toBe(4);
  });
});
