import { supabase } from './supabase';
import { mergeFlowState, togglePoint, type FeatureState, type FlowStatus } from './appFlow';

// Reads / saves the App Progress flowchart's statuses and ticks
// (public.app_flow_features — supabase/migrations/20261118120000_app_flow_features.sql).

export class AppFlowNotSetUpError extends Error {
  constructor() {
    super('The App Progress table is not set up yet.');
  }
}

// "relation does not exist" (42P01) / not in the schema cache (PGRST205):
// the migration hasn't been run on this database yet.
function isMissingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205');
}

export async function fetchAppFlow(): Promise<Record<string, FeatureState>> {
  const { data, error } = await supabase.from('app_flow_features').select('id, status, points');
  if (isMissingTable(error)) throw new AppFlowNotSetUpError();
  if (error) throw error;
  return mergeFlowState(data ?? []);
}

async function fetchOne(id: string): Promise<FeatureState> {
  const { data, error } = await supabase.from('app_flow_features').select('id, status, points').eq('id', id);
  if (isMissingTable(error)) throw new AppFlowNotSetUpError();
  if (error) throw error;
  return mergeFlowState(data ?? [])[id];
}

async function save(id: string, state: FeatureState, userId: string): Promise<void> {
  const { error } = await supabase
    .from('app_flow_features')
    .upsert({ id, status: state.status, points: state.points, updated_at: new Date().toISOString(), updated_by: userId });
  if (isMissingTable(error)) throw new AppFlowNotSetUpError();
  if (error) throw error;
}

// Ticks / unticks one point. Re-reads the row first so a tick made by
// someone else a moment ago on another point of the same box isn't lost.
export async function setPointDone(id: string, text: string, done: boolean, userId: string): Promise<FeatureState> {
  const current = await fetchOne(id);
  const points = togglePoint(current.points, text, done);
  if (!points) return current;
  const next = { ...current, points };
  await save(id, next, userId);
  return next;
}

export async function setFeatureStatus(id: string, status: FlowStatus, userId: string): Promise<FeatureState> {
  const current = await fetchOne(id);
  const next = { ...current, status };
  await save(id, next, userId);
  return next;
}
