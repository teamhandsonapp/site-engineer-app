import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// File Manager › Drawings (supabase/file-locations.sql).
// A drawing is a project_files row (folder = 'drawings', file in Cloudflare R2)
// with a REQUIRED department (works.id), an OPTIONAL location at any level of
// the project's floor -> room -> wall tree (project_locations), and any number
// of linked tasks (file_task_links). The older drawing register (drawings /
// drawing_versions / drawing_tags) is untouched; a task's "Drawings" list
// shows both (see fetchTaskDrawings).

export const DRAWINGS_FOLDER = 'drawings';
export const MAX_DRAWING_MB = 50;
export const DRAWING_EXTENSIONS = ['pdf', 'dwg', 'png', 'jpg', 'jpeg'] as const;

export type DrawingKind = 'pdf' | 'dwg' | 'image' | 'other';
export type LocationLevel = 'floor' | 'room' | 'wall';

export function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function drawingKind(name: string, mimeType?: string | null): DrawingKind {
  const ext = extOf(name);
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'dwg') return 'dwg';
  if (['png', 'jpg', 'jpeg'].includes(ext) || mimeType?.startsWith('image/')) return 'image';
  return 'other';
}

export function mimeFor(name: string): string {
  const ext = extOf(name);
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'dwg') return 'application/acad';
  return 'application/octet-stream';
}

// ─── Locations ──────────────────────────────────────────────────────────

export interface ProjectLocation {
  id: string;
  parentId: string | null;
  level: LocationLevel;
  name: string;
  sortOrder: number;
}

export async function fetchLocations(projectId: string): Promise<ProjectLocation[]> {
  const { data, error } = await supabase
    .from('project_locations')
    .select('id, parent_id, level, name, sort_order, created_at')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; parent_id: string | null; level: LocationLevel; name: string; sort_order: number }[]).map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    level: r.level,
    name: r.name,
    sortOrder: r.sort_order,
  }));
}

export async function createLocation(
  projectId: string,
  parent: ProjectLocation | null,
  name: string,
  userId: string | null,
  siblingCount: number
): Promise<ProjectLocation> {
  const level: LocationLevel = !parent ? 'floor' : parent.level === 'floor' ? 'room' : 'wall';
  const { data, error } = await supabase
    .from('project_locations')
    .insert({ project_id: projectId, parent_id: parent?.id ?? null, level, name: name.trim(), sort_order: siblingCount + 1, created_by: userId })
    .select('id, parent_id, level, name, sort_order')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error(`"${name.trim()}" already exists here`);
    throw new Error(error.message);
  }
  const r = data as { id: string; parent_id: string | null; level: LocationLevel; name: string; sort_order: number };
  return { id: r.id, parentId: r.parent_id, level: r.level, name: r.name, sortOrder: r.sort_order };
}

/** Root-first chain of locations ending at `id` (empty for null/unknown). */
export function locationChain(byId: Map<string, ProjectLocation>, id: string | null): ProjectLocation[] {
  const chain: ProjectLocation[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

export function locationPathLabel(byId: Map<string, ProjectLocation>, id: string | null): string {
  return locationChain(byId, id).map((l) => l.name).join(' › ');
}

/** id + every descendant id (for "include files from rooms and walls inside"). */
export function locationSubtree(locations: ProjectLocation[], rootId: string): Set<string> {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of locations) {
      if (l.parentId && out.has(l.parentId) && !out.has(l.id)) {
        out.add(l.id);
        grew = true;
      }
    }
  }
  return out;
}

// ─── Drawing files ──────────────────────────────────────────────────────

export interface DrawingFile {
  id: string;
  name: string;
  kind: DrawingKind;
  mimeType: string | null;
  sizeBytes: number | null;
  departmentId: string | null;
  locationId: string | null;
  revisionLabel: string | null;
  uploadedById: string | null;
  uploadedByName: string | null;
  createdAtISO: string;
  linkedTaskCount: number;
}

type FileRow = {
  id: string; name: string; mime_type: string | null; size_bytes: number | null;
  department_id: string | null; location_id: string | null; revision_label: string | null;
  uploaded_by: string | null; created_at: string;
};
const FILE_COLS = 'id, name, mime_type, size_bytes, department_id, location_id, revision_label, uploaded_by, created_at';

