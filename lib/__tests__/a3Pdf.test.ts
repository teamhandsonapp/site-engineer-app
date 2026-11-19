jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
import { buildFlowchartA3Html } from '../flowchart/a3Pdf';
import type { FlowchartTask } from '../flowchart/types';

const task = (taskId: string, x: number, y: number): FlowchartTask =>
  ({
    id: `uuid-${taskId}`,
    taskId,
    taskName: `Task ${taskId}`,
    workName: 'Civil Works',
    plannedStartDate: '2026-11-01',
    dueDate: '2026-11-05',
    actualStartDate: null,
    actualEndDate: null,
    manualPositionX: x,
    manualPositionY: y,
  }) as unknown as FlowchartTask;

describe('A3 flowchart PDF', () => {
  it('prints every task ID on its card, across all pages', () => {
    // 14 columns → split over more than one A3 page.
    const tasks = Array.from({ length: 14 }, (_, i) => task(`CIV-${String(i + 1).padStart(2, '0')}`, i * 231, 0));
    const html = buildFlowchartA3Html(tasks, [], 'ROAST — Current Status');
    expect(html).toContain('Page 1 of');
    for (const t of tasks) expect(html).toContain(`>${t.taskId}</div>`);
  });

  it('leaves the ID out when a task has none', () => {
    const html = buildFlowchartA3Html([task('', 0, 0)], [], 'X');
    expect(html).not.toContain('class="tid"');
  });
});
