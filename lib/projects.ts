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
