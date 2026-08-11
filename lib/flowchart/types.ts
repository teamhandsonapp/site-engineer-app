export type AccountabilityType = 'ACC' | 'ACV';
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type RelationshipType = 'PARALLEL' | DependencyType;

export interface FlowchartTask {
  id: string;
  taskId: string;
  taskName: string;
  description: string | null;
  plannedStartDate: string | null; // 'YYYY-MM-DD'
  dueDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  // The live/working schedule after an upstream task's real actual-date
  // delay cascaded through an FS link (admin-web: cascadePlannedDatesFromActualDelay) —
  // kept separate from plannedStartDate/dueDate above (the ORIGINAL plan),
  // same distinction admin-web's own Task model draws. Only used for the
  // delay chip's "→ target date" arrow when a task hasn't been marked done
  // yet — not for the main date-range chip, which always shows the original.
  currentPlannedStartDate: string | null;
  currentDueDate: string | null;
  cascadeDelayDays: number | null;
  accountabilityType: AccountabilityType | null; // task-level override
  workAccountabilityType: AccountabilityType | null; // resolved: task's own ?? work's default
  taskTypeId: string | null;
  workId: string | null;
  workName: string;
  manualPositionX: number | null;
  manualPositionY: number | null;
}

// Series link (task_dependencies) — a real, enforced ordering relationship.
export interface FlowchartSeriesEdge {
  id: string;
  taskId: string; // the blocked task
  dependsOnTaskId: string; // the prerequisite
  type: DependencyType;
}

// Parallel link (task_parallel_links) — symmetric, non-blocking, visual only.
export interface FlowchartParallelEdge {
  id: string;
  taskAId: string;
  taskBId: string;
}

export interface TaskTypeOption {
  id: string;
  name: string;
  defaultDurationDays: number;
}

export interface PositionedTask extends FlowchartTask {
  x: number;
  y: number;
}
