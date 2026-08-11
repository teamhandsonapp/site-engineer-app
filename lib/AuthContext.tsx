import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import { supabase } from './supabase';
import { registerForPushNotificationsAsync } from './pushNotifications';
import { getOrCreateDeviceId } from './deviceId';
import { clearSessionStart, recordSessionStart, useForceLogoutWatch } from './forceLogoutWatch';
import { devWarn } from './devLog';
import { withTimeout } from './withTimeout';
import { insertFieldLoginEvent } from './fieldLoginEvents';
import { logAction, logError } from './sentryLog';

const FORCED_LOGOUT_MESSAGE =
  "Your session was ended by an administrator. Please log in again if this wasn't expected, or contact your admin.";

// Section 5 — deliberately generic per spec ("don't explain the exact
// trigger"): never mentions GPS/location/dead-zone specifics, just that the
// account is locked and who to contact. Shown identically whether this
// device is the one that detected the condition or a second device that
// only found out via useForceLogoutWatch.
const GPS_LOCKED_MESSAGE = 'Your account has been locked. Contact your admin to log in again.';

// A hung getSession()/profile read (dead network, unreachable Supabase)
// must not leave the app stuck on the loading spinner forever — this is
// the ceiling before that's treated as a real, recoverable failure instead.
const RESTORE_TIMEOUT_MS = 12_000;
const SIGN_IN_TIMEOUT_MS = 12_000;

// Matches Prisma's UserRole enum exactly (prisma/schema.prisma, admin-web) —
// this app is a Supabase-only client with no generated types, so this is
// hand-kept in sync with that enum rather than imported.
export type UserRole = 'admin' | 'manager' | 'senior_site_engineer' | 'site_engineer' | 'client';

// This app only ever needs to tell "client" apart from everyone else — the
// three staff-ish roles get one identical experience here, matching how
// admin-web's own proxy.ts treats admin/senior_site_engineer identically
// (any role that isn't specifically routed gets the same unscoped access;
// site_engineer is the third role folded into that same bucket for this
// app specifically, since none of the three need different UI here).
export type AppRole = 'client' | 'staff';

// Human-facing label for a raw enum value — a role shown as literal
// "senior_site_engineer" reads like an unfinished screen, not a considered
// one; this is the one place that string gets translated for display.
const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  senior_site_engineer: 'Senior Site Engineer',
  site_engineer: 'Site Engineer',
  client: 'Client',
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function appRoleFor(role: UserRole): AppRole {
  return role === 'client' ? 'client' : 'staff';
}

// The one role check every location-tracking feature (permission gate,
// thrice-daily snapshot, geofence exit tracking) shares — deliberately
// includes senior_site_engineer alongside site_engineer (both are field
// roles physically on site day-to-day), unlike appRoleFor()'s staff/client
// split which lumps senior_site_engineer in with admin/manager instead.
export function isFieldRole(role: UserRole): boolean {
  return role === 'site_engineer' || role === 'senior_site_engineer';
}

export type UserProfile = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  // Only meaningful for role === 'client'; null/undefined for staff roles.
  clientProjectId: string | null;
};

type AuthState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'signed-out'; forcedLogoutMessage?: string }
  | { status: 'signed-in'; profile: UserProfile };

// The success case carries the just-loaded profile directly — login.tsx
// needs the role right after a successful sign-in to route staff vs. client
// to their own landing screen, and reading it back off `state` there would
// be a stale-closure read (setState above hasn't flushed into THIS render's
// closure yet), not the fresh value this same call just resolved.
type SignInResult = { ok: true; profile: UserProfile } | { ok: false; message: string };

type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  retryRestore: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type ProfileLookup =
  | { ok: true; profile: UserProfile }
  | { ok: false; message: string; rlsBlocked: boolean };

