import { supabase } from '../supabase';
import type { AccountabilityType, RelationshipType } from './types';
import type {
  PositionedTemplateTask,
  TemplateMeta,
  TemplateParallelEdge,
  TemplateSeriesEdge,
  TemplateTask,
} from './templateTypes';
import { layoutGeneric } from './layout';

interface RawTemplateTaskRow {
  id: string;
  track_label: string | null;
  task_name: string;
  work_name: string;
  day_offset_start: number;
  day_offset_end: number;
  sort_order: number;
  position_x: number | null;
  position_y: number | null;
  accountability_type: AccountabilityType | null;
}

const TEMPLATE_TASK_SELECT =
  'id, track_label, task_name, work_name, day_offset_start, day_offset_end, sort_order, position_x, position_y, accountability_type';

function toTemplateTask(r: RawTemplateTaskRow): TemplateTask {
  return {
    id: r.id,
    trackLabel: r.track_label,
    taskName: r.task_name,
    workName: r.work_name,
    dayOffsetStart: r.day_offset_start,
    dayOffsetEnd: r.day_offset_end,
    sortOrder: r.sort_order,
    manualPositionX: r.position_x,
    manualPositionY: r.position_y,
    accountabilityType: r.accountability_type,
  };
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  taskCount: number;
}

export async function fetchFlowchartTemplates(): Promise<TemplateSummary[]> {
  const { data, error } = await supabase
    .from('flowchart_templates')
    .select('id, name, description, created_at, template_tasks(id)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string; description: string | null; created_at: string; template_tasks: { id: string }[] | null }[])
    .map((t) => ({ id: t.id, name: t.name, description: t.description, createdAt: t.created_at, taskCount: t.template_tasks?.length ?? 0 }));
}

// Creates the shell row and returns its id — the caller (the Templates
// list screen) prompts for a required name up front now, so `name` here is
// always a real, non-empty value, never the old 'Untitled Template'
// fallback (that fallback still exists on updateTemplateInfo below, for a
// RENAME blanked out after the fact, which is a different situation).
export async function createTemplateShell(createdBy: string | null, name: string): Promise<TemplateMeta> {
  const { data, error } = await supabase
    .from('flowchart_templates')
    .insert({ name: name.trim(), description: null, created_by: createdBy })
    .select('id, name, description, created_at')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, name: data.name, description: data.description, createdAt: data.created_at };
}

export async function updateTemplateInfo(templateId: string, name: string, description: string | null): Promise<void> {
  const { error } = await supabase
    .from('flowchart_templates')
    .update({ name: name.trim() || 'Untitled Template', description: description?.trim() || null })
    .eq('id', templateId);
  if (error) throw new Error(error.message);
}

export async function deleteFlowchartTemplate(templateId: string): Promise<void> {
  const { error } = await supabase.from('flowchart_templates').delete().eq('id', templateId);
  if (error) throw new Error(error.message);
}

export interface TemplateEditorData {
  meta: TemplateMeta;
  tasks: TemplateTask[];
  seriesEdges: TemplateSeriesEdge[];
  parallelEdges: TemplateParallelEdge[];
}

export async function fetchTemplateForEditing(templateId: string): Promise<TemplateEditorData> {
  const [templateRes, tasksRes, linksRes] = await Promise.all([
    supabase.from('flowchart_templates').select('id, name, description, created_at').eq('id', templateId).single(),
    supabase
      .from('template_tasks')
      .select(TEMPLATE_TASK_SELECT)
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('template_links')
      .select('id, from_template_task_id, to_template_task_id, link_type')
      .eq('template_id', templateId),
  ]);
  if (templateRes.error) throw new Error(templateRes.error.message);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);

  const tasks = (tasksRes.data as RawTemplateTaskRow[]).map(toTemplateTask);
  const links = linksRes.data as { id: string; from_template_task_id: string; to_template_task_id: string; link_type: RelationshipType }[];

  const seriesEdges: TemplateSeriesEdge[] = links
    .filter((l) => l.link_type !== 'PARALLEL')
    .map((l) => ({ id: l.id, taskId: l.to_template_task_id, dependsOnTaskId: l.from_template_task_id, type: l.link_type as 'FS' | 'SS' | 'FF' | 'SF' }));
  const parallelEdges: TemplateParallelEdge[] = links
    .filter((l) => l.link_type === 'PARALLEL')
    .map((l) => ({ id: l.id, taskAId: l.from_template_task_id, taskBId: l.to_template_task_id }));

  return {
    meta: {
      id: templateRes.data.id,
      name: templateRes.data.name,
      description: templateRes.data.description,
      createdAt: templateRes.data.created_at,
    },
    tasks,
    seriesEdges,
    parallelEdges,
  };
}

