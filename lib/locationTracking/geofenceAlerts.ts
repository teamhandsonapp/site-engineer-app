import { supabase } from '../supabase';
import { logAction } from '../sentryLog';

export async function insertConfirmedGeofenceAlert(params: {
  projectId: string;
  userId: string;
  exitAt: Date;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  deviceManufacturer?: string;
  deviceModel?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from('geofence_alerts')
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      exit_at: params.exitAt.toISOString(),
      confirmed_at: new Date().toISOString(),
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      accuracy_meters: params.accuracyMeters ?? null,
      device_manufacturer: params.deviceManufacturer ?? null,
      device_model: params.deviceModel ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  const alertId = (data as { id: string }).id;
  // Unlike restricted-zone alerts, boundary-exit alerts have no backend
  // dedup step (Point 8 was scoped to red zones only) — this row IS the
  // alert, no ambiguity about whether it was suppressed.
  logAction('alert', 'Geofence alert created', { alertId, projectId: params.projectId });
  return alertId;
}

export async function markGeofenceAlertReturned(alertId: string): Promise<void> {
  const { error } = await supabase
    .from('geofence_alerts')
    .update({ returned_at: new Date().toISOString() })
    .eq('id', alertId);
  if (error) throw new Error(error.message);
}
