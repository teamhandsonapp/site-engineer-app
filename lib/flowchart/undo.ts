import { supabase } from '../supabase';
import {
  updateTaskName,
  updateTaskWork,
  updateTaskPlannedDates,
  updateTaskActualDate,
  updateTaskType,
  updateTaskAccountabilityType,
  updateTaskRoomType,
  updateTaskFloorLevel,
} from './data';
import type { AccountabilityType, DependencyType, FlowchartParallelEdge, FlowchartSeriesEdge } from './types';

// ─── Task field edits (TaskDetailSheet's "Save Changes") ──────────────────

export interface EditableTaskFields {
  taskName: string;
  workId: string;
  plannedStartDate: string | null;
  dueDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  taskTypeId: string | null;
  accountabilityType: AccountabilityType | null;
  roomType: string | null;
  floorLevel: string | null;
}

// Diffs two full field snapshots and calls only the update...() functions
// whose value actually changed — the one place that knows "which DB call
// each field maps to," shared by the original Save action (from = the
// task's fields when the sheet opened, to = the form's fields) and by
// undo/redo (undo diffs after -> before, redo diffs before -> after).
export async function applyTaskFieldChanges(
  taskId: string,
  from: EditableTaskFields,
  to: EditableTaskFields
): Promise<void> {
  if (to.taskName !== from.taskName) await updateTaskName(taskId, to.taskName);
  if (to.workId !== from.workId) await updateTaskWork(taskId, to.workId);
  if (to.plannedStartDate !== from.plannedStartDate || to.dueDate !== from.dueDate) {
    await updateTaskPlannedDates(taskId, to.plannedStartDate, to.dueDate);
  }
  if (to.actualStartDate !== from.actualStartDate) {
    await updateTaskActualDate(taskId, 'actual_start_date', to.actualStartDate);
  }
  if (to.actualEndDate !== from.actualEndDate) {
    await updateTaskActualDate(taskId, 'actual_end_date', to.actualEndDate);
  }
  if (to.taskTypeId !== from.taskTypeId) await updateTaskType(taskId, to.taskTypeId);
  if (to.accountabilityType !== from.accountabilityType) await updateTaskAccountabilityType(taskId, to.accountabilityType);
  if (to.roomType !== from.roomType) await updateTaskRoomType(taskId, to.roomType);
  if (to.floorLevel !== from.floorLevel) await updateTaskFloorLevel(taskId, to.floorLevel);
}

export function editableFieldsEqual(a: EditableTaskFields, b: EditableTaskFields): boolean {
  return (
    a.taskName === b.taskName &&
    a.workId === b.workId &&
    a.plannedStartDate === b.plannedStartDate &&
    a.dueDate === b.dueDate &&
    a.actualStartDate === b.actualStartDate &&
    a.actualEndDate === b.actualEndDate &&
    a.taskTypeId === b.taskTypeId &&
    a.accountabilityType === b.accountabilityType &&
    a.roomType === b.roomType &&
    a.floorLevel === b.floorLevel
  );
}

// ─── Task delete/restore ───────────────────────────────────────────────────

// Raw (snake_case) rows, straight off `select('*')` — deliberately NOT
// mapped into this app's usual camelCase shapes, since the whole point is
// to re-`insert()` these exact objects unchanged on restore (PostgREST
// accepts the same column names either way), with every original id,
// timestamp, and foreign key preserved bit-for-bit rather than recreated.
export interface TaskDeleteSnapshot {
  task: Record<string, unknown>;
  dependencyItems: Record<string, unknown>[];
  completions: Record<string, unknown>[];
  statusHistory: Record<string, unknown>[];
  comments: Record<string, unknown>[];
  drawingRevisions: Record<string, unknown>[];
  seriesLinks: Record<string, unknown>[];
  parallelLinks: Record<string, unknown>[];
}

// Captures everything needed to fully restore a task after deleteTask()'s
// real, cascading hard delete — MUST be called before that delete, never
// after (the cascade removes all of this at the DB level the moment the
// task row itself is deleted). Deliberately scoped to the flowchart/
// checklist domain — the task row, its checklist items, their completions/
// status history/comments/drawing revisions, and any series/parallel link
// referencing it — NOT sft_progress_entries, daily_progress_reports, or
// activity_logs, which belong to separate tracking features or are logs
// rather than user-entered content; restoring those is out of scope for
// "undo a flowchart edit."
export async function captureTaskDeleteSnapshot(taskId: string): Promise<TaskDeleteSnapshot> {
  const [taskRes, itemsRes, seriesRes, parallelRes] = await Promise.all([
    supabase.from('tasks').select('*').eq('id', taskId).single(),
    supabase.from('dependency_items').select('*').eq('task_id', taskId),
    supabase.from('task_dependencies').select('*').or(`task_id.eq.${taskId},depends_on_task_id.eq.${taskId}`),
    supabase.from('task_parallel_links').select('*').or(`task_a_id.eq.${taskId},task_b_id.eq.${taskId}`),
  ]);
  if (taskRes.error) throw new Error(taskRes.error.message);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (seriesRes.error) throw new Error(seriesRes.error.message);
  if (parallelRes.error) throw new Error(parallelRes.error.message);

  const dependencyItems = (itemsRes.data ?? []) as Record<string, unknown>[];
  const itemIds = dependencyItems.map((i) => i.id as string);

  let completions: Record<string, unknown>[] = [];
  let statusHistory: Record<string, unknown>[] = [];
  let comments: Record<string, unknown>[] = [];
  let drawingRevisions: Record<string, unknown>[] = [];

  if (itemIds.length > 0) {
    const [completionsRes, historyRes, commentsRes, revisionsRes] = await Promise.all([
      supabase.from('dependency_completions').select('*').in('item_id', itemIds),
      supabase.from('dependency_status_history').select('*').in('dependency_item_id', itemIds),
      supabase.from('comments').select('*').in('dependency_item_id', itemIds),
      supabase.from('drawing_revisions').select('*').in('dependency_item_id', itemIds),
    ]);
    if (completionsRes.error) throw new Error(completionsRes.error.message);
    if (historyRes.error) throw new Error(historyRes.error.message);
    if (commentsRes.error) throw new Error(commentsRes.error.message);
    if (revisionsRes.error) throw new Error(revisionsRes.error.message);
    completions = completionsRes.data ?? [];
    statusHistory = historyRes.data ?? [];
    comments = commentsRes.data ?? [];
    drawingRevisions = revisionsRes.data ?? [];
  }

  return {
    task: taskRes.data as Record<string, unknown>,
    dependencyItems,
    completions,
    statusHistory,
    comments,
    drawingRevisions,
    seriesLinks: (seriesRes.data ?? []) as Record<string, unknown>[],
    parallelLinks: (parallelRes.data ?? []) as Record<string, unknown>[],
  };
}

