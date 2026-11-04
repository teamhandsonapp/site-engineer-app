import { supabase } from './supabase';

export interface ProjectOption {
  id: string;
  name: string;
}

// Staff-only — RLS grants staff unrestricted SELECT on projects, so this
// naturally returns every project (there are only ever a handful right
// now). A client never calls this: their single project comes straight off
// their own profile's clientProjectId instead (see AuthContext).
export async function fetchStaffProjects(): Promise<ProjectOption[]> {
  const { data, error } = await supabase.from('projects').select('id, name').order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Same 8-color rotation admin-web's ProjectForm/WorkForm offer as preset
// swatches — mirrors app/actions/projects.ts's createProject on admin-web,
// but as a direct RLS insert (add-projects-insert-by-admin.sql /
// add-contacts.sql's established pattern) since the mobile app has no
// server-action layer of its own. Exported for lib/departments.ts's own
// "add a department to an EXISTING project" (Settings screen), which needs
// the identical color/code generation this create-project flow already
// uses, rather than a second copy.
export const DEPARTMENT_COLORS = ['#6366F1', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#0EA5E9'];

export const SUGGESTED_DEPARTMENTS = ['Civil Works', 'Electrical', 'Plumbing', 'HVAC', 'Flooring', 'Interior', 'Fire Fighting'];

export interface NewProjectFields {
  name: string;
  address: string | null;
  floorCount: number | null;
  roomCount: number | null;
  departments: string[];
}

// works.code is unique + max 10 chars — derives a code from the
// department name (letters/numbers only, uppercased), falling back to a
// numeric suffix on collision. Mirrors admin-web's own
// codeFromDepartmentName (app/actions/projects.ts) so the two "create
// project" entry points generate compatible-looking codes.
export function codeFromDepartmentName(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'DEPT';
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) {
    const suffix = String(n);
    candidate = (base.length + suffix.length <= 10 ? base : base.slice(0, 10 - suffix.length)) + suffix;
    n++;
  }
  taken.add(candidate);
  return candidate;
}

// Admin-only — gated both by the drawer's own isAdmin check and the
// projects table's "projects insertable by admin" RLS policy. Each
// department typed on the form becomes a real Work row scoped to the new
// project, same as admin-web's create-project flow.
export async function createProject(fields: NewProjectFields): Promise<string> {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({ name: fields.name, address: fields.address, floor_count: fields.floorCount, room_count: fields.roomCount })
    .select('id')
    .single();
  if (projectError) throw new Error(projectError.message);

  if (fields.departments.length > 0) {
    const { data: existingWorks, error: worksFetchError } = await supabase.from('works').select('code');
    if (worksFetchError) throw new Error(worksFetchError.message);
    const taken = new Set((existingWorks ?? []).map((w) => w.code as string));
    const rows = fields.departments.map((name, i) => ({
      name,
      code: codeFromDepartmentName(name, taken),
      color: DEPARTMENT_COLORS[i % DEPARTMENT_COLORS.length],
      project_id: project.id as string,
    }));
    const { error: worksInsertError } = await supabase.from('works').insert(rows);
    if (worksInsertError) throw new Error(worksInsertError.message);
  }

  return project.id as string;
}
