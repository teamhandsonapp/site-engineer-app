import { supabase } from './supabase';

// Relays through the upload-dpr-photo Edge Function rather than uploading
// directly to Supabase Storage — this app's established convention (see
// admin-web's lib/supabase/admin.ts) is that Storage writes always go
// through a service-role client, never a direct client-side upload against
// a Storage RLS policy. The function returns only a storage path; the
// caller still inserts the daily_progress_report_photos row itself once it
// has a real report id (that table's own RLS already allows it).
export async function uploadDprPhoto(base64Data: string, contentType: 'image/jpeg' | 'image/png'): Promise<string> {
  const { data, error } = await supabase.functions.invoke('upload-dpr-photo', {
    body: { base64Data, contentType },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.message ?? 'Photo upload failed');
  return data.storagePath as string;
}
