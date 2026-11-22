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

  it('Past Tasks: a tall stack gets normal-size cards, cut evenly across pages, links across the cut still shown', () => {
    // 22-card stack (y step 200, like the Date Order) + a Current Status card far below.
    const stack = Array.from({ length: 22 }, (_, i) => task(`PT-${String(i + 1).padStart(2, '0')}`, 0, i * 200));
    const civ = task('CIV-07', 0, 21 * 200 + 1600);
    const edges = [
      { id: 'cut', dependsOnTaskId: 'uuid-PT-11', taskId: 'uuid-PT-12', type: 'SS' as const },
      { id: 'bridge', dependsOnTaskId: 'uuid-PT-22', taskId: 'uuid-CIV-07', type: 'FS' as const },
    ];
    const html = buildFlowchartA3Html([...stack, civ], edges, 'Past', new Map(), { fillWidth: true, splitAtRowGap: true });
    expect(html).toContain('Page 3 of 3'); // 11 + 11 stack rows, then the copy
    expect((html.match(/11 tasks on this page/g) ?? []).length).toBe(2);
    // Normal card width (as on a full 6-column page), not stretched across the sheet.
    // (The Current Status page keeps its own sizing, so only the 22 stack cards.)
    const widths = [...html.matchAll(/class="card" style="[^"]*width:([\d.]+)px/g)].map((m) => Math.round(Number(m[1]))).slice(0, 22);
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBeLessThan(160);
    // Across a cut on the stack pages, the task on the other page is drawn as a
    // normal (dashed) card with the normal link — no text notes there.
    const ghosts = [...html.matchAll(/class="card ghost"[^>]*>(?:<div class="tid"[^>]*>([^<]+)<\/div>)<div class="pg"[^>]*>([^<]+)</g)].map((m) => `${m[1]} ${m[2]}`);
    expect(ghosts).toEqual(['PT-12 on page 2', 'PT-11 on page 1', 'CIV-07 on page 3']);
    const pageTwo = html.split('class="page"')[2];
    expect(pageTwo).not.toContain('class="xref"');
    expect(pageTwo).toContain('>SS</text>'); // PT-11 → PT-12 label
    // The Current Status page keeps its plain note + header line for PT-22.
    expect(html).toContain('FS ← PT-22 p.2');
    expect(html).toContain('Linked from other pages: PT-22 (p.2) → CIV-07, FS');
  });

  it('Date Order: a one-column group alone on its page (Glazing) prints normal-size cards, not stretched', () => {
    const top = Array.from({ length: 6 }, (_, i) => task(`PT-${i + 1}`, i * 231, 0));
    const glazing = [0, 1, 2].map((i) => task(`GLZ-0${i + 1}`, 0, 1600 + i * 200));
    const html = buildFlowchartA3Html([...top, ...glazing], [], 'Copy', new Map(), { fillWidth: true, splitAtRowGap: true });
    const last = html.split('class="page"').pop()!;
    const sizes = [...last.matchAll(/class="card" style="[^"]*top:([\d.]+)px;width:([\d.]+)px;height:([\d.]+)px/g)].map((m) => m.slice(1).map(Number));
    expect(sizes).toHaveLength(3);
    for (const [, w] of sizes) expect(w).toBeLessThan(160);
    // Packed at the top: card to card is about one card height, not a third of the sheet.
    expect(sizes[1][0] - sizes[0][0]).toBeLessThan(sizes[0][2] + 60);
  });

  it('leaves the ID out when a task has none', () => {
    const html = buildFlowchartA3Html([task('', 0, 0)], [], 'X');
    expect(html).not.toContain('class="tid"');
  });
});
