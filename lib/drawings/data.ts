import { supabase } from '../supabase';
import {
  DRAWINGS_BUCKET,
  tagStatusFor,
  type ConsultantStatusDTO,
  type DrawingDiscipline,
  type DrawingVersionDTO,
  type DrawingViewerDTO,
  type FloorDTO,
  type OverlayDTO,
  type TagDTO,
  type TagPhotoDTO,
} from './types';

// Mobile port of admin-web's lib/data/drawings.ts + app/actions/drawings.ts.
// Same tables, same rules (enforced by RLS: supabase/drawings-app-access.sql),
// same labels and error messages. Reads are batched: one query per table,
// one signed-URL call for every file on the screen.

const DAY_MS = 24 * 60 * 60 * 1000;
const SIGNED_URL_SECONDS = 60 * 60 * 4; // same as the web viewer
export const MAX_DRAWING_PDF_MB = 50;
export const MAX_TAG_PHOTO_MB = 10;

export function todayInIST(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

function fail(message: string): never {
  throw new Error(message);
}

type DrawingRow = {
  id: string;
  project_id: string;
  sheet_number: string;
  title: string;
  discipline: DrawingDiscipline;
  base_drawing_id: string | null;
  consultant_name: string | null;
  consultant_email: string | null;
  response_days: number;
  last_reminder_at: string | null;
};
type VersionRow = {
  id: string;
  drawing_id: string;
  revision_number: number;
  storage_path: string;
  file_name: string;
  file_size_bytes: number;
  change_note: string | null;
  based_on_version_id: string | null;
  uploaded_by_id: string | null;
  uploaded_at: string;
};

const DRAWING_COLS = 'id, project_id, sheet_number, title, discipline, base_drawing_id, consultant_name, consultant_email, response_days, last_reminder_at';
const VERSION_COLS = 'id, drawing_id, revision_number, storage_path, file_name, file_size_bytes, change_note, based_on_version_id, uploaded_by_id, uploaded_at';

// admin-web orders by the DrawingDiscipline enum order, then sheet number.
const DISCIPLINE_ORDER: DrawingDiscipline[] = ['ARCHITECTURAL', 'STRUCTURAL', 'ELECTRICAL', 'PLUMBING', 'HVAC', 'OTHER'];
function byDisciplineThenSheet(a: DrawingRow, b: DrawingRow): number {
  const d = DISCIPLINE_ORDER.indexOf(a.discipline) - DISCIPLINE_ORDER.indexOf(b.discipline);
  return d !== 0 ? d : a.sheet_number.localeCompare(b.sheet_number);
}

// Is a consultant sheet in step with the latest revision of its base sheet?
// Versions are newest-first. Same rule as the web.
export function consultantStatus(
  baseLatest: { revisionNumber: number; uploadedAt: string } | null,
  ownVersions: { basedOnRevision: number | null }[],
  responseDays: number,
  now = new Date()
): ConsultantStatusDTO {
  if (!baseLatest) return { state: 'no_base', dueAt: null, overdueDays: 0 };
  const latest = ownVersions[0];
  const inStep = latest && (latest.basedOnRevision ?? -1) >= baseLatest.revisionNumber;
  if (inStep) return { state: 'current', dueAt: null, overdueDays: 0 };
  const due = new Date(new Date(baseLatest.uploadedAt).getTime() + responseDays * DAY_MS);
  const lateMs = now.getTime() - due.getTime();
  return {
    state: latest ? 'outdated' : 'never_issued',
    dueAt: due.toISOString(),
    overdueDays: lateMs > 0 ? Math.ceil(lateMs / DAY_MS) : 0,
  };
}

async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from(DRAWINGS_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const row of data) if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
  return out;
}

