import { supabase } from './supabase';
import { codeFromDepartmentName, DEPARTMENT_COLORS } from './projects';

// Manage a project's Departments (works rows) from the mobile Settings
// screen — add/rename/delete for an EXISTING project, the counterpart to
// lib/projects.ts's createProject, which only ever creates departments
// alongside a brand-new project. Nothing like this existed anywhere in
// either app before (admin-web's own WorkForm is create-only — no
// updateWork/deleteWork action exists there either); see
// add-works-manage-and-project-floor-room.sql for the RLS/grants this
// needed (works only had INSERT+SELECT for `authenticated` before).
export interface Department {
  id: string;
  name: string;
  code: string;
  color: string;
  taskCount: number;
}

export async function fetchDepartments(projectId: string): Promise<Department[]> {
  const { data: works, error } = await supabase
    .from('works')
    .select('id, name, code, color')
    .eq('project_id', projectId)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);

  const workIds = (works ?? []).map((w) => w.id as string);
  const taskCountByWork = new Map<string, number>();
  if (workIds.length > 0) {
    // head:false + count:'exact' per work would mean one round-trip per
    // department — instead, one query for every task id + its work_id,
    // tallied client-side. Fine at this scale (a handful of departments,
    // a few hundred tasks at most per project).
    const { data: taskRows, error: taskError } = await supabase.from('tasks').select('work_id').in('work_id', workIds).is('deleted_at', null);
    if (taskError) throw new Error(taskError.message);
    for (const row of taskRows ?? []) {
      const workId = row.work_id as string | null;
      if (!workId) continue;
      taskCountByWork.set(workId, (taskCountByWork.get(workId) ?? 0) + 1);
    }
  }

  return (works ?? []).map((w) => ({
    id: w.id as string,
    name: w.name as string,
    code: w.code as string,
    color: w.color as string,
    taskCount: taskCountByWork.get(w.id as string) ?? 0,
  }));
}

export async function createDepartment(projectId: string, name: string): Promise<void> {
  const { data: existingWorks, error: fetchError } = await supabase.from('works').select('code');
  if (fetchError) throw new Error(fetchError.message);
  const taken = new Set((existingWorks ?? []).map((w) => w.code as string));
  const code = codeFromDepartmentName(name, taken);
  const color = DEPARTMENT_COLORS[Math.floor(Math.random() * DEPARTMENT_COLORS.length)];
  const { error } = await supabase.from('works').insert({ project_id: projectId, name, code, color });
  if (error) throw new Error(error.message);
}

// Rename only — code/color stay fixed once created (same as admin-web's
// own WorkForm never offering a "change code" flow post-creation either),
// avoiding any risk of colliding with another department's code.
export async function renameDepartment(workId: string, name: string): Promise<void> {
  const { error } = await supabase.from('works').update({ name }).eq('id', workId);
  if (error) throw new Error(error.message);
}

// Deletion is a real, hard delete of the works row — tasks.work_id is
// ON DELETE SET NULL (confirmed via pg_constraint), so any task still
// pointing at this department would silently lose its department instead
// of blocking the delete. The Settings screen's own UI is expected to
// disable Delete whenever taskCount > 0 (per fetchDepartments above) so
// this never actually runs against a department real tasks still use —
// this function itself has no such guard, so don't call it without
// checking taskCount first.
export async function deleteDepartment(workId: string): Promise<void> {
  const { error } = await supabase.from('works').delete().eq('id', workId);
  if (error) throw new Error(error.message);
}
