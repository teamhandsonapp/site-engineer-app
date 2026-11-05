// Pure message-list helpers. Lists are kept NEWEST FIRST (matches the
// inverted FlatList and the API order).

import type { ChatMessage, MessageStatus } from './types';

const RANK: Record<MessageStatus, number> = { failed: 0, sending: 1, received: 2, sent: 3, delivered: 4, read: 5 };

export const isLocal = (m: ChatMessage) => m.id.startsWith('local-');

function newerFirst(a: ChatMessage, b: ChatMessage): number {
  if (a.wa_timestamp !== b.wa_timestamp) return a.wa_timestamp < b.wa_timestamp ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// Combine an existing list with incoming rows (fetched page or realtime).
// - same id → incoming wins, but a server status never moves backwards
//   (realtime UPDATEs can arrive out of order), except an explicit failure
//   of a message that was still sending
// - same client_message_id → the server row replaces the optimistic one, and
//   an echo row that took over a pending row's client_message_id replaces it
// - result: no duplicates, sorted newest first
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<string, ChatMessage>();
  const idByClient = new Map<string, string>();

  const put = (m: ChatMessage) => {
    const clientMatchId = m.client_message_id ? idByClient.get(m.client_message_id) : undefined;
    if (clientMatchId && clientMatchId !== m.id) {
      const other = byId.get(clientMatchId)!;
      // Keep the server row over a local placeholder; between two server
      // rows (pending row vs. webhook echo) keep the one that arrived last.
      if (isLocal(m) && !isLocal(other)) return;
      byId.delete(clientMatchId);
    }
    const prev = byId.get(m.id);
    if (prev && !isLocal(prev) && RANK[m.status] < RANK[prev.status] && !(m.status === 'failed' && prev.status === 'sending')) {
      m = { ...m, status: prev.status };
    }
    byId.set(m.id, m);
    if (m.client_message_id) idByClient.set(m.client_message_id, m.id);
  };

  existing.forEach(put);
  incoming.forEach(put);
  return [...byId.values()].sort(newerFirst);
}

export function newestTimestamp(list: ChatMessage[]): string | null {
  const firstServer = list.find((m) => !isLocal(m));
  return firstServer?.wa_timestamp ?? null;
}

export function oldestCursor(list: ChatMessage[]): { ts: string; id: string } | null {
  for (let i = list.length - 1; i >= 0; i--) if (!isLocal(list[i])) return { ts: list[i].wa_timestamp, id: list[i].id };
  return null;
}
