import { supabase } from './supabase';
import { fetchTaskDetail, type ChecklistItem, type TaskDetailInfo } from './taskDetail/data';
import { uploadDprPhoto } from './dprPhotoUpload';

// Point 7 — the quality checklist itself is NOT a new data source (see
// add-dpr-entry-photos.sql's own comment): it's the same dependency_items/
// dependency_completions rows every other checklist category already uses,
// just filtered to the three quality_* categories. fetchTaskDetail already
// reads the whole checklist in one round trip, so no new query is needed
// for viewing — only the PDF export and photo attach below are genuinely
// new.
export type QualityCategory = 'quality_pre_construction' | 'quality_construction' | 'quality_post_construction';
export const QUALITY_CATEGORIES: QualityCategory[] = ['quality_pre_construction', 'quality_construction', 'quality_post_construction'];

// Standard quality checklist — what the DPR Quality Checklist screen shows
// when a task has no admin-defined quality items, and what the project
// Settings "Quality Checklist" A4 printout prints.
export const QUALITY_DEFAULT_ITEM_LABELS: Record<QualityCategory, string[]> = {
  quality_pre_construction: [
    'Formwork alignment verified',
    'Reinforcement bar diameter matches drawing',
    'Rebar spacing as per GFC drawing',
    'Concrete cover blocks placed',
    'Shuttering oil applied',
    'Reinforcement binding wire checked',
    'Embedded conduits/sleeves positioned',
    'Line and level checked before pour',
    'Approved concrete mix design on site',
    'Site cleared of debris before casting',
  ],
  quality_construction: [
    'Concrete pour supervised continuously',
    'Vibration done at proper intervals',
    'Slump test conducted and recorded',
    'Cube samples cast for testing',
    'Curing started within stipulated time',
    'Formwork removal timing verified',
    'Honeycombing/voids inspected',
    'Construction joint treatment checked',
    'Weather protection during pour',
    'Daily concrete pour quantity logged',
  ],
  quality_post_construction: [
    'Surface finish inspected',
    'Dimensional accuracy verified against drawing',
    'Cube test results reviewed',
    'Curing duration compliance confirmed',
    'Rectification of visible defects done',
    'Photographs of finished work taken',
    'As-built markup updated',
    'Client/consultant walkthrough completed',
    'Handover checklist signed',
    'Final cleanup of work area done',
  ],
};

export interface QualityChecklist {
  task: TaskDetailInfo;
  itemsByCategory: Record<QualityCategory, ChecklistItem[]>;
}

export async function fetchQualityChecklist(taskId: string): Promise<QualityChecklist> {
  const { task, items } = await fetchTaskDetail(taskId);
  const itemsByCategory: Record<QualityCategory, ChecklistItem[]> = {
    quality_pre_construction: [],
    quality_construction: [],
    quality_post_construction: [],
  };
  for (const item of items) {
    if (item.category === 'quality_pre_construction' || item.category === 'quality_construction' || item.category === 'quality_post_construction') {
      itemsByCategory[item.category].push(item);
    }
  }
  return { task, itemsByCategory };
}

export interface SignedChecklistPhoto {
  id: string;
  storagePath: string;
  createdAtISO: string;
  // null when the signed URL couldn't be minted (e.g. transient Storage
  // error) — the row itself still lists, just without a preview.
  signedUrl: string | null;
}

// Same private bucket the already-deployed upload-dpr-photo Edge Function
// creates/writes to — reused as-is, nothing new to provision.
const PHOTO_BUCKET = 'dpr-photos';
const SIGNED_URL_TTL_SECONDS = 3600;

export async function fetchSignedChecklistPhotos(taskId: string): Promise<SignedChecklistPhoto[]> {
  const { data, error } = await supabase
    .from('dpr_entry_photos')
    .select('id, storage_path, created_at')
    .eq('task_id', taskId)
    .eq('photo_type', 'signed_checklist')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; storage_path: string; created_at: string }[];
  return Promise.all(
    rows.map(async (r) => {
      const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(r.storage_path, SIGNED_URL_TTL_SECONDS);
      return { id: r.id, storagePath: r.storage_path, createdAtISO: r.created_at, signedUrl: signed?.signedUrl ?? null };
    })
  );
}

// Two-step, matching upload-dpr-photo's own documented contract: the
// function only uploads bytes and hands back a storage path, this app is
// what inserts the row that actually attaches it to the task.
export async function uploadSignedChecklistPhoto(
  taskId: string,
  base64Data: string,
  contentType: 'image/jpeg' | 'image/png',
  uploadedBy: string | null
): Promise<void> {
  const storagePath = await uploadDprPhoto(base64Data, contentType);
  const { error } = await supabase
    .from('dpr_entry_photos')
    .insert({ task_id: taskId, storage_path: storagePath, uploaded_by: uploadedBy, photo_type: 'signed_checklist' });
  if (error) throw new Error(error.message);
}
