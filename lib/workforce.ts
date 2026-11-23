import { supabase } from './supabase';

// Workers Attendance (supabase/workforce.sql). A project has one folder per
// department (works row); each folder holds people (manager | worker); each
// person gets at most one present/absent mark per day. Used by the
// Attendance tab (folders, people, analytics) and the DPR tab (marks today's
// attendance for the departments of today's tasks).

export type WorkforceRole = 'manager' | 'worker';
export type AttendanceStatus = 'present' | 'absent';

export interface WorkforceMember {
  id: string;
  folderId: string;
  name: string;
  identifier: string | null;
  role: WorkforceRole;
}

export interface WorkforceFolder {
  id: string;
  workId: string;
  workName: string;
  members: WorkforceMember[];
}

export const ROLE_LABEL: Record<WorkforceRole, string> = { manager: 'Manager', worker: 'Worker' };

export async function fetchWorkforceFolders(projectId: string): Promise<WorkforceFolder[]> {
  const { data, error } = await supabase
    .from('workforce_folders')
    .select('id, work_id, work:works!inner(name), members:workforce_members(id, folder_id, name, identifier, role, active, created_at)')
    .eq('project_id', projectId);
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    work_id: string;
    work: { name: string } | { name: string }[] | null;
    members: { id: string; folder_id: string; name: string; identifier: string | null; role: WorkforceRole; active: boolean; created_at: string }[] | null;
  };
  return ((data ?? []) as unknown as Row[])
    .map((r) => {
      const work = Array.isArray(r.work) ? r.work[0] : r.work;
      const members = (r.members ?? [])
        .filter((m) => m.active)
        // Managers first, then by ID / name.
        .sort((a, b) => (a.role === b.role ? (a.identifier ?? a.name).localeCompare(b.identifier ?? b.name) : a.role === 'manager' ? -1 : 1))
        .map((m) => ({ id: m.id, folderId: m.folder_id, name: m.name, identifier: m.identifier, role: m.role }));
      return { id: r.id, workId: r.work_id, workName: work?.name ?? 'Department', members };
    })
    .sort((a, b) => a.workName.localeCompare(b.workName));
}

export async function createWorkforceFolder(projectId: string, workId: string): Promise<void> {
  const { error } = await supabase.from('workforce_folders').insert({ project_id: projectId, work_id: workId });
  if (error) throw new Error(error.message);
}

export async function addWorkforceMember(folderId: string, name: string, identifier: string | null, role: WorkforceRole): Promise<void> {
  const { error } = await supabase.from('workforce_members').insert({ folder_id: folderId, name: name.trim(), identifier: identifier?.trim() || null, role });
  if (error) throw new Error(error.message);
}

// Soft remove — keeps the person's past attendance in the records.
export async function removeWorkforceMember(memberId: string): Promise<void> {
  const { error } = await supabase.from('workforce_members').update({ active: false }).eq('id', memberId);
  if (error) throw new Error(error.message);
}

// memberId -> status for one day (people with no mark are simply absent from the map).
export async function fetchAttendanceForDate(memberIds: string[], dateKey: string): Promise<Record<string, AttendanceStatus>> {
  if (memberIds.length === 0) return {};
  const { data, error } = await supabase
    .from('workforce_attendance')
    .select('member_id, status')
    .in('member_id', memberIds)
    .eq('attendance_date', dateKey);
  if (error) throw new Error(error.message);
  const map: Record<string, AttendanceStatus> = {};
  for (const r of (data ?? []) as { member_id: string; status: AttendanceStatus }[]) map[r.member_id] = r.status;
  return map;
}

// status null clears the mark (back to "not marked").
export async function markAttendance(memberId: string, dateKey: string, status: AttendanceStatus | null, markedBy: string | null): Promise<void> {
  if (status === null) {
    const { error } = await supabase.from('workforce_attendance').delete().eq('member_id', memberId).eq('attendance_date', dateKey);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from('workforce_attendance')
    .upsert(
      { member_id: memberId, attendance_date: dateKey, status, marked_by: markedBy, marked_at: new Date().toISOString() },
      { onConflict: 'member_id,attendance_date' }
    );
  if (error) throw new Error(error.message);
}

export interface FolderDayStats {
  total: number;
  present: number;
  absent: number;
  unmarked: number;
}

export function folderStats(folder: WorkforceFolder, marks: Record<string, AttendanceStatus>): FolderDayStats {
  let present = 0;
  let absent = 0;
  for (const m of folder.members) {
    if (marks[m.id] === 'present') present += 1;
    else if (marks[m.id] === 'absent') absent += 1;
  }
  return { total: folder.members.length, present, absent, unmarked: folder.members.length - present - absent };
}
