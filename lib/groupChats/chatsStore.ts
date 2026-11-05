// Chat list + tab badge for the SELECTED project, shared by the list screen
// and the bottom tab. ONE realtime channel on whatsapp_groups filtered by
// project_id: every new message updates its group's last_message_* row
// (DB trigger), so this one channel is enough to know "something changed".
// Each change triggers a get_group_chats refetch, throttled to once per 3 s.
// The channel is dropped when the app goes to the background and rebuilt
// (after a refetch) when it comes back.

import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { useProject } from '../ProjectContext';
import { logError } from '../sentryLog';
import { onSiteGroupsReset, useSiteGroupsEnabled } from './access';
import { fetchChats } from './api';
import { getMemoryChats, loadPersistedChats, saveChats } from './cache';
import type { GroupChat } from './types';

const THROTTLE_MS = 3000;

interface State {
  projectId: string | null;
  chats: GroupChat[] | null; // null = nothing loaded yet for this project
  loading: boolean;
  error: string | null;
}

let state: State = { projectId: null, chats: null, loading: false, error: null };
const listeners = new Set<() => void>();
let channel: RealtimeChannel | null = null;
let lastFetchAt = 0;
let trailing: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

async function refetch(): Promise<void> {
  const projectId = state.projectId;
  if (!projectId) return;
  if (inflight) return inflight;
  lastFetchAt = Date.now();
  inflight = (async () => {
    try {
      const chats = await fetchChats(projectId);
      if (state.projectId !== projectId) return; // switched meanwhile
      saveChats(projectId, chats);
      setState({ chats, loading: false, error: null });
    } catch (e) {
      if (state.projectId !== projectId) return;
      logError(e, 'site_groups_list');
      setState({ loading: false, error: e instanceof Error ? e.message : 'Could not load site groups' });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Leading + trailing throttle: at most one refetch per THROTTLE_MS, and a
// burst of changes always ends with one final refetch.
function throttledRefetch() {
  const wait = THROTTLE_MS - (Date.now() - lastFetchAt);
  if (wait <= 0 && !trailing) {
    void refetch();
    return;
  }
  if (!trailing) {
    trailing = setTimeout(() => {
      trailing = null;
      void refetch();
    }, Math.max(wait, 0));
  }
}

function dropChannel() {
  if (trailing) {
    clearTimeout(trailing);
    trailing = null;
  }
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
}

function openChannel(projectId: string) {
  dropChannel();
  let subscribedOnce = false;
  channel = supabase
    .channel(`site-groups-list:${projectId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_groups', filter: `project_id=eq.${projectId}` }, throttledRefetch)
    .subscribe((status) => {
      // A re-join after a dropped connection may have missed changes.
      if (status === 'SUBSCRIBED') {
        if (subscribedOnce) throttledRefetch();
        subscribedOnce = true;
      }
    });
}

async function selectProject(projectId: string | null) {
  if (projectId === state.projectId) return;
  dropChannel();
  // Clear the old project's list immediately, then show cache, then fetch.
  setState({ projectId, chats: null, loading: !!projectId, error: null });
  if (!projectId) return;
  openChannel(projectId);
  void refetch();
  const cached = getMemoryChats(projectId) ?? (await loadPersistedChats(projectId));
  // Cache only fills the gap until the first fetch lands.
  if (state.projectId === projectId && cached && !state.chats) setState({ chats: cached });
}

onSiteGroupsReset(() => {
  dropChannel();
  setState({ projectId: null, chats: null, loading: false, error: null });
});

// Mounted once inside the authenticated area.
export function useSiteGroupChatsSync(): void {
  const enabled = useSiteGroupsEnabled();
  const { selectedProjectId } = useProject();
  const projectId = enabled ? selectedProjectId : null;

  useEffect(() => {
    void selectProject(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    // Remount on the same project (e.g. after sign-out/in): selectProject
    // returned early, so make sure the channel exists.
    if (!channel && AppState.currentState === 'active') {
      openChannel(projectId);
      void refetch();
    }
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void refetch();
        openChannel(projectId);
      } else {
        dropChannel();
      }
    });
    return () => {
      sub.remove();
      dropChannel();
    };
  }, [projectId]);
}

export function useSiteGroupChats(): State & { refresh: () => Promise<void> } {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  return { ...s, refresh: refetch };
}

export function useSiteGroupsUnreadTotal(): number {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  return (s.chats ?? []).reduce((n, c) => n + (c.unread_count || 0), 0);
}

// After opening a chat: clear its badge right away (the server already did).
export function markChatReadLocally(groupId: string): void {
  if (!state.chats?.some((c) => c.id === groupId && c.unread_count > 0)) return;
  setState({ chats: state.chats.map((c) => (c.id === groupId ? { ...c, unread_count: 0 } : c)) });
}
