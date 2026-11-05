// Everything the open chat needs: cached-first load, keyset paging, ONE
// realtime channel for this group, gap fill on resume/reconnect, optimistic
// send / retry / delete, throttled mark-as-read.
//
// Realtime rows are buffered and merged every 100 ms, so a burst of 200
// incoming messages becomes a handful of renders, not 200.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { logError } from '../sentryLog';
import { deleteFailedMessage, fetchMessages, markRead, sendMessage, type SendResult } from './api';
import { getMemoryMessages, loadPersistedMessages, saveMessages } from './cache';
import { markChatReadLocally } from './chatsStore';
import { isLocal, mergeMessages, newestTimestamp, oldestCursor } from './merge';
import { newClientMessageId } from './uuid';
import type { ChatMessage } from './types';

const PAGE = 40;
const GAP_LIMIT = 200;
const FLUSH_MS = 100;
const MARK_READ_EVERY_MS = 5000;

const pick = (r: Record<string, unknown>): ChatMessage => ({
  id: r.id as string,
  group_id: r.group_id as string,
  wa_message_id: (r.wa_message_id as string) ?? null,
  client_message_id: (r.client_message_id as string) ?? null,
  from_me: !!r.from_me,
  sender_wa_id: (r.sender_wa_id as string) ?? null,
  sender_name: (r.sender_name as string) ?? null,
  type: (r.type as ChatMessage['type']) ?? 'text',
  body: (r.body as string) ?? null,
  status: (r.status as ChatMessage['status']) ?? 'received',
  error: (r.error as string) ?? null,
  wa_timestamp: r.wa_timestamp as string,
});

export type SendOutcome = 'sent' | 'rate_limited' | 'failed';

