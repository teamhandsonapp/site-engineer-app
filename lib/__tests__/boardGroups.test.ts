import { GROUP_MIN_GAP, GROUP_PAD, groupOutlines, type BoardGroup } from '../flowchart/boardGroups';

// Two groups standing side by side, like "Structural Civil Works" | "Parallel works".
const LEFT: BoardGroup = { label: 'Left', taskCodes: ['A1', 'A2'] };
const RIGHT: BoardGroup = { label: 'Right', taskCodes: ['B1', 'B2'] };
const W = 240;
const H = 128;

function tasksWithGap(gap: number) {
  return [
    { taskId: 'A1', x: 0, y: 0 },
    { taskId: 'A2', x: 0, y: 200 },
    { taskId: 'B1', x: W + gap, y: 0 },
    { taskId: 'B2', x: W + gap, y: 200 },
  ];
}

describe('groupOutlines', () => {
  it('keeps a clear gap between side-by-side outlines whose columns are close', () => {
    const [a, b] = groupOutlines([LEFT, RIGHT], tasksWithGap(50), W, H, 1);
    expect(a && b).toBeTruthy();
    const gap = b!.left - (a!.left + a!.width);
    expect(gap).toBeGreaterThanOrEqual(GROUP_MIN_GAP - 0.001);
    // Facing edges still clear their own boxes.
    expect(a!.left + a!.width).toBeGreaterThan(W);
    expect(b!.left).toBeLessThan(W + 50);
  });

  it('leaves outlines alone when the columns are already far apart', () => {
    const [a, b] = groupOutlines([LEFT, RIGHT], tasksWithGap(200), W, H, 1);
    expect(a!.left + a!.width).toBe(W + GROUP_PAD.x);
    expect(b!.left).toBe(W + 200 - GROUP_PAD.x);
  });

  it('keeps the outer edges at the normal padding', () => {
    const [a, b] = groupOutlines([LEFT, RIGHT], tasksWithGap(50), W, H, 1);
    expect(a!.left).toBe(-GROUP_PAD.x);
    expect(b!.left + b!.width).toBe(W + 50 + W + GROUP_PAD.x);
  });
});
