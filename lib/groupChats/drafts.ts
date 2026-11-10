// Unsent composer text per group, kept on this phone only (memory +
// AsyncStorage) so leaving a chat doesn't lose a half-typed message and the
// chat list can show "Draft: …". Never sent anywhere.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

const KEY = 'siteGroups.drafts.v1';
let drafts: Record<string, string> = {};
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (raw) {
        drafts = { ...JSON.parse(raw), ...drafts };
        emit();
      }
    })
    .catch(() => {});
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function setDraft(groupId: string, text: string): void {
  const next = { ...drafts };
  if (text.trim()) next[groupId] = text;
  else delete next[groupId];
  drafts = next;
  emit();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void AsyncStorage.setItem(KEY, JSON.stringify(drafts)).catch(() => {}), 400);
}

export function getDraft(groupId: string): string {
  ensureLoaded();
  return drafts[groupId] ?? '';
}

function subscribe(l: () => void) {
  ensureLoaded();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDrafts(): Record<string, string> {
  return useSyncExternalStore(subscribe, () => drafts, () => drafts);
}
