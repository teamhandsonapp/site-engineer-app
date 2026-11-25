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