// Re-inserts everything captured above, in FK-safe order, preserving every
// original id/timestamp — so the restored task is bit-for-bit what was
// deleted, not a same-content-different-id copy, and any comment reply
// still points at the right parent.
export async function restoreTaskFromSnapshot(snapshot: TaskDeleteSnapshot): Promise<void> {
  const { error: taskErr } = await supabase.from('tasks').insert(snapshot.task);
  if (taskErr) throw new Error(taskErr.message);

  if (snapshot.dependencyItems.length > 0) {
    const { error } = await supabase.from('dependency_items').insert(snapshot.dependencyItems);
    if (error) throw new Error(error.message);
  }
  if (snapshot.completions.length > 0) {
    const { error } = await supabase.from('dependency_completions').insert(snapshot.completions);
    if (error) throw new Error(error.message);
  }
  if (snapshot.statusHistory.length > 0) {
    const { error } = await supabase.from('dependency_status_history').insert(snapshot.statusHistory);
    if (error) throw new Error(error.message);
  }
  // Comments can self-reference (parent_comment_id) — top-level first, then
  // replies, so a reply's parent always already exists when it's inserted.
  if (snapshot.comments.length > 0) {
    const topLevel = snapshot.comments.filter((c) => !c.parent_comment_id);
    const replies = snapshot.comments.filter((c) => c.parent_comment_id);
    if (topLevel.length > 0) {
      const { error } = await supabase.from('comments').insert(topLevel);
      if (error) throw new Error(error.message);
    }
    if (replies.length > 0) {
      const { error } = await supabase.from('comments').insert(replies);
      if (error) throw new Error(error.message);
    }
  }
  if (snapshot.drawingRevisions.length > 0) {
    const { error } = await supabase.from('drawing_revisions').insert(snapshot.drawingRevisions);
    if (error) throw new Error(error.message);
  }
  if (snapshot.seriesLinks.length > 0) {
    const { error } = await supabase.from('task_dependencies').insert(snapshot.seriesLinks);
    if (error) throw new Error(error.message);
  }
  if (snapshot.parallelLinks.length > 0) {
    const { error } = await supabase.from('task_parallel_links').insert(snapshot.parallelLinks);
    if (error) throw new Error(error.message);
  }
}

// Local-state-only counterparts to restoreTaskFromSnapshot — the canvas's
// own seriesEdges/parallelEdges arrays use the app's normal camelCase
// shape, not the raw snapshot rows just inserted above.
export function seriesEdgesFromSnapshot(snapshot: TaskDeleteSnapshot): FlowchartSeriesEdge[] {
  return snapshot.seriesLinks.map((r) => ({
    id: r.id as string,
    taskId: r.task_id as string,
    dependsOnTaskId: r.depends_on_task_id as string,
    type: r.type as DependencyType,
  }));
}

export function parallelEdgesFromSnapshot(snapshot: TaskDeleteSnapshot): FlowchartParallelEdge[] {
  return snapshot.parallelLinks.map((r) => ({
    id: r.id as string,
    taskAId: r.task_a_id as string,
    taskBId: r.task_b_id as string,
  }));
}

// ─── Undo/redo history stack ───────────────────────────────────────────────

export const MAX_HISTORY_DEPTH = 20;

export type UndoableAction =
  // before/after are REAL (uncompressed, admin-web-space) coordinates — the
  // same values written to manual_position_x/y, NOT the canvas's
  // compressed-for-display x/y (see lib/flowchart/layout.ts's own comment
  // on why those two spaces are kept separate).
  | { type: 'move'; taskId: string; before: { x: number; y: number }; after: { x: number; y: number } }
  | { type: 'editTask'; taskId: string; before: EditableTaskFields; after: EditableTaskFields }
  | { type: 'deleteTask'; taskId: string; snapshot: TaskDeleteSnapshot }
  | { type: 'createSeriesLink'; taskId: string; dependsOnTaskId: string; linkType: DependencyType }
  | { type: 'createParallelLink'; taskAId: string; taskBId: string }
  | { type: 'deleteSeriesLink'; taskId: string; dependsOnTaskId: string; linkType: DependencyType }
  | { type: 'deleteParallelLink'; taskAId: string; taskBId: string };
