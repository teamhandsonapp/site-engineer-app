// Outlined groups on Flowchart 2 (2026-11-16): a labelled box drawn around
// several stacks. Listed by task code (department-wise IDs since 2026-11-16); the box is sized from wherever those
// tasks sit on the board, so moving a task moves the outline with it.

export interface BoardGroup {
  label: string;
  taskCodes: string[];
}

export const FLOWCHART_2_GROUPS: BoardGroup[] = [
  {
    // Hot Kitchen · Casting / Columns · Walls / Mezzanine · Wall No. 4 · Lift shaft
    label: 'Structural Civil Works',
    taskCodes: [
      'CIV-02', 'CIV-05', 'CIV-19', 'CIV-24', 'CIV-21', 'CIV-26', // Hot Kitchen
      'CIV-03', 'CIV-01', 'CIV-06', 'FAB-01', // Casting / Columns
      'CIV-07', 'CIV-08', 'CIV-12', 'CIV-17', 'CIV-29', 'CIV-49', // Walls / Mezzanine (+ RCC Folded Plate Staircase)
      'CIV-09', 'CIV-13', 'CIV-22', // Wall No. 4
      'CIV-04', 'CIV-10', 'CIV-23', 'CIV-27', 'CIV-31', 'CIV-37', // Lift shaft
    ],
  },
  {
    // Staff block column · South side · North side (below Roof erection)
    label: 'Civil works post roof erection',
    taskCodes: [
      'CIV-39', 'CIV-43', // Staff block, Wall No. 1
      'CIV-40', 'CIV-44', 'CIV-45', // South side
      'CIV-41', 'CIV-42', 'CIV-46', 'CIV-47', 'CIV-48', // North side
    ],
  },
  {
    // Ground Floor Internal Works · West side · East side · Toilet Works · Water body
    label: 'Parallel works',
    taskCodes: [
      'CIV-11', 'ELE-02', 'CIV-25', 'ELE-03', 'FLR-01', 'FLR-02', 'FLR-06',
      'CIV-14', 'ELE-01', 'CIV-20', 'PLB-01', 'CIV-32', 'CIV-35', 'ELE-07', 'FLR-03',
      'CIV-15', 'CIV-28', 'PLB-02', 'CIV-30', 'CIV-36', 'ELE-05', 'FLR-05',
      'CIV-16', 'CIV-18', 'PLB-03', 'PLB-04', 'CIV-38', 'FLR-04', 'WTB-01', 'CIV-33',
    ],
  },
];

/** The drawn outline: the group's tasks plus this padding (× nodeScale). */
export const GROUP_PAD = { x: 22, top: 62, bottom: 22 };

export function groupOutline(
  group: BoardGroup,
  tasks: { taskId: string; x: number; y: number }[],
  boxW: number,
  boxH: number,
  scale: number
): { left: number; top: number; width: number; height: number } | null {
  if (tasks.filter((t) => group.taskCodes.includes(t.taskId)).length < group.taskCodes.length) return null;
  const b = groupBounds(group, tasks, boxW, boxH);
  if (!b) return null;
  const px = GROUP_PAD.x * scale;
  const pt = GROUP_PAD.top * scale;
  const pb = GROUP_PAD.bottom * scale;
  return { left: b.left - px, top: b.top - pt, width: b.width + px * 2, height: b.height + pt + pb };
}

/** Outline rectangle around the group's tasks that are on screen (null if none are). */
export function groupBounds(
  group: BoardGroup,
  tasks: { taskId: string; x: number; y: number }[],
  boxW: number,
  boxH: number
): { left: number; top: number; width: number; height: number } | null {
  const inGroup = tasks.filter((t) => group.taskCodes.includes(t.taskId));
  if (inGroup.length === 0) return null;
  const minX = Math.min(...inGroup.map((t) => t.x));
  const minY = Math.min(...inGroup.map((t) => t.y));
  const maxX = Math.max(...inGroup.map((t) => t.x)) + boxW;
  const maxY = Math.max(...inGroup.map((t) => t.y)) + boxH;
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}
