// Site Groups access: who may see group chats at all, and who may send.
//
// Source of truth is the my_whatsapp_access() RPC (whatsapp_access table).
// Role does NOT matter — an admin without a row has no access. Loaded once
// after login / on app start, cached in memory and AsyncStorage, refreshed
// on foreground at most every 10 minutes (so a removed user loses access
// without logging out). On logout, or when access disappears, every Site
// Groups cache is wiped.
//
// When WHATSAPP_ENABLED is false nothing here touches the network.

import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { useAuth } from '../AuthContext';
import { WHATSAPP_ENABLED } from '../featureFlags';
import { logError } from '../sentryLog';

export interface SiteGroupsAccess {
  hasAccess: boolean;
  canSend: boolean;
  canManage: boolean;
}

const NO_ACCESS: SiteGroupsAccess = { hasAccess: false, canSend: false, canManage: false };
const REFRESH_EVERY_MS = 10 * 60 * 1000;
export const STORAGE_PREFIX = 'sitegroups:';
const accessKey = (profileId: string) => `${STORAGE_PREFIX}access:${profileId}`;

interface State {
  profileId: string | null;
  access: SiteGroupsAccess;
  loading: boolean;
  fetchedAt: number;
}

let state: State = { profileId: null, access: NO_ACCESS, loading: false, fetchedAt: 0 };
const listeners = new Set<() => void>();
const resetListeners = new Set<() => void>();

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// In-memory Site Groups caches register here so a reset clears them too.
export function onSiteGroupsReset(fn: () => void): () => void {
  resetListeners.add(fn);
  return () => resetListeners.delete(fn);
}

// Wipes every Site Groups key in AsyncStorage and every in-memory cache.
export async function resetSiteGroupsData(): Promise<void> {
  resetListeners.forEach((fn) => fn());
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(STORAGE_PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch (e) {
    logError(e, 'site_groups_cache_clear');
  }
}

async function fetchAccess(profileId: string, force = false): Promise<void> {
  if (!WHATSAPP_ENABLED) return;
  if (!force && state.profileId === profileId && Date.now() - state.fetchedAt < REFRESH_EVERY_MS) return;

  // Show the cached answer immediately on a cold start.
  if (state.profileId !== profileId) {
    setState({ profileId, access: NO_ACCESS, loading: true, fetchedAt: 0 });
    try {
      const raw = await AsyncStorage.getItem(accessKey(profileId));
      if (raw && state.profileId === profileId) setState({ access: { ...NO_ACCESS, ...JSON.parse(raw) } });
    } catch {
      // cache miss is fine
    }
  }

  const { data, error } = await supabase.rpc('my_whatsapp_access');
  if (state.profileId !== profileId) return; // user changed meanwhile
  if (error) {
    // Keep whatever we had (cached); a network blip must not hide the chats.
    setState({ loading: false });
    return;
  }
  const row = Array.isArray(data) ? data[0] : data;
  const next: SiteGroupsAccess = {
    hasAccess: !!row?.has_access,
    canSend: !!row?.has_access && !!row?.can_send,
    canManage: !!row?.has_access && !!row?.can_manage,
  };
  const lost = state.access.hasAccess && !next.hasAccess;
  setState({ access: next, loading: false, fetchedAt: Date.now() });
  if (lost) await resetSiteGroupsData();
  try {
    await AsyncStorage.setItem(accessKey(profileId), JSON.stringify(next));
  } catch {
    // non-fatal
  }
}

// Mounted once at the app root (inside AuthProvider).
export function useSiteGroupsAccessSync(): void {
  const { state: auth } = useAuth();
  const profileId = auth.status === 'signed-in' ? auth.profile.id : null;
  const signedOut = auth.status === 'signed-out';

  useEffect(() => {
    if (!WHATSAPP_ENABLED || !profileId) return;
    void fetchAccess(profileId);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void fetchAccess(profileId);
    });
    return () => sub.remove();
  }, [profileId]);

  useEffect(() => {
    // Always on sign-out (also a cold start that is already signed out, e.g.
    // after a forced logout while the app was closed): the next person to
    // log in on this phone must never see the previous user's chats.
    if (!signedOut) return;
    setState({ profileId: null, access: NO_ACCESS, loading: false, fetchedAt: 0 });
    void resetSiteGroupsData();
  }, [signedOut]);
}

export function useSiteGroupsAccess(): SiteGroupsAccess & { loading: boolean } {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  return { ...s.access, loading: s.loading };
}

// Feature flag AND access — what navigation and screens should check.
export function useSiteGroupsEnabled(): boolean {
  const { hasAccess } = useSiteGroupsAccess();
  return WHATSAPP_ENABLED && hasAccess;
}

export function refreshSiteGroupsAccess(): void {
  if (state.profileId) void fetchAccess(state.profileId, true);
}