async function profileNames(ids: (string | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (unique.length === 0) return {};
  const { data } = await supabase.from('user_profiles').select('id, full_name').in('id', unique);
  return Object.fromEntries(((data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
}

async function versionsFor(drawingIds: string[]): Promise<VersionRow[]> {
  if (drawingIds.length === 0) return [];
  const { data, error } = await supabase
    .from('drawing_versions')
    .select(VERSION_COLS)
    .in('drawing_id', drawingIds)
    .order('revision_number', { ascending: false });
  if (error) fail(error.message);
  return (data ?? []) as VersionRow[];
}

async function projectDrawingRows(projectId: string): Promise<DrawingRow[]> {
  const { data, error } = await supabase.from('drawings').select(DRAWING_COLS).eq('project_id', projectId);
  if (error) fail(error.message);
  return ((data ?? []) as DrawingRow[]).sort(byDisciplineThenSheet);
}

/* ── Drawing register ─────────────────────────────────────────────── */

export interface DrawingListItem {
  id: string;
  sheetNumber: string;
  title: string;
  discipline: DrawingDiscipline;
  baseDrawingId: string | null;
  consultantName: string | null;
  latestRevision: number | null;
  latestUploadedAt: string | null;
  tagCount: number;
  status: ConsultantStatusDTO | null;
}

export async function fetchProjectDrawings(projectId: string): Promise<DrawingListItem[]> {
  const rows = await projectDrawingRows(projectId);
  const ids = rows.map((r) => r.id);
  const [versions, tagsRes] = await Promise.all([
    versionsFor(ids),
    ids.length ? supabase.from('drawing_tags').select('drawing_id').in('drawing_id', ids) : Promise.resolve({ data: [], error: null }),
  ]);
  if (tagsRes.error) fail(tagsRes.error.message);
  const revById = new Map(versions.map((v) => [v.id, v.revision_number]));
  const versionsOf = (id: string) =>
    versions.filter((v) => v.drawing_id === id).map((v) => ({
      revisionNumber: v.revision_number,
      uploadedAt: v.uploaded_at,
      basedOnRevision: v.based_on_version_id ? revById.get(v.based_on_version_id) ?? null : null,
    }));
  const tagCount = new Map<string, number>();
  for (const t of (tagsRes.data ?? []) as { drawing_id: string }[]) tagCount.set(t.drawing_id, (tagCount.get(t.drawing_id) ?? 0) + 1);

  return rows.map((r) => {
    const own = versionsOf(r.id);
    const latest = own[0];
    const baseLatest = r.base_drawing_id ? versionsOf(r.base_drawing_id)[0] ?? null : null;
    return {
      id: r.id,
      sheetNumber: r.sheet_number,
      title: r.title,
      discipline: r.discipline,
      baseDrawingId: r.base_drawing_id,
      consultantName: r.consultant_name,
      latestRevision: latest?.revisionNumber ?? null,
      latestUploadedAt: latest?.uploadedAt ?? null,
      tagCount: tagCount.get(r.id) ?? 0,
      status: r.base_drawing_id ? consultantStatus(baseLatest, own, r.response_days) : null,
    };
  });
}

/* ── Viewer payload ───────────────────────────────────────────────── */

export async function fetchDrawingViewerData(projectId: string, drawingId: string): Promise<DrawingViewerDTO | null> {
  const [rows, projectRes, tasksRes] = await Promise.all([
    projectDrawingRows(projectId),
    supabase.from('projects').select('id, name').eq('id', projectId).single(),
    supabase
      .from('tasks')
      .select('id, task_id, task_name, status, works!inner(name, project_id)')
      .eq('works.project_id', projectId)
      .is('deleted_at', null),
  ]);
  if (projectRes.error) fail(projectRes.error.message);
  if (tasksRes.error) fail(tasksRes.error.message);
  const drawing = rows.find((r) => r.id === drawingId);
  if (!drawing) return null;

  const base = drawing.base_drawing_id ? rows.find((r) => r.id === drawing.base_drawing_id) ?? null : null;
  const overlays = rows.filter((r) => r.base_drawing_id === drawing.id);
  const floorBase = base ?? drawing;
  const floorOverlays = rows.filter((r) => r.base_drawing_id === floorBase.id);

  const relevantIds = [...new Set([drawing.id, ...overlays.map((o) => o.id), ...(base ? [base.id] : [])])];
  const [versions, tagsRes] = await Promise.all([
    versionsFor(relevantIds),
    supabase
      .from('drawing_tags')
      .select('id, page, name, layer, room, x, y, width, height, created_at, task:tasks(id, task_id, task_name, status, due_date, current_due_date, deleted_at, works(name))')
      .eq('drawing_id', drawing.id)
      .order('created_at', { ascending: true }),
  ]);
  if (tagsRes.error) fail(tagsRes.error.message);
  type TagRow = {
    id: string;
    page: number;
    name: string;
    layer: DrawingDiscipline;
    room: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    task: {
      id: string;
      task_id: string;
      task_name: string;
      status: string;
      due_date: string | null;
      current_due_date: string | null;
      deleted_at: string | null;
      works: { name: string } | null;
    } | null;
  };
  const tagRows = (tagsRes.data ?? []) as unknown as TagRow[];

  const photosRes = tagRows.length
    ? await supabase
        .from('drawing_tag_photos')
        .select('id, tag_id, storage_path, caption, uploaded_by_id, uploaded_at')
        .in('tag_id', tagRows.map((t) => t.id))
        .order('uploaded_at', { ascending: false })
    : { data: [], error: null };
  if (photosRes.error) fail(photosRes.error.message);
  const photoRows = (photosRes.data ?? []) as { id: string; tag_id: string; storage_path: string; caption: string | null; uploaded_by_id: string | null; uploaded_at: string }[];

  const [urls, names] = await Promise.all([
    signedUrls([...versions.map((v) => v.storage_path), ...photoRows.map((p) => p.storage_path)]),
    profileNames([...versions.map((v) => v.uploaded_by_id), ...photoRows.map((p) => p.uploaded_by_id)]),
  ]);

  const revById = new Map(versions.map((v) => [v.id, v.revision_number]));
  const toVersionDTO = (v: VersionRow): DrawingVersionDTO => ({
    id: v.id,
    revisionNumber: v.revision_number,
    fileName: v.file_name,
    fileSizeBytes: v.file_size_bytes,
    changeNote: v.change_note,
    basedOnRevision: v.based_on_version_id ? revById.get(v.based_on_version_id) ?? null : null,
    uploadedByName: v.uploaded_by_id ? names[v.uploaded_by_id] ?? null : null,
    uploadedAt: v.uploaded_at,
    url: urls[v.storage_path] ?? null,
  });
  const versionsOf = (id: string) => versions.filter((v) => v.drawing_id === id).map(toVersionDTO);

  const today = todayInIST();
  const ownVersions = versionsOf(drawing.id);
  const ownLatest = ownVersions[0] ?? null;

  const overlayDTOs: OverlayDTO[] = overlays.map((o) => {
    const ov = versionsOf(o.id);
    return {
      id: o.id,
      sheetNumber: o.sheet_number,
      title: o.title,
      discipline: o.discipline,
      consultantName: o.consultant_name,
      consultantEmail: o.consultant_email,
      responseDays: o.response_days,
      lastReminderAt: o.last_reminder_at,
      versions: ov,
      status: consultantStatus(ownLatest, ov, o.response_days),
    };
  });

  const tags: TagDTO[] = tagRows.map((t) => {
    const liveTask = t.task && !t.task.deleted_at ? t.task : null;
    const task = liveTask
      ? {
          id: liveTask.id,
          code: liveTask.task_id,
          name: liveTask.task_name,
          status: liveTask.status,
          dueDate: (liveTask.current_due_date ?? liveTask.due_date)?.slice(0, 10) ?? null,
          workName: liveTask.works?.name ?? null,
        }
      : null;
    const photos: TagPhotoDTO[] = photoRows
      .filter((p) => p.tag_id === t.id)
      .map((p) => ({
        id: p.id,
        caption: p.caption,
        uploadedAt: p.uploaded_at,
        uploadedByName: p.uploaded_by_id ? names[p.uploaded_by_id] ?? null : null,
        url: urls[p.storage_path] ?? null,
      }));
    return { id: t.id, page: t.page, name: t.name, layer: t.layer, room: t.room, x: t.x, y: t.y, width: t.width, height: t.height, task, statusKind: tagStatusFor(task, today), photos };
  });

  const floor: FloorDTO = {
    baseId: floorBase.id,
    title: floorBase.title,
    sheets: [
      { id: floorBase.id, sheetNumber: floorBase.sheet_number, discipline: floorBase.discipline },
      ...floorOverlays.map((o) => ({ id: o.id, sheetNumber: o.sheet_number, discipline: o.discipline })),
    ],
  };

  type TaskRow = { id: string; task_id: string; task_name: string; status: string; works: { name: string } | null };
  const taskOptions = ((tasksRes.data ?? []) as unknown as TaskRow[])
    .map((t) => ({ id: t.id, code: t.task_id, name: t.task_name, status: t.status, workName: t.works?.name ?? null }))
    .sort((a, b) => (a.workName ?? '').localeCompare(b.workName ?? '') || a.code.localeCompare(b.code));

  const baseLatest = base ? versionsOf(base.id)[0] ?? null : null;

  return {
    project: projectRes.data as { id: string; name: string },
    drawing: {
      id: drawing.id,
      sheetNumber: drawing.sheet_number,
      title: drawing.title,
      discipline: drawing.discipline,
      consultantName: drawing.consultant_name,
      consultantEmail: drawing.consultant_email,
      responseDays: drawing.response_days,
      lastReminderAt: drawing.last_reminder_at,
      base: base ? { id: base.id, sheetNumber: base.sheet_number, title: base.title } : null,
    },
    versions: ownVersions,
    selfStatus: base ? consultantStatus(baseLatest, ownVersions, drawing.response_days) : null,
    overlays: overlayDTOs,
    tags,
    tasks: taskOptions,
    rooms: [...new Set(tags.map((t) => t.room).filter((r): r is string => !!r))].sort(),
    today,
    floor,
  };
}

/* ── Tags (same rules and messages as the web's server actions) ───── */

export async function createDrawingTag(input: {
  drawingId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  layer: DrawingDiscipline;
  room: string;
  taskId: string | null;
  createdById: string;
}): Promise<string> {
  const name = input.name.trim();
  if (!name) fail('Give the area a name');
  if (input.width < 0.002 || input.height < 0.002) fail('Draw a bigger box');
  const { data, error } = await supabase
    .from('drawing_tags')
    .insert({
      drawing_id: input.drawingId,
      page: input.page,
      name,
      layer: input.layer,
      room: input.room.trim() || null,
      task_id: input.taskId,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      created_by_id: input.createdById,
    })
    .select('id')
    .single();
  if (error) fail(error.message.includes('not in this project') ? 'That task is not in this project' : error.message);
  return (data as { id: string }).id;
}

export async function updateDrawingTag(input: { tagId: string; name: string; layer: DrawingDiscipline; room: string; taskId: string | null }): Promise<void> {
  const name = input.name.trim();
  if (!name) fail('Give the area a name');
  const { data, error } = await supabase
    .from('drawing_tags')
    .update({ name, layer: input.layer, room: input.room.trim() || null, task_id: input.taskId })
    .eq('id', input.tagId)
    .select('id');
  if (error) fail(error.message.includes('not in this project') ? 'That task is not in this project' : error.message);
  if (!data?.length) fail('Only admins, managers and senior site engineers can edit tags');
}

export async function deleteDrawingTag(tagId: string, photoPaths: string[]): Promise<void> {
  const { data, error } = await supabase.from('drawing_tags').delete().eq('id', tagId).select('id');
  if (error) fail(error.message);
  if (!data?.length) fail('Only admins, managers and senior site engineers can delete tags');
  if (photoPaths.length) await supabase.storage.from(DRAWINGS_BUCKET).remove(photoPaths);
}

const PHOTO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// Same storage path as admin-web: <project>/<drawing>/photos/<tag>/<uuid>.<ext>
// The photo arrives already resized (lib/preparePhoto.ts, H12) as base64 JPEG.
export async function addTagPhoto(input: {
  projectId: string;
  drawingId: string;
  tagId: string;
  base64: string;
  mimeType: string;
  uploadedById: string;
}): Promise<void> {
  const ext = PHOTO_EXT[input.mimeType];
  if (!ext) fail('Photos must be JPG, PNG or WebP');
  const body = base64ToArrayBuffer(input.base64);
  if (body.byteLength <= 0) fail('The file is empty');
  if (body.byteLength > MAX_TAG_PHOTO_MB * 1024 * 1024) fail(`Photo is larger than ${MAX_TAG_PHOTO_MB} MB`);
  const path = `${input.projectId}/${input.drawingId}/photos/${input.tagId}/${uuid()}.${ext}`;
  const up = await supabase.storage.from(DRAWINGS_BUCKET).upload(path, body, { contentType: input.mimeType });
  if (up.error) fail(`Upload failed: ${up.error.message}`);
  const { error } = await supabase.from('drawing_tag_photos').insert({ tag_id: input.tagId, storage_path: path, uploaded_by_id: input.uploadedById });
  if (error) {
    await supabase.storage.from(DRAWINGS_BUCKET).remove([path]);
    fail(error.message);
  }
}

export async function deleteTagPhoto(photoId: string): Promise<void> {
  const { data, error } = await supabase.from('drawing_tag_photos').delete().eq('id', photoId).select('storage_path');
  if (error) fail(error.message);
  if (!data?.length) fail('Only admins, managers and senior site engineers can delete photos');
  await supabase.storage.from(DRAWINGS_BUCKET).remove([(data[0] as { storage_path: string }).storage_path]);
}

/* ── Sheets and revisions ─────────────────────────────────────────── */

export async function createDrawing(input: {
  projectId: string;
  sheetNumber: string;
  title: string;
  discipline: DrawingDiscipline;
  baseDrawingId: string | null;
  consultantName: string;
  consultantEmail: string;
  responseDays: number;
  createdById: string;
}): Promise<string> {
  const sheetNumber = input.sheetNumber.trim();
  const title = input.title.trim();
  if (!sheetNumber) fail('Enter a sheet number');
  if (!title) fail('Enter a title');
  if (input.consultantEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.consultantEmail.trim())) fail('Enter a valid consultant email');
  const { data, error } = await supabase
    .from('drawings')
    .insert({
      project_id: input.projectId,
      sheet_number: sheetNumber,
      title,
      discipline: input.discipline,
      base_drawing_id: input.baseDrawingId,
      consultant_name: input.consultantName.trim() || null,
      consultant_email: input.consultantEmail.trim() || null,
      response_days: Math.min(60, Math.max(1, Math.round(input.responseDays) || 3)),
      created_by_id: input.createdById,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') fail(`Sheet ${sheetNumber} already exists in this project`);
    if (error.code === '42501') fail('Only admins, managers and senior site engineers can add drawings');
    fail(error.message.includes('same project') ? 'The base sheet must be in the same project' : 'Could not create the drawing');
  }
  return (data as { id: string }).id;
}

// Same path and numbering as admin-web: <project>/<drawing>/<uuid>.pdf,
// next revision = latest + 1 (R0 first). The unique (drawing, revision)
// index stops two people issuing the same number.
export async function uploadDrawingRevision(input: {
  projectId: string;
  drawingId: string;
  uri: string;
  fileName: string;
  changeNote: string;
  basedOnVersionId: string | null;
  uploadedById: string;
}): Promise<number> {
  if (!/\.pdf$/i.test(input.fileName)) fail('Only PDF drawings are supported for now');
  const body = await (await fetch(input.uri)).arrayBuffer();
  if (body.byteLength <= 0) fail('The file is empty');
  if (body.byteLength > MAX_DRAWING_PDF_MB * 1024 * 1024) fail(`PDF is larger than ${MAX_DRAWING_PDF_MB} MB`);
  const path = `${input.projectId}/${input.drawingId}/${uuid()}.pdf`;
  const up = await supabase.storage.from(DRAWINGS_BUCKET).upload(path, body, { contentType: 'application/pdf' });
  if (up.error) fail(`Upload failed: ${up.error.message}`);
  const { data: latest } = await supabase
    .from('drawing_versions')
    .select('revision_number')
    .eq('drawing_id', input.drawingId)
    .order('revision_number', { ascending: false })
    .limit(1);
  const next = latest?.length ? (latest[0] as { revision_number: number }).revision_number + 1 : 0;
  const { error } = await supabase.from('drawing_versions').insert({
    drawing_id: input.drawingId,
    revision_number: next,
    storage_path: path,
    file_name: input.fileName,
    file_size_bytes: body.byteLength,
    change_note: input.changeNote.trim() || null,
    based_on_version_id: input.basedOnVersionId,
    uploaded_by_id: input.uploadedById,
  });
  if (error) {
    await supabase.storage.from(DRAWINGS_BUCKET).remove([path]);
    fail(error.code === '42501' ? 'Only admins, managers and senior site engineers can upload revisions' : 'Could not save the revision. Please try again.');
  }
  return next;
}
