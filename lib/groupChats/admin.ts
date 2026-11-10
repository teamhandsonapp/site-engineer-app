// Site Groups setup: for people with can_manage in whatsapp_access.
// Every call goes through RPCs / RLS defined in
// supabase/add-whatsapp-groups.sql, which re-check can_manage on the server.
//
//   Groups  — whatsapp_groups (RLS: managers also see disabled groups)
//             → update_whatsapp_group(p_group_id, p_is_enabled, p_project_id, p_name)
//   People  — list_whatsapp_access / list_whatsapp_access_candidates
//             → set_whatsapp_access(p_user_id, p_can_send, p_can_manage)
//             → remove_whatsapp_access(p_user_id)
//
// New groups are created by the whapi-webhook the first time a message
// arrives from them, always switched off. A manager links each one to a
// project and switches it on here.

import { supabase } from '../supabase';

export interface SetupGroup {
  id: string;
  wa_chat_id: string;
  name: string;
  project_id: string | null;
  is_enabled: boolean;
  last_message_at: string | null;
  last_webhook_at: string | null;
}

export interface AccessPerson {
  user_id: string;
  full_name: string;
  email: string | null;
  role: string;
  can_send: boolean;
  can_manage: boolean;
}

export interface AccessCandidate {
  user_id: string;
  full_name: string;
  email: string | null;
  role: string;
}

export async function fetchAllGroups(): Promise<SetupGroup[]> {
  const { data, error } = await supabase
    .from('whatsapp_groups')
    .select('id, wa_chat_id, name, project_id, is_enabled, last_message_at, last_webhook_at')
    .order('is_enabled', { ascending: true })
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SetupGroup[];
}

export async function updateGroup(groupId: string, isEnabled: boolean, projectId: string | null, name?: string): Promise<void> {
  const { error } = await supabase.rpc('update_whatsapp_group', {
    p_group_id: groupId,
    p_is_enabled: isEnabled,
    p_project_id: projectId,
    p_name: name ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function fetchAccessList(): Promise<AccessPerson[]> {
  const { data, error } = await supabase.rpc('list_whatsapp_access');
  if (error) throw new Error(error.message);
  return (data ?? []) as AccessPerson[];
}

export async function fetchAccessCandidates(): Promise<AccessCandidate[]> {
  const { data, error } = await supabase.rpc('list_whatsapp_access_candidates');
  if (error) throw new Error(error.message);
  return (data ?? []) as AccessCandidate[];
}

export async function setAccess(userId: string, canSend: boolean, canManage: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_whatsapp_access', { p_user_id: userId, p_can_send: canSend, p_can_manage: canManage });
  if (error) throw new Error(error.message);
}

export async function removeAccess(userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_whatsapp_access', { p_user_id: userId });
  if (error) throw new Error(error.message);
}
