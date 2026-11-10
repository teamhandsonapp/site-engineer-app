// Turns a newest-first message list into FlatList rows for an INVERTED list:
// date separators plus precomputed layout flags per bubble, so bubbles never
// look at their neighbours while rendering. Computed once per list change.
//
// A "run" = consecutive messages from the same sender (for our own number:
// the same staff member) on the same day, each ≤ 5 min after the previous.
//   runStart (top of a run)  → tail, sender name, avatar, 8 pt gap above
//   inside a run             → 2 pt gap, no tail, no name, avatar space kept
// Plus a "N UNREAD MESSAGES" bar above the oldest unread incoming message
// (unreadCount = the chat's unread count when the screen opened).

import { dayChipLabel, dayKey } from './format';
import type { ChatMessage } from './types';

export type ChatItem =
  | { kind: 'msg'; key: string; message: ChatMessage; runStart: boolean; runEnd: boolean; showName: boolean }
  | { kind: 'day'; key: string; label: string; dayKey: string }
  | { kind: 'unread'; key: string; count: number };

const RUN_GAP_MS = 5 * 60 * 1000;

const senderKey = (m: ChatMessage) => (m.from_me ? `me:${m.sender_name ?? ''}` : `in:${m.sender_wa_id ?? m.sender_name ?? ''}`);

function sameRun(older: ChatMessage, newer: ChatMessage): boolean {
  if (senderKey(older) !== senderKey(newer)) return false;
  if (dayKey(older.wa_timestamp) !== dayKey(newer.wa_timestamp)) return false;
  return Date.parse(newer.wa_timestamp) - Date.parse(older.wa_timestamp) <= RUN_GAP_MS;
}

// Stable across the optimistic → server swap, so a sent bubble isn't remounted.
export const messageKey = (m: ChatMessage) => (m.client_message_id ? `c:${m.client_message_id}` : m.id);

export function buildItems(list: ChatMessage[], myName: string | null, now = new Date(), unreadCount = 0): ChatItem[] {
  const items: ChatItem[] = [];
  let incomingSeen = 0;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const older = list[i + 1];
    const newer = list[i - 1];
    const runStart = !(older && sameRun(older, m));
    const runEnd = !(newer && sameRun(m, newer));
    // Our own number: show the staff name when someone else sent it.
    const showName = runStart && (m.from_me ? !!m.sender_name && m.sender_name !== myName : true);
    items.push({ kind: 'msg', key: messageKey(m), message: m, runStart, runEnd, showName });
    // In an inverted list the row AFTER a message is drawn ABOVE it.
    if (!m.from_me && unreadCount > 0 && ++incomingSeen === unreadCount) {
      items.push({ kind: 'unread', key: 'unread-banner', count: unreadCount });
    }
    if (!older || dayKey(older.wa_timestamp) !== dayKey(m.wa_timestamp)) {
      const k = dayKey(m.wa_timestamp);
      items.push({ kind: 'day', key: `day-${k}`, label: dayChipLabel(m.wa_timestamp, now), dayKey: k });
    }
  }
  return items;
}