export interface TemplateTaskFields {
  trackLabel: string | null;
  taskName: string;
  workName: string;
  dayOffsetStart: number;
  dayOffsetEnd: number;
  accountabilityType: AccountabilityType | null;
}

export async function createTemplateTask(
  templateId: string,
  input: TemplateTaskFields,
  existingCount: number
): Promise<TemplateTask> {
  const { data, error } = await supabase
    .from('template_tasks')
    .insert({
      template_id: templateId,
      track_label: input.trackLabel?.trim() || null,
      task_name: input.taskName.trim(),
      work_name: input.workName.trim(),
      day_offset_start: input.dayOffsetStart,
      day_offset_end: input.dayOffsetEnd,
      sort_order: existingCount,
      accountability_type: input.accountabilityType,
    })
    .select(TEMPLATE_TASK_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return toTemplateTask(data as RawTemplateTaskRow);
}

export async function updateTemplateTaskFields(templateTaskId: string, input: TemplateTaskFields): Promise<void> {
  const { error } = await supabase
    .from('template_tasks')
    .update({
      track_label: input.trackLabel?.trim() || null,
      task_name: input.taskName.trim(),
      work_name: input.workName.trim(),
      day_offset_start: input.dayOffsetStart,
      day_offset_end: input.dayOffsetEnd,
      accountability_type: input.accountabilityType,
    })
    .eq('id', templateTaskId);
  if (error) throw new Error(error.message);
}

export async function updateTemplateTaskPosition(templateTaskId: string, x: number, y: number): Promise<void> {
  const { error } = await supabase.from('template_tasks').update({ position_x: x, position_y: y }).eq('id', templateTaskId);
  if (error) throw new Error(error.message);
}

// TemplateLink rows referencing this task cascade-delete at the DB level
// (onDelete: Cascade on both FKs, same as the real tasks/task_dependencies
// relationship) — no explicit edge cleanup needed here.
export async function deleteTemplateTask(templateTaskId: string): Promise<void> {
  const { error } = await supabase.from('template_tasks').delete().eq('id', templateTaskId);
  if (error) throw new Error(error.message);
}

export async function createTemplateSeriesLink(
  templateId: string,
  taskId: string,
  dependsOnTaskId: string,
  type: 'FS' | 'SS' | 'FF' | 'SF'
): Promise<TemplateSeriesEdge> {
  const { data, error } = await supabase
    .from('template_links')
    .insert({ template_id: templateId, from_template_task_id: dependsOnTaskId, to_template_task_id: taskId, link_type: type })
    .select('id, from_template_task_id, to_template_task_id, link_type')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, taskId: data.to_template_task_id, dependsOnTaskId: data.from_template_task_id, type };
}

export async function createTemplateParallelLink(templateId: string, taskAId: string, taskBId: string): Promise<TemplateParallelEdge> {
  const { data, error } = await supabase
    .from('template_links')
    .insert({ template_id: templateId, from_template_task_id: taskAId, to_template_task_id: taskBId, link_type: 'PARALLEL' })
    .select('id, from_template_task_id, to_template_task_id')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, taskAId: data.from_template_task_id, taskBId: data.to_template_task_id };
}

export async function deleteTemplateLink(linkId: string): Promise<void> {
  const { error } = await supabase.from('template_links').delete().eq('id', linkId);
  if (error) throw new Error(error.message);
}