export function useChatMessages(groupId: string, myName: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => getMemoryMessages(groupId) ?? []);
  const [loading, setLoading] = useState(messages.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const listRef = useRef(messages);
  const olderBusy = useRef(false);
  const buffer = useRef<ChatMessage[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMarkRead = useRef(0);
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const apply = useCallback(
    (incoming: ChatMessage[], replace = false) => {
      setMessages((prev) => {
        const next = replace ? mergeMessages(prev.filter(isLocal), incoming) : mergeMessages(prev, incoming);
        listRef.current = next;
        saveMessages(groupId, next);
        return next;
      });
    },
    [groupId]
  );

  // ── Mark as read (on open, and when new incoming messages arrive) ──
  const requestMarkRead = useCallback(() => {
    if (AppState.currentState !== 'active') return;
    const run = () => {
      lastMarkRead.current = Date.now();
      markChatReadLocally(groupId);
      markRead(groupId).catch((e) => logError(e, 'site_groups_mark_read'));
    };
    const wait = MARK_READ_EVERY_MS - (Date.now() - lastMarkRead.current);
    if (wait <= 0) run();
    else if (!markReadTimer.current) {
      markReadTimer.current = setTimeout(() => {
        markReadTimer.current = null;
        if (alive.current) run();
      }, wait);
    }
  }, [groupId]);

  // ── Initial load: memory → AsyncStorage → network ──
  const loadLatest = useCallback(async () => {
    try {
      const page = await fetchMessages(groupId, { limit: PAGE });
      if (!alive.current) return;
      const cachedNewest = newestTimestamp(listRef.current);
      const oldestOfPage = page[page.length - 1]?.wa_timestamp;
      // Cache older than the whole fresh page → there's a hole; drop it.
      const gap = page.length === PAGE && !!cachedNewest && !!oldestOfPage && cachedNewest < oldestOfPage;
      apply(page, gap);
      setHasMore(page.length === PAGE);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not load messages');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [apply, groupId]);

  // ── Gap fill after resume / reconnect: only what's newer than we have ──
  const fillGap = useCallback(async () => {
    const since = newestTimestamp(listRef.current);
    if (!since) return loadLatest();
    try {
      const fresh = await fetchMessages(groupId, { since, limit: GAP_LIMIT });
      if (!alive.current) return;
      if (fresh.length === GAP_LIMIT) return loadLatest(); // too big a gap: start from the newest page
      apply(fresh);
      if (fresh.some((m) => !m.from_me)) requestMarkRead();
    } catch (e) {
      logError(e, 'site_groups_gap_fill');
    }
  }, [apply, groupId, loadLatest, requestMarkRead]);

  useEffect(() => {
    alive.current = true;
    let channel: RealtimeChannel | null = null;

    const flush = () => {
      flushTimer.current = null;
      const rows = buffer.current;
      buffer.current = [];
      if (!rows.length || !alive.current) return;
      apply(rows);
      if (rows.some((m) => !m.from_me)) requestMarkRead();
    };
    const onRow = (payload: { new: Record<string, unknown> }) => {
      if (!payload.new?.id) return;
      buffer.current.push(pick(payload.new));
      if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
    };

    const subscribe = () => {
      if (channel) return;
      let subscribedOnce = false;
      channel = supabase
        .channel(`site-group:${groupId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `group_id=eq.${groupId}` }, onRow)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages', filter: `group_id=eq.${groupId}` }, onRow)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            if (subscribedOnce) void fillGap(); // re-joined after a drop
            subscribedOnce = true;
          }
        });
    };
    const unsubscribe = () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    (async () => {
      if (listRef.current.length === 0) {
        const persisted = await loadPersistedMessages(groupId);
        if (alive.current && persisted?.length && listRef.current.length === 0) {
          apply(persisted);
          setLoading(false);
        }
      }
      await loadLatest();
      if (alive.current) requestMarkRead();
    })();
    subscribe();

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void fillGap().then(() => alive.current && subscribe());
      } else {
        unsubscribe();
      }
    });

    return () => {
      alive.current = false;
      sub.remove();
      unsubscribe();
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (markReadTimer.current) clearTimeout(markReadTimer.current);
      flushTimer.current = null;
      markReadTimer.current = null;
      buffer.current = [];
    };
  }, [apply, fillGap, groupId, loadLatest, requestMarkRead]);

  // ── Older pages (no double loading) ──
  const loadOlder = useCallback(async () => {
    if (olderBusy.current || !hasMore || loading) return;
    const cursor = oldestCursor(listRef.current);
    if (!cursor) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(groupId, { before: cursor, limit: PAGE });
      if (!alive.current) return;
      apply(page);
      setHasMore(page.length === PAGE);
    } catch (e) {
      logError(e, 'site_groups_older');
    } finally {
      olderBusy.current = false;
      if (alive.current) setLoadingOlder(false);
    }
  }, [apply, groupId, hasMore, loading]);

  // ── Sending ──
  const deliver = useCallback(
    async (clientId: string, body: string): Promise<SendOutcome> => {
      const res: SendResult = await sendMessage(groupId, body, clientId);
      if (!alive.current) return res.ok ? 'sent' : 'failed';
      if (res.ok) {
        apply([pick(res.message as unknown as Record<string, unknown>)]);
        return 'sent';
      }
      if (res.message) apply([pick(res.message as unknown as Record<string, unknown>)]); // server's failed row
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.client_message_id === clientId && m.status === 'sending' ? { ...m, status: 'failed' as const, error: res.error } : m
        );
        listRef.current = next;
        return next;
      });
      return res.status === 429 ? 'rate_limited' : 'failed';
    },
    [apply, groupId]
  );

  const send = useCallback(
    (body: string): Promise<SendOutcome> => {
      const clientId = newClientMessageId();
      const local: ChatMessage = {
        id: `local-${clientId}`,
        group_id: groupId,
        wa_message_id: null,
        client_message_id: clientId,
        from_me: true,
        sender_wa_id: null,
        sender_name: myName,
        type: 'text',
        body,
        status: 'sending',
        error: null,
        wa_timestamp: new Date().toISOString(),
      };
      apply([local]);
      return deliver(clientId, body);
    },
    [apply, deliver, groupId, myName]
  );

  // Retry reuses the SAME client_message_id (idempotent on the server).
  const retry = useCallback(
    (m: ChatMessage): Promise<SendOutcome> => {
      if (!m.client_message_id || !m.body) return Promise.resolve('failed');
      const clientId = m.client_message_id;
      setMessages((prev) => {
        const next = prev.map((x) => (x.id === m.id ? { ...x, status: 'sending' as const, error: null } : x));
        listRef.current = next;
        return next;
      });
      return deliver(clientId, m.body);
    },
    [deliver]
  );

  const remove = useCallback(async (m: ChatMessage) => {
    if (!isLocal(m)) {
      try {
        await deleteFailedMessage(m.id); // 'unsupported' until the server RPC exists
      } catch (e) {
        logError(e, 'site_groups_delete_failed');
      }
    }
    setHidden((prev) => new Set(prev).add(m.id));
  }, []);

  const visible = hidden.size ? messages.filter((m) => !hidden.has(m.id)) : messages;

  return { messages: visible, loading, error, loadingOlder, hasMore, loadOlder, send, retry, remove, reload: loadLatest };
}
