import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

// Admin uploads a drawing/floor-plan file (revision label + date); any
// staff role can view it and assign it to one or more tasks
// (document_task_links). Direct client-side Storage upload via RLS on the
// 'project-documents' bucket (add-documents.sql) — not the upload-dpr-
// photo Edge Function's relay pattern, since deploying a new function
// needs the Supabase CLI logged in, which this environment can't do; a
// plain Storage RLS policy needs only SQL, and this project already runs
// both patterns side by side (dpr-photos has its own direct-upload policy
// too, alongside its Edge Function).

const BUCKET = 'project-documents';
const SIGNED_URL_TTL_SECONDS = 3600;
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export interface ProjectDocument {
  id: string;
  title: string;
  storagePath: string;
  revisionLabel: string;
  documentDateISO: string; // 'YYYY-MM-DD'
  createdAtISO: string;
  signedUrl: string | null;
}

interface RawDocument {
  id: string;
  title: string;
  storage_path: string;
  revision_label: string;
  document_date: string;
  created_at: string;
}

export interface PickedDocumentFile {
  name: string;
  contentType: string;
  arrayBuffer: ArrayBuffer;
}

// The picker + byte-read mirrors lib/flowchart/templateSheetFile.ts's own
// pickAndParseTemplateSheet exactly (web hands back a real File/Blob;
// native only a cache-directory URI, read via expo-file-system's File).
// Returns null if the user cancels the picker (not an error).
export async function pickDocumentFile(): Promise<PickedDocumentFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ALLOWED_MIME_TYPES, copyToCacheDirectory: true });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  const arrayBuffer = asset.file ? await asset.file.arrayBuffer() : await new File(asset.uri).arrayBuffer();
  return { name: asset.name, contentType: asset.mimeType ?? 'application/pdf', arrayBuffer };
}

export async function fetchDocuments(projectId: string): Promise<ProjectDocument[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, title, storage_path, revision_label, document_date, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as RawDocument[];
  return Promise.all(
    rows.map(async (r) => {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, SIGNED_URL_TTL_SECONDS);
      return {
        id: r.id,
        title: r.title,
        storagePath: r.storage_path,
        revisionLabel: r.revision_label,
        documentDateISO: r.document_date,
        createdAtISO: r.created_at,
        signedUrl: signed?.signedUrl ?? null,
      };
    })
  );
}

function extensionFor(contentType: string): string {
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'image/png') return 'png';
  return 'jpg';
}

export async function uploadDocument(
  projectId: string,
  file: PickedDocumentFile,
  title: string,
  revisionLabel: string,
  documentDateISO: string,
  uploadedBy: string | null
): Promise<void> {
  const path = `${projectId}/${Crypto.randomUUID()}.${extensionFor(file.contentType)}`;
  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file.arrayBuffer, { contentType: file.contentType });
  if (uploadErr) throw new Error(uploadErr.message);
  const { error } = await supabase.from('documents').insert({
    project_id: projectId,
    title,
    storage_path: path,
    revision_label: revisionLabel,
    document_date: documentDateISO,
    uploaded_by: uploadedBy,
  });
  if (error) throw new Error(error.message);
}

export async function deleteDocument(documentId: string, storagePath: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([storagePath]);
  const { error } = await supabase.from('documents').delete().eq('id', documentId);
  if (error) throw new Error(error.message);
}

// ─── Assign to task(s) ──────────────────────────────────────────────────

export interface DocumentTaskLink {
  linkId: string;
  taskId: string;
  taskCode: string;
  taskName: string;
}

interface RawLink {
  id: string;
  task_id: string;
  task: { task_id: string; task_name: string } | { task_id: string; task_name: string }[] | null;
}

function normalizeToOne<T>(raw: T | T[] | null): T | null {
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export async function fetchDocumentTaskLinks(documentId: string): Promise<DocumentTaskLink[]> {
  const { data, error } = await supabase
    .from('document_task_links')
    .select('id, task_id, task:tasks(task_id, task_name)')
    .eq('document_id', documentId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawLink[]).map((r) => {
    const task = normalizeToOne(r.task);
    return { linkId: r.id, taskId: r.task_id, taskCode: task?.task_id ?? '', taskName: task?.task_name ?? 'Unknown task' };
  });
}

export async function assignDocumentToTask(documentId: string, taskId: string, assignedBy: string | null): Promise<void> {
  const { error } = await supabase.from('document_task_links').insert({ document_id: documentId, task_id: taskId, assigned_by: assignedBy });
  if (error) throw new Error(error.message);
}

export async function unassignDocumentFromTask(linkId: string): Promise<void> {
  const { error } = await supabase.from('document_task_links').delete().eq('id', linkId);
  if (error) throw new Error(error.message);
}
