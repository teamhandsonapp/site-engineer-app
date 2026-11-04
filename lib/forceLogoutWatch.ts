import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { logAction } from './sentryLog';

// Exported so gpsLockout.ts's startup-grace check (Section 5) can anchor to
// the exact same "genuine new login" moment this file already stamps,
// instead of introducing a second, possibly-drifting timestamp for the same
// concept.
export const SESSION_STARTED_KEY = 'session-started-at';
const POLL_MS = 60_000;

// Called once, at the moment a real sign-in succeeds (see AuthContext.tsx's
// signIn()) — NOT on every restore/relaunch. Persisted so it survives the
// app being backgrounded or killed and reopened; only a genuine new login
// should ever move this forward, or a forceLogoutAt set before a relaunch
// (but after the original login) would look older than a freshly-reset
// "session start" and the force-logout would be silently missed.
export async function recordSessionStart(): Promise<void> {
  await AsyncStorage.setItem(SESSION_STARTED_KEY, new Date().toISOString());
}

async function getSessionStartedAt(): Promise<string> {
  const existing = await AsyncStorage.getItem(SESSION_STARTED_KEY);
  if (existing) return existing;
  // Bootstrapping fallback: a session that somehow has no stored start yet
  // (e.g. this feature shipping to an already-signed-in install) treats
  // "now" as its effective start rather than being uncomparable — this
  // can't retroactively catch a forceLogoutAt set before this exact
  // moment, but every one set after it works correctly from here on.
  const now = new Date().toISOString();
  await AsyncStorage.setItem(SESSION_STARTED_KEY, now);
  return now;
}

export async function clearSessionStart(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_STARTED_KEY);
}

// Two layers, both watched here: Realtime for near-instant effect while the
// app is open, plus a 60s poll (and a check on every foreground resume) as
// a fallback in case the realtime connection dropped without the app
// noticing — this is security-sensitive enough not to rely on realtime
// alone. Neither layer is the actual security boundary by itself (a
// modified client could ignore both) — the real backstop is the server
// deleting the account's auth.sessions/auth.refresh_tokens rows directly
// (see admin-web's forceLogoutUser action), which stops a new access token
// from ever being silently minted regardless of whether this check runs.
export type ForcedLogoutReason = 'admin' | 'gps_locked';

export function useForceLogoutWatch(email: string | null, onForcedLogout: (reason: ForcedLogoutReason) => void) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggeredRef = useRef(false);
  const onForcedLogoutRef = useRef(onForcedLogout);
  // Synced via an effect, not during render — same reasoning as
  // dependencyCompletionsRealtime.ts's identical pattern.
  useEffect(() => {
    onForcedLogoutRef.current = onForcedLogout;
  });

  useEffect(() => {
    if (!email) return;
    triggeredRef.current = false;

    async function checkNow() {
      if (triggeredRef.current || !email) return;
      const { data } = await supabase
        .from('user_profiles')
        .select('force_logout_at, gps_locked_at')
        .eq('email', email)
        .maybeSingle();
      if (!data?.force_logout_at) return;

      const sessionStartedAt = await getSessionStartedAt();
      if (new Date(data.force_logout_at).getTime() > new Date(sessionStartedAt).getTime()) {
        triggeredRef.current = true;
        // lock_own_account_for_gps (see gpsLockout.ts) sets force_logout_at
        // AND gps_locked_at in the same statement — a non-null gps_locked_at
        // is what tells this apart from a plain admin block, on WHICHEVER
        // device notices first (this same device that triggered the lock,
        // or another one signed into the same account).
        const reason: ForcedLogoutReason = data.gps_locked_at != null ? 'gps_locked' : 'admin';
        logAction('auth', 'Involuntary sign-out — force-logout detected', {
          forceLogoutAt: data.force_logout_at,
          sessionStartedAt,
          reason,
        });
        onForcedLogoutRef.current(reason);
      }
    }

    function subscribe() {
      if (channelRef.current) return;
      channelRef.current = supabase
        .channel(`force-logout-watch-${email}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'user_profiles', filter: `email=eq.${email}` },
          () => checkNow()
        )
        .subscribe();
    }

    function unsubscribe() {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    }

    subscribe();
    checkNow();
    pollRef.current = setInterval(checkNow, POLL_MS);

    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        subscribe();
        checkNow();
      } else {
        unsubscribe();
      }
    });

    return () => {
      appStateSub.remove();
      unsubscribe();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [email]);
}
