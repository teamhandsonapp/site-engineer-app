import { supabase } from '../supabase';

// Flowchart milestones — "this task to this task = Milestone 1", by
// explicit request. A task belongs to at most one milestone (plain
// nullable tasks.milestone_id, see add-milestones.sql) — shown on the
// canvas as a small colored badge on each member task (TaskNode.tsx), not
// a drawn connecting line — SVG line-drawing there is already a delicately
// tuned system (arrowheads, tap targets, dash styles per dependency type)
// this doesn't touch, so the grouping reads through color/badge instead.

export interface Milestone {
  id: string;
  name: string;
  color: string;
}

interface RawMilestone {
  id: string;
  name: string;
  color: string;
}

export async function fetchMilestones(projectId: string): Promise<Milestone[]> {
  const { data, error } = await supabase.from('milestones').select('id, name, color').eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RawMilestone[];
}

export async function createMilestone(projectId: string, name: string, color: string, createdBy: string | null): Promise<Milestone> {
  const { data, error } = await supabase
    .from('milestones')
    .insert({ project_id: projectId, name, color, created_by: createdBy })
    .select('id, name, color')
    .single();
  if (error) throw new Error(error.message);
  return data as RawMilestone;
}

export async function deleteMilestone(milestoneId: string): Promise<void> {
  // tasks.milestone_id references milestones(id) on delete set null — every
  // member task is automatically un-tagged, no separate update needed.
  const { error } = await supabase.from('milestones').delete().eq('id', milestoneId);
  if (error) throw new Error(error.message);
}

export async function assignTasksToMilestone(taskIds: string[], milestoneId: string): Promise<void> {
  const { error } = await supabase.from('tasks').update({ milestone_id: milestoneId }).in('id', taskIds);
  if (error) throw new Error(error.message);
}

// A small, distinct palette cycled by how many milestones this project
// already has — not user-picked, to keep milestone creation a single
// "name it" prompt rather than a whole color-picker UI.
export const MILESTONE_COLOR_PALETTE = ['#7C3AED', '#DC2626', '#0D9488', '#B45309', '#2563EB', '#DB2777'];
export function nextMilestoneColor(existingCount: number): string {
  return MILESTONE_COLOR_PALETTE[existingCount % MILESTONE_COLOR_PALETTE.length];
}

// "This task to this task" — walks the FS/SS/FF/SF dependency chain
// (whichever direction actually connects them) and returns every task id
// in between, inclusive. Assumes a linear chain (this app's own real
// milestone data — see add-hidden-from-flowchart.sql's 15 MILE-xx tasks —
// is exactly that); a branching graph may resolve an arbitrary branch
// rather than every possible path, which is a real limitation worth
// knowing about, not a hidden bug.
export function taskChainBetween(startId: string, endId: string, seriesEdges: { taskId: string; dependsOnTaskId: string }[]): string[] | null {
  const successors = new Map<string, string[]>();
  for (const e of seriesEdges) {
    const list = successors.get(e.dependsOnTaskId) ?? [];
    list.push(e.taskId);
    successors.set(e.dependsOnTaskId, list);
  }

  function walk(from: string, to: string): string[] | null {
    if (from === to) return [from];
    const path = [from];
    const seen = new Set([from]);
    let current = from;
    while (current !== to) {
      const candidates = successors.get(current) ?? [];
      const next = candidates.find((c) => !seen.has(c));
      if (!next) return null;
      path.push(next);
      seen.add(next);
      current = next;
      if (path.length > seriesEdges.length + 1) return null; // safety cap against a cycle
    }
    return path;
  }

  return walk(startId, endId) ?? walk(endId, startId);
}