async function hydrate(rows: FileRow[]): Promise<DrawingFile[]> {
  const fileIds = rows.map((r) => r.id);
  const userIds = [...new Set(rows.map((r) => r.uploaded_by).filter((x): x is string => !!x))];
  const [profiles, links] = await Promise.all([
    userIds.length ? supabase.from('user_profiles').select('id, full_name').in('id', userIds) : Promise.resolve({ data: [] }),
    fileIds.length ? supabase.from('file_task_links').select('file_id').in('file_id', fileIds) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map(((profiles.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  const linkCount = new Map<string, number>();
  for (const l of (links.data ?? []) as { file_id: string }[]) linkCount.set(l.file_id, (linkCount.get(l.file_id) ?? 0) + 1);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: drawingKind(r.name, r.mime_type),
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    departmentId: r.department_id,
    locationId: r.location_id,
    revisionLabel: r.revision_label,
    uploadedById: r.uploaded_by,
    uploadedByName: r.uploaded_by ? (names.get(r.uploaded_by) ?? null) : null,
    createdAtISO: r.created_at,
    linkedTaskCount: linkCount.get(r.id) ?? 0,
  }));
}

/** Every drawing in the project (one query + one for names + one for link counts). */
export async function fetchDrawingFiles(projectId: string): Promise<DrawingFile[]> {
  const { data, error } = await supabase
    .from('project_files')
    .select(FILE_COLS)
    .eq('project_id', projectId)
    .eq('folder', DRAWINGS_FOLDER)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return hydrate((data ?? []) as FileRow[]);
}

export interface PickedDrawing {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  file?: Blob | null; // web: the real File
}

export function validateDrawing(f: PickedDrawing): string | null {
  const ext = extOf(f.name);
  if (!(DRAWING_EXTENSIONS as readonly string[]).includes(ext)) return 'Only PDF, DWG, PNG or JPG';
  if (f.size != null && f.size > MAX_DRAWING_MB * 1024 * 1024) return `Larger than ${MAX_DRAWING_MB} MB`;
  return null;
}

// PUT with progress (XMLHttpRequest works on web and React Native; fetch has no upload progress).
function putWithProgress(url: string, body: Blob, contentType: string, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload to storage failed (HTTP ${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error while uploading — check the connection and retry'));
    xhr.send(body);
  });
}

export interface DrawingTags {
  departmentId: string;
  locationId: string | null;
  revisionLabel: string | null;
  taskIds: string[];
}

/** Upload one drawing to R2, record it, link its tasks. Returns the new file id. */
export async function uploadDrawing(
  projectId: string,
  file: PickedDrawing,
  tags: DrawingTags,
  userId: string | null,
  onProgress: (fraction: number) => void
): Promise<string> {
  const { data: link, error: linkErr } = await supabase.rpc('r2_upload_url', { p_project_id: projectId, p_folder: DRAWINGS_FOLDER, p_file_name: file.name });
  if (linkErr) throw new Error(linkErr.message);
  const { key, url } = link as { key: string; url: string };

  const contentType = file.mimeType || mimeFor(file.name);
  const blob = file.file ?? (await (await fetch(file.uri)).blob());
  await putWithProgress(url, blob, contentType, onProgress);

  const { data: row, error: rowErr } = await supabase
    .from('project_files')
    .insert({
      project_id: projectId,
      folder: DRAWINGS_FOLDER,
      name: file.name,
      mime_type: contentType,
      size_bytes: file.size ?? blob.size ?? null,
      r2_key: key,
      department_id: tags.departmentId,
      location_id: tags.locationId,
      revision_label: tags.revisionLabel?.trim() || null,
      uploaded_by: userId,
    })
    .select('id')
    .single();
  if (rowErr) throw new Error(rowErr.message);
  const fileId = (row as { id: string }).id;
  if (tags.taskIds.length) await setFileTaskLinks(fileId, tags.taskIds, userId);
  return fileId;
}

export async function updateDrawingTags(
  fileId: string,
  patch: { departmentId?: string; locationId?: string | null; revisionLabel?: string | null }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.departmentId !== undefined) row.department_id = patch.departmentId;
  if (patch.locationId !== undefined) row.location_id = patch.locationId;
  if (patch.revisionLabel !== undefined) row.revision_label = patch.revisionLabel?.trim() || null;
  const { error } = await supabase.from('project_files').update(row).eq('id', fileId);
  if (error) throw new Error(error.message);
}

/** Soft delete (same as the rest of project_files) — the R2 object stays. */
export async function deleteDrawing(fileId: string): Promise<void> {
  const { error } = await supabase.from('project_files').update({ deleted_at: new Date().toISOString() }).eq('id', fileId);
  if (error) throw new Error(error.message);
}

export async function getDrawingUrl(fileId: string): Promise<string> {
  const { data, error } = await supabase.rpc('r2_file_url', { p_file_id: fileId });
  if (error) throw new Error(error.message);
  return data as string;
}

// ─── Task links ─────────────────────────────────────────────────────────

export interface PickerTask {
  id: string;
  code: string;
  name: string;
  status: string;
  workId: string | null;
  floorLevel: string | null;
  startISO: string | null;
  dueISO: string | null;
}

/** Live tasks of one department in a project (for the task picker). */
export async function fetchDepartmentTasks(projectId: string, workId: string): Promise<PickerTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, task_id, task_name, status, work_id, floor_level, planned_start_date, current_planned_start_date, due_date, current_due_date, works!inner(project_id)')
    .eq('work_id', workId)
    .eq('works.project_id', projectId)
    .is('deleted_at', null)
    .order('task_id', { ascending: true });
  if (error) throw new Error(error.message);
  type Row = {
    id: string; task_id: string; task_name: string; status: string; work_id: string | null; floor_level: string | null;
    planned_start_date: string | null; current_planned_start_date: string | null; due_date: string | null; current_due_date: string | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    code: r.task_id,
    name: r.task_name,
    status: r.status,
    workId: r.work_id,
    floorLevel: r.floor_level,
    startISO: r.current_planned_start_date ?? r.planned_start_date,
    dueISO: r.current_due_date ?? r.due_date,
  }));
}