// Loads the caller's own row and gates on active status — role itself is no
// longer a gate (this app now serves client + all three staff-ish roles);
// only an inactive/unprovisioned account is rejected. maybeSingle() (not
// single()) so "no row" is data, not a thrown error — that lets us tell
// "not provisioned" apart from an RLS/grant wall.
async function loadUserProfile(email: string): Promise<ProfileLookup> {
  const { data, error, status } = await supabase
    .from('user_profiles')
    .select('id, email, full_name, role, status, is_active, client_project_id, gps_locked_at')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    const rlsBlocked = status === 401 || status === 403 || error.code === '42501';
    // Never surface the raw Postgres/PostgREST error text to a signed-in
    // user (a column name, constraint detail, or connection string fragment
    // reads as broken/scary to a non-technical site user) — the specific
    // detail still reaches devWarn at both call sites below for debugging.
    devWarn('[auth] loadUserProfile query failed:', error.message);
    return {
      ok: false,
      rlsBlocked,
      message: "Couldn't load your account right now. Contact your admin if this continues.",
    };
  }

  if (!data) {
    return {
      ok: false,
      rlsBlocked: false,
      message: "Your account isn't set up for this app yet. Contact your admin.",
    };
  }
  if (data.status !== 'active' || data.is_active === false) {
    return {
      ok: false,
      rlsBlocked: false,
      message: 'Your account is currently inactive. Contact your admin.',
    };
  }
  // Section 5 — a locked account can't sign in fresh either (this is what
  // catches the case where the app was fully closed at the moment it got
  // locked, so there was no live session for the force-logout watch to
  // catch) — same generic wording as the live in-app lockout message,
  // still never explaining the exact trigger.
  if (data.gps_locked_at != null) {
    return {
      ok: false,
      rlsBlocked: false,
      message: GPS_LOCKED_MESSAGE,
    };
  }

  return {
    ok: true,
    profile: {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      role: data.role as UserRole,
      clientProjectId: data.client_project_id ?? null,
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // Bumped on every restore()/retryRestore() call so a stale attempt (one
  // superseded by a newer retry, or one that's still running after the
  // timeout below already fired) can never clobber a more recent result —
  // promises can't be cancelled, so this is what actually prevents that.
  const restoreAttemptRef = useRef(0);

  // Pure: computes what state restore should land in, without touching
  // React state itself — restore() below is the only thing allowed to
  // apply the result, so it can discard a stale/superseded computation.
  // Wrapped in useCallback (stable [] deps — it only closes over stable
  // imports, no props/state) so restore() below can safely list it as a
  // dependency without that dependency changing identity every render.
  const computeRestoredState = useCallback(async (): Promise<AuthState> => {
    const { data } = await supabase.auth.getSession();
    const email = data.session?.user?.email;
    if (!email) {
      return { status: 'signed-out' };
    }

    // Re-check active status on every relaunch — a stale local session
    // shouldn't outlive an admin deactivating this account server-side.
    const result = await loadUserProfile(email);
    if (!result.ok) {
      if (result.rlsBlocked) {
        devWarn('[auth] RLS blocked user_profiles read on session restore:', result.message);
      }
      logAction('auth', 'Involuntary sign-out — profile load rejected on restore', { rlsBlocked: result.rlsBlocked });
      await supabase.auth.signOut();
      return { status: 'signed-out' };
    }
    // Bug fix: the single-device lock this used to enforce (comparing
    // user_profiles.locked_device_id against getOrCreateDeviceId()) was
    // removed from the actual enforcement point — device-locked-login's own
    // header comment: "Multi-device login is intentionally allowed... no
    // longer read or written by anything" — but this CLIENT-SIDE check was
    // never deleted along with it, so any account that had a
    // locked_device_id value stamped under the old feature (nothing ever
    // clears it) gets signed out on every restore from a device whose ID
    // doesn't happen to match that stale value — most commonly hit by
    // reinstalling the app, which generates a fresh device ID. Confirmed
    // live: one real account currently has a non-null locked_device_id.
    // Removed entirely rather than fixed in place, matching the server
    // side's own "no longer enforced" decision.
    return { status: 'signed-in', profile: result.profile };
  }, []);

  // Never throws and never hangs forever: a dead network or an unreachable
  // Supabase project used to leave the app stuck on the loading spinner
  // indefinitely (no error, no timeout, no way out short of force-quitting)
  // — this is what actually fixes that, not just adding a try/catch for its
  // own sake. Also useCallback-wrapped (stable [] deps) so the mount effect
  // below can list it as a real dependency instead of needing an
  // eslint-disable for an intentionally-omitted one.
  const restore = useCallback(async () => {
    const attemptId = ++restoreAttemptRef.current;
    try {
      const next = await withTimeout(
        computeRestoredState(),
        RESTORE_TIMEOUT_MS,
        "Couldn't connect — check your internet connection and try again."
      );
      if (restoreAttemptRef.current !== attemptId) return; // superseded by a newer attempt
      setState(next);
      if (next.status === 'signed-in') {
        // Fire-and-forget: a fresh install/reinstall gets its token
        // re-registered on every relaunch, not just the first login, since
        // a token obtained once can go stale (see pushNotifications.ts).
        // Never awaited — this must never delay showing the signed-in app.
        registerForPushNotificationsAsync(next.profile.email);
      }
    } catch (err) {
      if (restoreAttemptRef.current !== attemptId) return;
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Something went wrong loading your session.',
      });
    }
  }, [computeRestoredState]);

  useEffect(() => {
    restore();
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION fires once right after subscribing, redundant with
      // (and sometimes racing) restore()'s own getSession() call above —
      // that call already has real timeout/retry/error-vs-signed-out
      // handling (see computeRestoredState), so this listener defers to it
      // entirely for the initial check and only reacts to events after that.
      if (event === 'INITIAL_SESSION') return;

      // A null session here can also mean "the last token refresh attempt
      // failed" — e.g. a brief network hiccup right as the app resumes or
      // relaunches (a real, observed pattern: a heavy screen crashing/
      // getting OOM-killed, then the OS relaunching the app before the
      // network/radio has fully come back up) — supabase-js reports that
      // the same way as a genuine sign-out. Re-confirming with a fresh
      // getSession() call before acting gives that one more real chance to
      // succeed (it retries via the persisted refresh token) instead of
      // kicking the user out on a transient blip. Only a session that's
      // STILL missing after that second check is treated as a real sign-out.
      if (!session) {
        logAction('auth', 'Auth state change: null session, re-confirming', { event });
        supabase.auth.getSession().then(({ data }) => {
          if (!data.session) {
            logAction('auth', 'Involuntary sign-out — session still missing after re-check', { event });
            setState({ status: 'signed-out' });
          } else {
            logAction('auth', 'Session re-confirmed after transient null — not signing out', { event });
          }
        });
      }
    });
    return () => subscription.subscription.unsubscribe();
  }, [restore]);

  // Bug 5.3 — Sentry.setUser was never called anywhere, so every issue from
  // a signed-in session reached Sentry with no user identity attached.
  // Centralized here as one effect keyed off `state` itself, rather than
  // calling Sentry.setUser at each of the several places state can BECOME
  // signed-in/signed-out (signIn(), signOut(), session restore, the forced-
  // logout watcher) — a per-call-site approach is exactly the kind of thing
  // that's easy to add correctly today and then miss on the next new sign-
  // out path added later; this can't drift out of sync with the real state.
  useEffect(() => {
    if (state.status === 'signed-in') {
      Sentry.setUser({ id: state.profile.id, email: state.profile.email, username: state.profile.fullName });
      Sentry.setTag('role', state.profile.role);
    } else if (state.status === 'signed-out') {
      Sentry.setUser(null);
    }
  }, [state]);

  // useCallback (stable [] deps — nothing inside references reactive
  // closure state, only setState/supabase/other already-stable callbacks)
  // so the memoized context value below doesn't rebuild on every render;
  // see that value's own comment for why this matters for navigation perf.
  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    // Every Supabase call in here is timeout-guarded and this whole function
    // is try/caught — the same "must never hang forever with no error"
    // requirement restore() already enforces (see its own comment above).
    // Without this, any one of these calls throwing/rejecting (a transient
    // network blip, an unexpected client-side stall) propagated straight up
    // to login.tsx's handleSubmit(), which itself has no try/catch either —
    // so setLoading(false) never ran and the Log In button just spun
    // forever with no visible error. Caught live: reproduced a real stuck
    // spinner this way while debugging.
    logAction('auth', 'Login attempt', { email });
    try {
      const deviceId = await getOrCreateDeviceId();
      const { data: fnData, error: fnError } = await withTimeout(
        supabase.functions.invoke('device-locked-login', { body: { email, password, deviceId } }),
        SIGN_IN_TIMEOUT_MS,
        "Couldn't reach the server — check your connection and try again."
      );

      if (fnError || !fnData?.ok || !fnData.access_token || !fnData.refresh_token) {
        logAction('auth', 'Login failure', { email, reason: fnData?.message ?? 'device-locked-login rejected' });
        return { ok: false, message: fnData?.message ?? 'Could not sign in — try again' };
      }

      const { error: setSessionError } = await withTimeout(
        supabase.auth.setSession({ access_token: fnData.access_token, refresh_token: fnData.refresh_token }),
        SIGN_IN_TIMEOUT_MS,
        "Couldn't complete sign-in — check your connection and try again."
      );
      if (setSessionError) {
        logAction('auth', 'Login failure', { email, reason: 'setSession failed' });
        return { ok: false, message: 'Could not sign in — try again' };
      }

      const result = await withTimeout(
        loadUserProfile(email),
        SIGN_IN_TIMEOUT_MS,
        "Couldn't load your account — check your connection and try again."
      );
      if (!result.ok) {
        if (result.rlsBlocked) {
          devWarn('[auth] RLS blocked user_profiles read on sign-in:', result.message);
        }
        logAction('auth', 'Login failure', { email, reason: result.message });
        await supabase.auth.signOut();
        return { ok: false, message: result.message };
      }

      // Anchors the force-logout kill-switch (see forceLogoutWatch.ts) — must
      // be a genuine new login, never re-stamped on restore, or a
      // force-logout issued before a relaunch but after this login would be
      // missed.
      await recordSessionStart();

      setState({ status: 'signed-in', profile: result.profile });
      logAction('auth', 'Login success', { email, role: result.profile.role });
      registerForPushNotificationsAsync(result.profile.email);
      // Fire-and-forget, field roles only — a plain informational log for
      // admin (see fieldLoginEvents.ts), never allowed to delay or fail a
      // real sign-in; that function already catches its own errors
      // internally, this .catch is defensive only.
      if (isFieldRole(result.profile.role)) {
        insertFieldLoginEvent(result.profile.id).catch(() => {});
      }
      return { ok: true, profile: result.profile };
    } catch (err) {
      // A genuinely unexpected exception (not a normal "wrong password"
      // business-logic failure, which already surfaces as a user-facing
      // message via the branches above) — this one's worth a real Sentry
      // issue.
      logError(err, 'auth_sign_in', { email });
      return { ok: false, message: err instanceof Error ? err.message : 'Could not sign in — try again' };
    }
  }, []);

  const signOut = useCallback(async () => {
    logAction('auth', 'Logout', {});
    await supabase.auth.signOut();
    await clearSessionStart();
    setState({ status: 'signed-out' });
  }, []);

  const profileEmail = state.status === 'signed-in' ? state.profile.email : null;
  useForceLogoutWatch(profileEmail, async (reason) => {
    await supabase.auth.signOut();
    await clearSessionStart();
    setState({
      status: 'signed-out',
      forcedLogoutMessage: reason === 'gps_locked' ? GPS_LOCKED_MESSAGE : FORCED_LOGOUT_MESSAGE,
    });
  });

  const retryRestore = useCallback(() => {
    setState({ status: 'loading' });
    restore();
  }, [restore]);

  // Memoized so a re-render of AuthProvider that doesn't actually change
  // `state` (or any of these now-stable callbacks) doesn't hand every
  // useAuth() consumer a brand-new object reference — confirmed live: this
  // was cascading into every still-mounted drawer screen (most of which
  // call useAuth() via FieldLocationGuard or directly) on every single
  // navigation, since context consumers re-render on value identity, not
  // deep equality. See app/_layout.tsx's NavigationLogger for the other
  // half of this same fix.
  const value = useMemo(
    () => ({ state, signIn, signOut, retryRestore }),
    [state, signIn, signOut, retryRestore]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
