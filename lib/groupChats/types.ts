// Shapes returned by the Site Groups backend (admin-web
// supabase/add-whatsapp-groups*.sql + whapi-send). Only the columns the
// app actually uses.

export type MessageStatus = 'received' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageType = 'text' | 'image' | 'video' | 'document' | 'audio' | 'sticker' | 'unsupported';

export interface ChatMessage {
  id: string; // server uuid, or "local-<client_message_id>" while optimistic
  group_id: string;
  wa_message_id: string | null;
  client_message_id: string | null;
  from_me: boolean;
  sender_wa_id: string | null;
  sender_name: string | null;
  type: MessageType;
  body: string | null;
  status: MessageStatus;
  error: string | null;
  wa_timestamp: string; // ISO
}

export interface GroupChat {
  id: string;
  name: string;
  project_id: string | null;
  last_message_text: string | null;
  last_message_type: MessageType | null; // null until migration 3 / for old rows
  last_message_sender: string | null;
  last_message_at: string | null;
  last_message_from_me: boolean | null;
  muted_until: string | null;
  unread_count: number;
}

// Keyset cursor: everything strictly older than this (wa_timestamp, id).
export interface MessageCursor {
  ts: string;
  id: string;
}