export interface LinkedTask {
  id: string;
  code: string;
  name: string;
  status: string;
}

export async function fetchFileTaskLinks(fileId: string): Promise<LinkedTask[]> {
  const { data, error } = await supabase
    .from('file_task_links')
    .select('task:tasks(id, task_id, task_name, status, deleted_at)')
    .eq('file_id', fileId);
  if (error) throw new Error(error.message);
  type T = { id: string; task_id: string; task_name: string; status: string; deleted_at: string | null };
  return ((data ?? []) as unknown as { task: T | T[] | null }[])
    .map((r) => (Array.isArray(r.task) ? r.task[0] : r.task))
    .filter((t): t is T => !!t && !t.deleted_at)
    .map((t) => ({ id: t.id, code: t.task_id, name: t.task_name, status: t.status }));
}

/** Make the file's links exactly `taskIds` (adds new, removes dropped). */
export async function setFileTaskLinks(fileId: string, taskIds: string[], userId: string | null): Promise<void> {
  const { data, error } = await supabase.from('file_task_links').select('task_id').eq('file_id', fileId);
  if (error) throw new Error(error.message);
  const current = new Set(((data ?? []) as { task_id: string }[]).map((r) => r.task_id));
  const wanted = new Set(taskIds);
  const toAdd = [...wanted].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !wanted.has(id));
  if (toAdd.length) {
    const { error: e } = await supabase
      .from('file_task_links')
      .upsert(toAdd.map((task_id) => ({ file_id: fileId, task_id, created_by: userId })), { onConflict: 'file_id,task_id', ignoreDuplicates: true });
    if (e) throw new Error(e.message);
  }
  if (toRemove.length) {
    const { error: e } = await supabase.from('file_task_links').delete().eq('file_id', fileId).in('task_id', toRemove);
    if (e) throw new Error(e.message);
  }
}