export interface TemplateSheetCommitResult {
  tasks: TemplateTask[];
  seriesEdges: TemplateSeriesEdge[];
  parallelEdges: TemplateParallelEdge[];
}

// Upload Sheet's commit step — bulk-creates every parsed task/link in two
// round trips rather than one insert per row. A multi-row insert's
// RETURNING order isn't something to build parser-to-db-id mapping on (not
// guaranteed by PostgREST the way a single re-fetch ordered by sort_order
// is), so this assigns each parsed task a unique, sequential sort_order
// up front and re-fetches by that range/order afterward — the fetched
// array is then guaranteed to line up 1:1 with the parser's own
// tasks/links (which reference each other purely by array index).
export async function commitTemplateSheetUpload(
  templateId: string,
  parsedTasks: { taskName: string; columnLabel: string; dayOffsetStart: number; dayOffsetEnd: number }[],
  parsedLinks: { fromIndex: number; toIndex: number; type: 'FS' | 'PARALLEL' }[],
  existingCount: number
): Promise<TemplateSheetCommitResult> {
  if (parsedTasks.length === 0) return { tasks: [], seriesEdges: [], parallelEdges: [] };

  const { error: insertError } = await supabase.from('template_tasks').insert(
    parsedTasks.map((t, i) => ({
      template_id: templateId,
      track_label: t.columnLabel,
      task_name: t.taskName,
      // No Work/trade column in this sheet format — each column's own
      // header doubles as its workName, since that's the only grouping
      // concept the sheet actually encodes (see templateSheetParser.ts).
      // Freely editable per-task afterward, same as any other template task.
      work_name: t.columnLabel,
      day_offset_start: t.dayOffsetStart,
      day_offset_end: t.dayOffsetEnd,
      sort_order: existingCount + i,
    }))
  );
  if (insertError) throw new Error(insertError.message);

  const { data: fetched, error: fetchError } = await supabase
    .from('template_tasks')
    .select('id, track_label, task_name, work_name, day_offset_start, day_offset_end, sort_order, position_x, position_y')
    .eq('template_id', templateId)
    .gte('sort_order', existingCount)
    .order('sort_order', { ascending: true });
  if (fetchError) throw new Error(fetchError.message);

  const newTasks = (fetched as RawTemplateTaskRow[]).map(toTemplateTask);
  const idByIndex = newTasks.map((t) => t.id);

  const seriesEdges: TemplateSeriesEdge[] = [];
  const parallelEdges: TemplateParallelEdge[] = [];

  if (parsedLinks.length > 0) {
    const { data: insertedLinks, error: linkError } = await supabase
      .from('template_links')
      .insert(
        parsedLinks.map((l) => ({
          template_id: templateId,
          from_template_task_id: idByIndex[l.fromIndex],
          to_template_task_id: idByIndex[l.toIndex],
          link_type: l.type,
        }))
      )
      .select('id, from_template_task_id, to_template_task_id, link_type');
    if (linkError) throw new Error(linkError.message);

    for (const l of insertedLinks as { id: string; from_template_task_id: string; to_template_task_id: string; link_type: string }[]) {
      if (l.link_type === 'PARALLEL') {
        parallelEdges.push({ id: l.id, taskAId: l.from_template_task_id, taskBId: l.to_template_task_id });
      } else {
        seriesEdges.push({ id: l.id, taskId: l.to_template_task_id, dependsOnTaskId: l.from_template_task_id, type: l.link_type as 'FS' });
      }
    }
  }

  return { tasks: newTasks, seriesEdges, parallelEdges };
}

// Re-runs the exact same absolute-gap axis-map compression the real
// flowchart canvas uses (lib/flowchart/layout.ts) over a template's own
// tasks — a template is a small, self-contained set of positions with no
// shared coordinate space with anything else, so this is just that same
// generic algorithm applied to a different array.
export function layoutTemplateTasks(tasks: TemplateTask[]): PositionedTemplateTask[] {
  return layoutGeneric(tasks);
}
