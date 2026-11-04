export type AccountabilityType = 'ACC' | 'ACV';
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type RelationshipType = 'PARALLEL' | DependencyType;

// Room Type / Floor Level — small fixed preset lists (plain text column on
// tasks, not a DB enum, see add-task-room-floor.sql), editable per task
// from TaskDetailSheet. Applies to any task, by explicit request, not just
// ROAST @ Kokapet's own milestone tasks — those are just the first ones
// seeded with a value.
export const ROOM_TYPE_PRESETS = [
  'Kitchen',
  'Dining/Seating Area',
  'Toilet/Washroom',
  'Staircase',
  'Storage',
  'Lobby/Corridor',
  'Terrace/Outdoor',
  'Other',
];

export const FLOOR_LEVEL_PRESETS = ['Basement', 'Ground Floor', 'Mezzanine Floor', 'First Floor', 'Roof/Terrace'];

// Shared full-name labels for the tap-task-then-tap-task link type prompt
// (both FlowchartCanvas and TemplateCanvas) — "Finish to Start" etc., the
// exact wording asked for, distinct from CreateTaskSheet's own more
// detailed explanatory LINK_TYPE_LABEL strings ("FS — blocks start until
// the other finishes") used in that separate at-creation-time picker.
export const DEPENDENCY_TYPE_FULL_LABEL: Record<DependencyType, string> = {
  FS: 'Finish to Start',
  SS: 'Start to Start',
  SF: 'Start to Finish',
  FF: 'Finish to Finish',
};

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
  roomType: string | null;
  floorLevel: string | null;
  milestoneId: string | null;
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