export async function linkFileToTask(fileId: string, taskId: string, userId: string | null): Promise<void> {
  const { error } = await supabase
    .from('file_task_links')
    .upsert({ file_id: fileId, task_id: taskId, created_by: userId }, { onConflict: 'file_id,task_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export async function unlinkFileFromTask(fileId: string, taskId: string): Promise<void> {
  const { error } = await supabase.from('file_task_links').delete().eq('file_id', fileId).eq('task_id', taskId);
  if (error) throw new Error(error.message);
}

// ─── Drawings shown inside a task ───────────────────────────────────────

export interface TaskDrawing {
  source: 'file' | 'register';
  id: string; // project_files.id or drawings.id
  name: string;
  kind: DrawingKind;
  locationLabel: string;
  revisionLabel: string | null;
}

/** Files linked to the task + register sheets whose tagged areas point at it. */
export async function fetchTaskDrawings(projectId: string, taskId: string): Promise<TaskDrawing[]> {
  const [linksRes, tagsRes, locations] = await Promise.all([
    supabase
      .from('file_task_links')
      .select('file:project_files(id, name, mime_type, location_id, revision_label, deleted_at)')
      .eq('task_id', taskId),
    supabase.from('drawing_tags').select('room, drawing:drawings(id, sheet_number, title)').eq('task_id', taskId),
    fetchLocations(projectId).catch(() => [] as ProjectLocation[]),
  ]);
  if (linksRes.error) throw new Error(linksRes.error.message);
  const byId = new Map(locations.map((l) => [l.id, l]));
  type F = { id: string; name: string; mime_type: string | null; location_id: string | null; revision_label: string | null; deleted_at: string | null };
  const files: TaskDrawing[] = ((linksRes.data ?? []) as unknown as { file: F | F[] | null }[])
    .map((r) => (Array.isArray(r.file) ? r.file[0] : r.file))
    .filter((f): f is F => !!f && !f.deleted_at)
    .map((f) => ({
      source: 'file',
      id: f.id,
      name: f.name,
      kind: drawingKind(f.name, f.mime_type),
      locationLabel: locationPathLabel(byId, f.location_id),
      revisionLabel: f.revision_label,
    }));

  // Register sheets (read-only here; a failure just hides them).
  type D = { id: string; sheet_number: string; title: string };
  const seen = new Map<string, TaskDrawing>();
  if (!tagsRes.error) {
    for (const t of (tagsRes.data ?? []) as unknown as { room: string | null; drawing: D | D[] | null }[]) {
      const d = Array.isArray(t.drawing) ? t.drawing[0] : t.drawing;
      if (!d || seen.has(d.id)) continue;
      seen.set(d.id, { source: 'register', id: d.id, name: `${d.sheet_number} · ${d.title}`, kind: 'pdf', locationLabel: t.room ?? '', revisionLabel: null });
    }
  }
  return [...files, ...seen.values()];
}

// ─── Remembered choices (per project, this device) ──────────────────────

const lastKey = (projectId: string) => `drawingUpload:last:${projectId}`;

export interface LastUploadChoice {
  departmentId: string | null;
  locationId: string | null;
  recentLocationIds: string[];
}

export async function loadLastChoice(projectId: string): Promise<LastUploadChoice> {
  try {
    const raw = await AsyncStorage.getItem(lastKey(projectId));
    if (raw) {
      const v = JSON.parse(raw) as Partial<LastUploadChoice>;
      return { departmentId: v.departmentId ?? null, locationId: v.locationId ?? null, recentLocationIds: v.recentLocationIds ?? [] };
    }
  } catch {
    /* first use / storage unavailable */
  }
  return { departmentId: null, locationId: null, recentLocationIds: [] };
}

export async function saveLastChoice(projectId: string, departmentId: string, locationId: string | null): Promise<void> {
  try {
    const prev = await loadLastChoice(projectId);
    const recent = locationId ? [locationId, ...prev.recentLocationIds.filter((id) => id !== locationId)].slice(0, 3) : prev.recentLocationIds;
    await AsyncStorage.setItem(lastKey(projectId), JSON.stringify({ departmentId, locationId, recentLocationIds: recent }));
  } catch {
    /* non-essential */
  }
}
