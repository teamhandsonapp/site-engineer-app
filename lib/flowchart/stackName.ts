// Stack name (2026-11-16): the black heading over a flowchart column, e.g.
// "Toilet Works", so two "PCC works" tasks can be told apart in Sheet View
// and Reports. A task's stack = the nearest heading above it in its own
// column; if its column has none, the column just to its left (a heading
// box can span two columns, e.g. "West side"). Real board positions only.

const COLUMN_STEP = 231;

export function stackNames(
  tasks: { id: string; manualPositionX: number | null; manualPositionY: number | null; sectionTitle?: string | null }[]
): Map<string, string> {
  const heads = tasks.filter((t) => t.sectionTitle?.trim() && t.manualPositionX !== null && t.manualPositionY !== null);
  const headAbove = (x: number, y: number) =>
    heads
      .filter((h) => h.manualPositionX === x && h.manualPositionY! <= y)
      .sort((a, b) => b.manualPositionY! - a.manualPositionY!)[0];
  const out = new Map<string, string>();
  for (const t of tasks) {
    if (t.manualPositionX === null || t.manualPositionY === null) continue;
    const h = headAbove(t.manualPositionX, t.manualPositionY) ?? headAbove(t.manualPositionX - COLUMN_STEP, t.manualPositionY);
    if (h) out.set(t.id, h.sectionTitle!.trim());
  }
  return out;
}

/** "Toilet Works - PCC works", or just the task name when it has no stack. */
export function withStack(taskName: string, stack: string | undefined): string {
  return stack ? `${stack} - ${taskName.trim()}` : taskName.trim();
}
