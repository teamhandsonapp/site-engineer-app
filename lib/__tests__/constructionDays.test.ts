jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../supabase', () => ({ supabase: {} }));
import { constructionDaysOnce, overrunDays } from '../flowchart/constructionDays';
import { EMPTY_CHECKLIST_NOTES } from '../flowchart/checklistNotes';

const row = (taskCode: string, plannedStart: string, plannedEnd: string, actualStart: string, actualEnd: string, grid: Record<string, number> = {}) => ({
  taskCode,
  department: 'Civil Works',
  plannedStart,
  plannedEnd,
  actualStart,
  actualEnd,
  constructionNotes: { ...EMPTY_CHECKLIST_NOTES, ...(Object.keys(grid).length ? { delayGrid: grid } : {}) },
});

// Completed Tasks, 28 Jul – 24 Sep 2026 (client, 2026-11-25): 19 days, not 37.
const ROWS = [
  row('PTC-16', '2026-08-14', '2026-08-18', '2026-08-16', '2026-08-21', { 'contractor.workersDelay': 1 }),
  row('PTC-18', '2026-08-19', '2026-08-24', '2026-08-22', '2026-09-01', { 'contractor.procurementDelay': 5 }),
  row('PTC-19', '2026-08-19', '2026-08-24', '2026-08-22', '2026-09-01', { 'contractor.procurementDelay': 5 }),
  row('PTC-20', '2026-08-20', '2026-08-24', '2026-09-04', '2026-09-20', { 'contractor.procurementDelay': 12 }),
  row('PTC-21', '2026-09-15', '2026-09-19', '2026-09-05', '2026-09-14'),
  row('PTC-22', '2026-08-18', '2026-08-22', '2026-09-15', '2026-09-21'),
  row('PTC-23', '2026-08-19', '2026-08-23', '2026-09-16', '2026-09-21'),
  row('PTC-24', '2026-08-25', '2026-09-02', '2026-09-24', '2026-10-21', { 'contractor.procurementDelay': 19 }),
];

test('extra days are the last days of the actual work', () => {
  expect(overrunDays(ROWS[0])).toEqual(['2026-08-21']);
  expect(overrunDays(ROWS[4])).toHaveLength(5);
});

test('same days counted once, only days inside the range', () => {
  const r = constructionDaysOnce(ROWS, '2026-07-28', '2026-09-24');
  expect(r.total).toBe(19);
  expect(r.given).toBe(42);
  expect(r.allDelays.reduce((a, d) => a + (d.days ?? 0), 0)).toBe(19);
  expect(r.byTask).toEqual({ 'PTC-16': 1, 'PTC-18': 5, 'PTC-20': 12, 'PTC-22': 1 });
});

test('no range: PTC-24 October days count too', () => {
  expect(constructionDaysOnce(ROWS, null, null).total).toBe(38);
});

// Pre-construction, same dates (client, 2026-11-25): 50 days — every entry added.
test('pre-construction: days entered, all tasks added, with delay from task above', () => {
  const { preDaysAsEntered } = require('../flowchart/constructionDays');
  const pre = (taskCode: string, actualStart: string, actualEnd: string, grid: Record<string, number>) => ({
    taskCode, department: 'Civil Works', plannedStart: '2026-08-14', plannedEnd: '2026-08-18', actualStart, actualEnd,
    notes: { ...EMPTY_CHECKLIST_NOTES, delayGrid: grid },
  });
  const r = preDaysAsEntered([
    pre('PTC-16', '2026-08-16', '2026-08-21', { 'contractor.workersDelay': 2 }),
    pre('PTC-18', '2026-08-22', '2026-09-01', { 'contractor.workersDelay': 3 }),
    pre('PTC-19', '2026-08-22', '2026-09-01', { 'contractor.workersShortage': 3 }),
    pre('PTC-20', '2026-09-04', '2026-09-20', { 'previous.above': 5, 'contractor.workersShortage': 10 }),
    pre('PTC-24', '2026-09-24', '2026-10-21', { 'contractor.equipmentDelay': 20, 'contractor.procurementDelay': 7 }),
  ]);
  expect(r.total).toBe(50);
  expect(r.allDelays.find((d: { label: string }) => d.label === 'Delay from task above').days).toBe(5);
});

