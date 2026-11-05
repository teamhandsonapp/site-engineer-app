// Turns a newest-first message list into FlatList rows for an INVERTED list:
// date separators, "show sender name" on the first bubble of a run, and
// tight spacing inside a run. Computed once per list change (useMemo).

import { dayKey, dayLabel } from './format';
import type { ChatMessage } from './types';

export type ChatItem =
  | { kind: 'msg'; key: string; message: ChatMessage; showSender: boolean; tight: boolean }
  | { kind: 'day'; key: string; label: string };

const RUN_GAP_MS = 5 * 60 * 1000;

function sameRun(a: ChatMessage, b: ChatMessage): boolean {
  if (a.from_me !== b.from_me) return false;
  if (!a.from_me && (a.sender_wa_id ?? a.sender_name) !== (b.sender_wa_id ?? b.sender_name)) return false;
  if (dayKey(a.wa_timestamp) !== dayKey(b.wa_timestamp)) return false;
  return Math.abs(Date.parse(a.wa_timestamp) - Date.parse(b.wa_timestamp)) < RUN_GAP_MS;
}

export function buildItems(list: ChatMessage[], now = new Date()): ChatItem[] {
  const items: ChatItem[] = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const older = list[i + 1];
    const newer = list[i - 1];
    items.push({
      kind: 'msg',
      key: m.id,
      message: m,
      showSender: !m.from_me && !(older && sameRun(older, m)),
      tight: !!newer && sameRun(m, newer),
    });
    // In an inverted list the row AFTER a message is drawn ABOVE it.
    if (!older || dayKey(older.wa_timestamp) !== dayKey(m.wa_timestamp)) {
      items.push({ kind: 'day', key: `day-${dayKey(m.wa_timestamp)}`, label: dayLabel(m.wa_timestamp, now) });
    }
  }
  return items;
}
