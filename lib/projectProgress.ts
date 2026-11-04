import { supabase } from './supabase';

export interface ProjectProgress {
  completed: number;
  target: number | null; // null = no target set on the project, not 0
  percentage: number | null; // null when target is null/0 — never divides by zero
}

// Mirrors admin-web's getProjectSftProgress() exactly (lib/data/sft.ts) —
// same rounding, same 100 cap, same null-vs-zero distinction for "no
// target set" — recomputed here via direct Supabase reads since this app
// has no server action layer to call that function through.
export async function fetchProjectProgress(projectId: string): Promise<ProjectProgress> {
  const [{ data: project, error: projectError }, { data: entries, error: entriesError }] = await Promise.all([
    supabase.from('projects').select('total_sft').eq('id', projectId).maybeSingle(),
    supabase
      .from('sft_progress_entries')
      .select('sft_completed, task:tasks!inner(work:works!inner(project_id))')
      .eq('task.work.project_id', projectId),
  ]);

  if (projectError) throw new Error(projectError.message);
  if (entriesError) throw new Error(entriesError.message);

  const completed = (entries ?? []).reduce((sum, e) => sum + (Number(e.sft_completed) || 0), 0);
  const target = project?.total_sft != null ? Number(project.total_sft) : null;
  const percentage = target != null && target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : null;

  return { completed, target, percentage };
}