// ─── Milestone rule (2026-11-27, client) ────────────────────────────────────
// "For a milestone of 10 tasks, take their total working days in the pre-construction
// and construction phases; the report shows those days even if no reason is given."
import { lineDelays } from '../flowchart/constructionDays';

const task = (taskCode: string, ps: string, pe: string, as: string | null, ae: string | null, conGrid: Record<string, number> = {}) => ({
  taskCode,
  department: 'Civil Works',
  plannedStart: ps,
  plannedEnd: pe,
  actualStart: as,
  actualEnd: ae,
  notes: { ...EMPTY_CHECKLIST_NOTES },
  constructionNotes: { ...EMPTY_CHECKLIST_NOTES, ...(Object.keys(conGrid).length ? { delayGrid: conGrid } : {}) },
});
// Level LL + L + ML, the 19 PTC tasks, real dates.
const LEVEL = [
  task('PTC-06', '2026-07-28', '2026-07-30', '2026-07-28', '2026-07-30'),
  task('PTC-09', '2026-08-03', '2026-08-10', '2026-08-03', '2026-08-10'),
  task('PTC-10', '2026-08-04', '2026-08-10', '2026-08-04', '2026-08-10'),
  task('PTC-12', '2026-08-04', '2026-08-10', '2026-08-04', '2026-08-10'),
  task('PTC-13', '2026-08-11', '2026-08-15', '2026-08-11', '2026-08-15'),
  task('PTC-16', '2026-08-14', '2026-08-18', '2026-08-16', '2026-08-21'),
  task('PTC-18', '2026-08-19', '2026-08-24', '2026-08-22', '2026-09-01', { 'contractor.procurementDelay': 5 }),
  task('PTC-19', '2026-08-19', '2026-08-24', '2026-08-22', '2026-09-01', { 'contractor.procurementDelay': 5 }),
  task('PTC-03', '2026-07-26', '2026-07-28', '2026-07-26', '2026-07-28'),
  task('PTC-08', '2026-07-26', '2026-08-02', '2026-07-26', '2026-08-02'),
  task('PTC-11', '2026-08-04', '2026-08-07', '2026-08-04', '2026-08-07'),
  task('PTC-14', '2026-08-12', '2026-08-15', '2026-08-12', '2026-08-15'),
  task('PTC-15', '2026-08-19', '2026-08-24', '2026-08-16', '2026-08-21'),
  task('PTC-20', '2026-08-20', '2026-08-24', '2026-09-04', '2026-09-20', { 'contractor.procurementDelay': 12 }),
  task('PTC-05', '2026-07-28', '2026-07-31', '2026-07-28', '2026-07-31'),
  task('PTC-07', '2026-07-28', '2026-08-01', '2026-07-28', '2026-08-01'),
  task('PTC-21', '2026-09-15', '2026-09-19', '2026-09-05', '2026-09-14'),
  task('PTC-23', '2026-08-19', '2026-08-23', '2026-09-16', '2026-09-21'),
  task('PTC-26', '2026-08-19', '2026-08-23', '2026-09-30', '2026-10-10'),
];

test('milestone: Sundays counted (2026-11-27), each late day once → 46 + 6 = 52 (not 134 added up)', () => {
  const l = lineDelays(LEVEL, null, '2026-11-27', true);
  expect([l.pre, l.con, l.total]).toEqual([46, 6, 52]);
});

test('milestone: reason rows always add up to the stage totals', () => {
  const l = lineDelays(LEVEL, null, '2026-11-27', true);
  const sum = (prefix: string) => l.allDelays.filter((d) => d.label.startsWith(prefix)).reduce((a, d) => a + (d.days ?? 0), 0);
  // 22 construction days were entered against reasons, but the phase is 6 days late.
  expect(sum('Const · ')).toBe(6);
  // No pre-construction reasons given at all: all 46 days still show.
  expect(sum('Pre-con · ')).toBe(46);
});

test('milestone: no reasons anywhere still gives the same totals', () => {
  const bare = LEVEL.map((r) => ({ ...r, constructionNotes: { ...EMPTY_CHECKLIST_NOTES } }));
  const l = lineDelays(bare, null, '2026-11-27', true);
  expect([l.pre, l.con, l.total]).toEqual([46, 6, 52]);
  expect(l.allDelays.reduce((a, d) => a + (d.days ?? 0), 0)).toBe(52);
});
