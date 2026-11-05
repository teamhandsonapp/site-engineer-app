// Site Groups caches.
//  • Messages: in-memory list per group (what the open chat had), plus the
//    latest 30 per group in AsyncStorage for an instant cold open. At most
//    20 groups are persisted; the least recently opened is evicted.
//    AsyncStorage writes are debounced per group.
//  • Chat list: per project, memory + AsyncStorage.
// Everything is wiped on logout / loss of access (onSiteGroupsReset).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { onSiteGroupsReset, STORAGE_PREFIX } from './access';
import { isLocal } from './merge';
import type { ChatMessage, GroupChat } from './types';

const PERSIST_PER_GROUP = 30;
const MAX_PERSISTED_GROUPS = 20;
const MEMORY_PER_GROUP = 500;
const WRITE_DEBOUNCE_MS = 1000;

const msgKey = (groupId: string) => `${STORAGE_PREFIX}msgs:${groupId}`;
const chatsKey = (projectId: string) => `${STORAGE_PREFIX}chats:${projectId}`;
const INDEX_KEY = `${STORAGE_PREFIX}msgs-index`; // [{ groupId, usedAt }]

const memoryMessages = new Map<string, ChatMessage[]>();
const memoryChats = new Map<string, GroupChat[]>();
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

onSiteGroupsReset(() => {
  memoryMessages.clear();
  memoryChats.clear();
  pendingWrites.forEach((t) => clearTimeout(t));
  pendingWrites.clear();
});

/* ── Messages ────────────────────────────────────────────────────── */

export function getMemoryMessages(groupId: string): ChatMessage[] | null {
  return memoryMessages.get(groupId) ?? null;
}

export async function loadPersistedMessages(groupId: string): Promise<ChatMessage[] | null> {
  try {
    const raw = await AsyncStorage.getItem(msgKey(groupId));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : null;
  } catch {
    return null;
  }
}

export function saveMessages(groupId: string, list: ChatMessage[]): void {
  memoryMessages.set(groupId, list.length > MEMORY_PER_GROUP ? list.slice(0, MEMORY_PER_GROUP) : list);
  const t = pendingWrites.get(groupId);
  if (t) clearTimeout(t);
  pendingWrites.set(
    groupId,
    setTimeout(() => {
      pendingWrites.delete(groupId);
      void persist(groupId);
    }, WRITE_DEBOUNCE_MS)
  );
}

async function persist(groupId: string): Promise<void> {
  const list = memoryMessages.get(groupId);
  if (!list) return;
  // Optimistic/unsent bubbles stay in memory only.
  const latest = list.filter((m) => !isLocal(m)).slice(0, PERSIST_PER_GROUP);
  try {
    const rawIndex = await AsyncStorage.getItem(INDEX_KEY);
    const index: { groupId: string; usedAt: number }[] = rawIndex ? JSON.parse(rawIndex) : [];
    const next = [{ groupId, usedAt: Date.now() }, ...index.filter((e) => e.groupId !== groupId)];
    const evicted = next.slice(MAX_PERSISTED_GROUPS);
    await AsyncStorage.multiSet([
      [msgKey(groupId), JSON.stringify(latest)],
      [INDEX_KEY, JSON.stringify(next.slice(0, MAX_PERSISTED_GROUPS))],
    ]);
    if (evicted.length) await AsyncStorage.multiRemove(evicted.map((e) => msgKey(e.groupId)));
  } catch {
    // cache is best-effort
  }
}

/* ── Chat list ───────────────────────────────────────────────────── */

export function getMemoryChats(projectId: string): GroupChat[] | null {
  return memoryChats.get(projectId) ?? null;
}

export async function loadPersistedChats(projectId: string): Promise<GroupChat[] | null> {
  try {
    const raw = await AsyncStorage.getItem(chatsKey(projectId));
    return raw ? (JSON.parse(raw) as GroupChat[]) : null;
  } catch {
    return null;
  }
}

export function saveChats(projectId: string, chats: GroupChat[]): void {
  memoryChats.set(projectId, chats);
  AsyncStorage.setItem(chatsKey(projectId), JSON.stringify(chats)).catch(() => {});
}
