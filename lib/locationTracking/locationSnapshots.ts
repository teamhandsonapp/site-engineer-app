import { supabase } from '../supabase';

export async function insertLocationSnapshot(params: {
  userId: string;
  projectId: string | null;
  latitude: number;
  longitude: number;
  capturedAt: Date;
}): Promise<void> {
  const { error } = await supabase.from('location_snapshots').insert({
    user_id: params.userId,
    project_id: params.projectId,
    latitude: params.latitude,
    longitude: params.longitude,
    captured_at: params.capturedAt.toISOString(),
  });
  if (error) throw new Error(error.message);
}
