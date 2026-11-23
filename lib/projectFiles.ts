import { supabase } from './supabase';

// Files › Cloudflare R2 (supabase/r2-files.sql). The file itself goes
// straight from the phone/browser to the private R2 bucket through a
// 5-minute signed link the database hands out (r2_upload_url); the database
// keeps only the metadata row (project_files). Opening a file asks for a
// 5-minute download link (r2_file_url). The R2 keys never reach the app.

export interface ProjectFile {
  id: string;
  folder: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  floor: string | null;
  room: string | null;
  wall: string | null;
  department: string | null;
  uploadedByName: string | null;
  createdAtISO: string;
}

export interface UploadMetaFields {
  department?: string | null;
  floor?: string | null;
  room?: string | null;
  wall?: string | null;
}

export async function fetchProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const { data, error } = await supabase
    .from('project_files')
    .select('id, folder, name, mime_type, size_bytes, floor, room, wall, department, uploaded_by, created_at')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  type Row = {
    id: string; folder: string; name: string; mime_type: string | null; size_bytes: number | null;
    floor: string | null; room: string | null; wall: string | null; department: string | null;
    uploaded_by: string | null; created_at: string;
  };
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map((r) => r.uploaded_by).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await supabase.from('user_profiles').select('id, full_name').in('id', ids);
    for (const p of (profiles ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({
    id: r.id,
    folder: r.folder,
    name: r.name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    floor: r.floor,
    room: r.room,
    wall: r.wall,
    department: r.department,
    uploadedByName: r.uploaded_by ? (names.get(r.uploaded_by) ?? null) : null,
    createdAtISO: r.created_at,
  }));
}

export async function uploadProjectFile(
  projectId: string,
  folder: string,
  file: { uri: string; name: string; mimeType?: string | null; size?: number | null },
  meta: UploadMetaFields,
  uploadedBy: string | null
): Promise<void> {
  // 1. Signed upload link + the R2 key it's valid for.
  const { data: link, error: linkErr } = await supabase.rpc('r2_upload_url', { p_project_id: projectId, p_folder: folder, p_file_name: file.name });
  if (linkErr) throw new Error(linkErr.message);
  const { key, url } = link as { key: string; url: string };

  // 2. Send the bytes straight to R2.
  const blob = await (await fetch(file.uri)).blob();
  const put = await fetch(url, { method: 'PUT', body: blob, headers: file.mimeType ? { 'Content-Type': file.mimeType } : undefined });
  if (!put.ok) throw new Error(`Upload to storage failed (HTTP ${put.status})`);

  // 3. Record it.
  const { error: rowErr } = await supabase.from('project_files').insert({
    project_id: projectId,
    folder,
    name: file.name,
    mime_type: file.mimeType ?? null,
    size_bytes: file.size ?? blob.size ?? null,
    r2_key: key,
    floor: meta.floor || null,
    room: meta.room || null,
    wall: meta.wall || null,
    department: meta.department || null,
    uploaded_by: uploadedBy,
  });
  if (rowErr) throw new Error(rowErr.message);
}

// 5-minute link to open/download one file.
export async function getProjectFileUrl(fileId: string): Promise<string> {
  const { data, error } = await supabase.rpc('r2_file_url', { p_file_id: fileId });
  if (error) throw new Error(error.message);
  return data as string;
}
