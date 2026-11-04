import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

const DEBOUNCE_MS = 500;

// Live-updates the critical-alerts lists on Client Home and Staff Home.
// Deliberately unfiltered (no `filter:` on the subscription) — RLS on
// dependency_completions is what scopes which rows each subscriber
// actually receives (a client only ever gets their own project's rows, a
// staff account gets everything), the exact same policies that already
// gate one-time reads elsewhere in this app. This was verified live
// against the real backend, not assumed: a disposable client account
// subscribed alongside a real staff account, and a row belonging to a
// different, disposable project was updated — the client's channel never
// received that event while the staff's did, and both correctly received
// events for the client's own project. Debounced like admin-web's
// DprRealtimeRefresher, since one response can touch more than one row in
// quick succession.
//
// Module-level (not per-hook-instance) channel + listener set — Home used
// to be a single Drawer.Screen, so exactly one of AppHome/ClientHome was
// ever mounted at a time and a per-instance channel was safe. Part 6 moved
// AppHome to a plain routed Stack screen reached via several different
// navigations (post-login replace, and the drawer's own "Home" item
// relaying through (authenticated)/home.tsx) — Expo Router's Stack doesn't
// unmount a screen just because you've navigated elsewhere, so a second
// visit can leave a PRIOR instance still mounted (and still subscribed)
// while a new one mounts too. Two instances both calling
// `.channel('dependency-completions-live')` crashes live with "cannot add
// postgres_changes..." (confirmed reproducing this exact error via that
// exact navigation: Flowchart -> drawer "Home" -> crash). Sharing one
// channel across every mounted consumer, reference-counted by a listener
// set, makes this safe regardless of how many instances of AppHome/
// ClientHome end up alive at once — the real fix belongs here, not in the
// navigation stack shape, since nothing else guarantees "never mounted
// twice" going forward either.
let sharedChannel: RealtimeChannel | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function ensureSubscribed() {
  if (sharedChannel) return;
  sharedChannel = supabase
    .channel('dependency-completions-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dependency_completions' }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        listeners.forEach((listener) => listener());
      }, DEBOUNCE_MS);
    })
    .subscribe();
}

function teardownChannel() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (sharedChannel) {
    supabase.removeChannel(sharedChannel);
    sharedChannel = null;
  }
}

// Subscription lifecycle: subscribes on mount (or whichever mounted
// consumer gets there first) and whenever the app returns to the
// foreground, unsubscribes when the LAST mounted consumer unmounts and
// whenever the app leaves the foreground — rather than trusting the
// realtime client's own automatic reconnect, this guarantees a fresh
// channel every time someone actually comes back to look at a screen
// (including after the app was killed and relaunched, which just re-runs
// this hook from scratch). `ensureSubscribed`/`teardownChannel` are both
// idempotent, so any number of instances calling them redundantly (e.g.
// every mounted consumer's own AppState listener firing on the same
// background/foreground transition) is harmless.
export function useDependencyCompletionsRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  // Synced via an effect, not during render — keeps the "latest callback"
  // pattern (avoids re-subscribing every time the caller's onChange
  // identity changes) without mutating a ref while rendering.
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const listener = () => onChangeRef.current();
    listeners.add(listener);
    ensureSubscribed();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        ensureSubscribed();
      } else {
        teardownChannel();
      }
    });

    return () => {
      sub.remove();
      listeners.delete(listener);
      if (listeners.size === 0) teardownChannel();
    };
  }, []);
}
