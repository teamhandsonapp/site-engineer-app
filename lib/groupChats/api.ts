// Site Groups network calls. Thin wrappers over the backend contract:
//   RPC get_group_chats(p_project_id), RPC mark_group_read(p_group_id),
//   table whatsapp_messages (RLS: only people in whatsapp_access),
//   Edge Function whapi-send { group_id, body, client_message_id }.

import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { ChatMessage, GroupChat, MessageCursor } from './types';

const MESSAGE_COLUMNS =
  'id, group_id, wa_message_id, client_message_id, from_me, sender_wa_id, sender_name, type, body, status, error, wa_timestamp';

export async function fetchChats(projectId: string): Promise<GroupChat[]> {
  const { data, error } = await supabase.rpc('get_group_chats', { p_project_id: projectId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as (GroupChat & { is_enabled: boolean })[])
    .filter((g) => g.is_enabled)
    .map((g) => ({
      id: g.id,
      name: g.name,
      project_id: g.project_id,
      last_message_text: g.last_message_text,
      last_message_type: g.last_message_type ?? null,
      last_message_sender: g.last_message_sender,
      last_message_at: g.last_message_at,
      last_message_from_me: g.last_message_from_me,
      muted_until: g.muted_until,
      unread_count: Number(g.unread_count) || 0,
    }));
}

// Newest first. `before` pages backwards (older); `since` returns everything
// at or after a timestamp (gap fill after resume/reconnect).
export async function fetchMessages(
  groupId: string,
  opts: { before?: MessageCursor; since?: string; limit?: number } = {}
): Promise<ChatMessage[]> {
  const limit = opts.limit ?? 40;
  let q = supabase
    .from('whatsapp_messages')
    .select(MESSAGE_COLUMNS)
    .eq('group_id', groupId)
    .order('wa_timestamp', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (opts.before) {
    const { ts, id } = opts.before;
    q = q.or(`wa_timestamp.lt."${ts}",and(wa_timestamp.eq."${ts}",id.lt.${id})`);
  }
  if (opts.since) q = q.gte('wa_timestamp', opts.since);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ChatMessage[];
}

export async function markRead(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_group_read', { p_group_id: groupId });
  if (error) throw new Error(error.message);
}

export type SendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; status: number | null; message: ChatMessage | null; error: string };

export async function sendMessage(groupId: string, body: string, clientMessageId: string): Promise<SendResult> {
  const { data, error } = await supabase.functions.invoke('whapi-send', {
    body: { group_id: groupId, body, client_message_id: clientMessageId },
  });
  if (!error) return { ok: true, message: (data as { message: ChatMessage }).message };

  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    let payload: { message?: ChatMessage; error?: string } = {};
    try {
      payload = await res.json();
    } catch {
      // body not JSON
    }
    return { ok: false, status: res.status, message: payload.message ?? null, error: payload.error ?? 'Message could not be sent' };
  }
  // Network failure / function unreachable: nothing reached the server.
  return { ok: false, status: null, message: null, error: 'No connection — message not sent' };
}

// Deletes the caller's own FAILED message (Group Chats migration 3).
// 'unsupported' if the RPC isn't there (older backend): the caller then
// hides it on this phone only.
export async function deleteFailedMessage(messageId: string): Promise<'deleted' | 'unsupported'> {
  const { data, error } = await supabase.rpc('delete_my_failed_message', { p_message_id: messageId });
  if (!error) return data === false ? 'unsupported' : 'deleted';
  if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) return 'unsupported';
  throw new Error(error.message);
}

// Name of one group, or null if it doesn't exist / RLS hides it (no access,
// or disabled and the caller isn't a manager).
export async function fetchGroupInfo(groupId: string): Promise<{ name: string; is_enabled: boolean } | null> {
  const { data, error } = await supabase.from('whatsapp_groups').select('name, is_enabled').eq('id', groupId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}
