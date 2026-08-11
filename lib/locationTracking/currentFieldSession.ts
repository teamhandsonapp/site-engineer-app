import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { isFieldRole, type UserRole } from '../AuthContext';
import { SELECTED_PROJECT_KEY } from './storageKeys';

export interface FieldSession {
  userId: string;
  projectId: string | null;
}

// Resolves "who is this, and are they a field role" from scratch — used by
// every background-context entry point (the background snapshot task, the
// geofence event task), which has no React context/hooks to read
// useAuth()/useProject() from. Re-derives from the persisted Supabase
// session on every call rather than trusting anything cached from
// registration time, since a background task registered by one signed-in
// field-role user can outlive that sign-in (expo-background-task persists
// registrations across restarts) — if a different, non-field-role account
// is signed in by the time this actually runs, this correctly reports null
// and the caller no-ops instead of acting on stale identity.
//
// Explicitly awaits getSession() first (not a cached read) — this is the
// fix for the token going stale while the app was backgrounded (see
// lib/supabase.ts's own comment on pausing auto-refresh off-foreground):
// getSession() checks expiry and refreshes via the stored refresh token
// even with that timer stopped.
export async function getCurrentFieldSession(): Promise<FieldSession | null> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.user.email) return null;

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, role')
    .eq('email', sessionData.session.user.email)
    .maybeSingle();

  if (profileError || !profile || !isFieldRole(profile.role as UserRole)) return null;

  const projectId = await AsyncStorage.getItem(SELECTED_PROJECT_KEY);
  return { userId: profile.id, projectId: projectId || null };
}

export async function persistSelectedProjectId(projectId: string | null): Promise<void> {
  if (projectId) {
    await AsyncStorage.setItem(SELECTED_PROJECT_KEY, projectId);
  } else {
    await AsyncStorage.removeItem(SELECTED_PROJECT_KEY);
  }
}

// Read-side counterpart, used by ProjectContext.tsx to rehydrate
// selectedProjectId on a fresh mount — the write side above previously
// only ever ran from useFieldLocationTracking.ts, which is exclusively
// active for field roles (isField gate), so admin/manager selections were
// NEVER persisted at all: exactly the reported "no project assigned after
// navigating to Attendance/Settings" bug, which only actually manifests
// for admin/manager (the roles that use those two screens). ProjectContext
// now writes here directly on every explicit selection, for every role,
// closing that gap at the source rather than only for field roles.
export async function getPersistedSelectedProjectId(): Promise<string | null> {
  return (await AsyncStorage.getItem(SELECTED_PROJECT_KEY)) || null;
}
