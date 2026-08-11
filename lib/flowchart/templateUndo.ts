import { supabase } from '../supabase';
import {
  createTemplateParallelLink,
  createTemplateSeriesLink,
  deleteTemplateLink,
  updateTemplateTaskFields,
  type TemplateTaskFields,
} from './templateData';
import type { TemplateParallelEdge, TemplateSeriesEdge } from './templateTypes';

// A direct sibling of undo.ts (real flowchart) — same shape, same
// reasoning, applied to template_tasks/template_links instead of tasks/
// task_dependencies/task_parallel_links. Deliberately simpler in one place:
// a template task has no checklist/comments/drawing-revisions to snapshot,
// so deleteTask's restore only needs the task row itself plus whichever
// links referenced it, not the multi-table capture real deleteTask needs.

export async function applyTemplateTaskFieldChanges(
  templateTaskId: string,
  from: TemplateTaskFields,
  to: TemplateTaskFields
): Promise<void> {
  if (
    to.taskName !== from.taskName ||
    to.workName !== from.workName ||
    to.trackLabel !== from.trackLabel ||
    to.dayOffsetStart !== from.dayOffsetStart ||
    to.dayOffsetEnd !== from.dayOffsetEnd
  ) {
    await updateTemplateTaskFields(templateTaskId, to);
  }
}

export function templateFieldsEqual(a: TemplateTaskFields, b: TemplateTaskFields): boolean {
  return (
    a.taskName === b.taskName &&
    a.workName === b.workName &&
    a.trackLabel === b.trackLabel &&
    a.dayOffsetStart === b.dayOffsetStart &&
    a.dayOffsetEnd === b.dayOffsetEnd
  );
}

export interface TemplateTaskDeleteSnapshot {
  task: Record<string, unknown>;
  links: Record<string, unknown>[];
}

export async function captureTemplateTaskDeleteSnapshot(templateTaskId: string): Promise<TemplateTaskDeleteSnapshot> {
  const [taskRes, linksRes] = await Promise.all([
    supabase.from('template_tasks').select('*').eq('id', templateTaskId).single(),
    supabase.from('template_links').select('*').or(`from_template_task_id.eq.${templateTaskId},to_template_task_id.eq.${templateTaskId}`),
  ]);
  if (taskRes.error) throw new Error(taskRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);
  return { task: taskRes.data as Record<string, unknown>, links: (linksRes.data ?? []) as Record<string, unknown>[] };
}

export async function restoreTemplateTaskFromSnapshot(snapshot: TemplateTaskDeleteSnapshot): Promise<void> {
  const { error: taskErr } = await supabase.from('template_tasks').insert(snapshot.task);
  if (taskErr) throw new Error(taskErr.message);
  if (snapshot.links.length > 0) {
    const { error } = await supabase.from('template_links').insert(snapshot.links);
    if (error) throw new Error(error.message);
  }
}

export function templateSeriesEdgesFromSnapshot(snapshot: TemplateTaskDeleteSnapshot): TemplateSeriesEdge[] {
  return snapshot.links
    .filter((r) => r.link_type !== 'PARALLEL')
    .map((r) => ({ id: r.id as string, taskId: r.to_template_task_id as string, dependsOnTaskId: r.from_template_task_id as string, type: r.link_type as 'FS' | 'SS' | 'FF' | 'SF' }));
}

export function templateParallelEdgesFromSnapshot(snapshot: TemplateTaskDeleteSnapshot): TemplateParallelEdge[] {
  return snapshot.links
    .filter((r) => r.link_type === 'PARALLEL')
    .map((r) => ({ id: r.id as string, taskAId: r.from_template_task_id as string, taskBId: r.to_template_task_id as string }));
}

export const MAX_HISTORY_DEPTH = 20;

export type TemplateUndoableAction =
  | { type: 'move'; taskId: string; before: { x: number; y: number }; after: { x: number; y: number } }
  | { type: 'editTask'; taskId: string; before: TemplateTaskFields; after: TemplateTaskFields }
  | { type: 'deleteTask'; taskId: string; snapshot: TemplateTaskDeleteSnapshot }
  | { type: 'createSeriesLink'; taskId: string; dependsOnTaskId: string; linkType: 'FS' | 'SS' | 'FF' | 'SF' }
  | { type: 'createParallelLink'; taskAId: string; taskBId: string }
  | { type: 'deleteSeriesLink'; taskId: string; dependsOnTaskId: string; linkType: 'FS' | 'SS' | 'FF' | 'SF' }
  | { type: 'deleteParallelLink'; taskAId: string; taskBId: string };

// Re-exported so FlowchartCanvas-equivalent callers don't need a second
// import for these — same convention as the real undo.ts's own exports.
export { createTemplateParallelLink, createTemplateSeriesLink, deleteTemplateLink };
