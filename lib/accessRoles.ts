import { supabase } from './supabase';
import type { UserRole } from './AuthContext';

export interface ManagedUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: 'active' | 'invited' | 'disabled';
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
  clientProjectId: string | null;
}

interface RawManagedUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: 'active' | 'invited' | 'disabled';
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  client_project_id: string | null;
}

// user_profiles' own RLS only allows reading your own row (see
// supabase/rls-policies.sql's "own profile readable") — this screen needs
// every user, so it goes through the manage-user Edge Function instead,
// which checks the caller is actually admin/manager server-side before
// using its own service-role client to bypass that row-scoping. This is
// the real enforcement; the drawer nav hiding this screen from anyone else
// (see DrawerContent.tsx) is just the UI reflecting what the function
// would do anyway if called directly.
async function invokeManageUser<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('manage-user', { body });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.message ?? 'Request failed');
  return data as T;
}

export async function fetchAllUsers(): Promise<ManagedUser[]> {
  const { users } = await invokeManageUser<{ users: RawManagedUser[] }>({ type: 'listUsers' });
  return users.map((u) => ({
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    isActive: u.is_active,
    lastLogin: u.last_login,
    createdAt: u.created_at,
    clientProjectId: u.client_project_id,
  }));
}

// 'manual' requires `password` too; 'generate' ignores it (the Edge
// Function generates server-side, for real cryptographic randomness — see
// its own generateStrongPassword()). Shared by createUser and
// resetPassword so both ever offer exactly the same two modes.
export interface PasswordInput {
  passwordMode: 'manual' | 'generate';
  password?: string;
}

// Previews a real, server-generated password before the admin commits to
// creating/resetting anything — see the Edge Function's own
// generatePassword comment for why this has to be server-side even for a
// preview.
export async function generatePassword(): Promise<string> {
  const { password } = await invokeManageUser<{ password: string }>({ type: 'generatePassword' });
  return password;
}

export async function createUser(
  input: {
    fullName: string;
    email: string;
    phone?: string;
    role: UserRole;
    clientProjectId?: string;
  } & PasswordInput
): Promise<{ userId: string; temporaryPassword: string }> {
  return invokeManageUser({ type: 'createUser', ...input });
}

export async function changeUserRole(userId: string, role: UserRole): Promise<void> {
  await invokeManageUser({ type: 'changeRole', userId, role });
}

// Admin-initiated — never requires the user's OLD password. Immediately
// invalidates their existing sessions (see the Edge Function's own
// resetPassword handler for exactly how). Returns the password that was
// actually set so the caller can display it once, same as createUser.
export async function resetUserPassword(userId: string, input: PasswordInput): Promise<{ password: string }> {
  return invokeManageUser({ type: 'resetPassword', userId, ...input });
}

// Deactivate/Reactivate — mirrors admin-web's blockUser/unblockUser (same
// status field, same "disabled ends their current session, active doesn't
// touch it" behavior). Admin-only, same as resetPassword (see the Edge
// Function's own ADMIN_ONLY_ACTIONS). Soft/Hard Delete are deliberately
// admin-web-only for now — see this app's own Access & Roles screen
// comment for why.
export async function changeUserStatus(userId: string, status: 'active' | 'disabled'): Promise<void> {
  await invokeManageUser({ type: 'changeStatus', userId, status });
}

// Third Create-User mode alongside manual/generate password — no password
// is set here at all. The invitee completes setup on admin-web's own
// accept-invite page (this app has no web-based "set your password"
// surface of its own), reached via a link the Edge Function emails through
// Resend. emailSent: false means the account was still created — the
// email just didn't go out — surfaced by CreateUserSheet as a warning
// rather than a failure, same as admin-web's own AddUserModal.
export async function sendInvite(
  input: {
    fullName: string;
    email: string;
    phone?: string;
    role: UserRole;
    clientProjectId?: string;
  }
): Promise<{ userId: string; emailSent: boolean; emailError?: string }> {
  return invokeManageUser({ type: 'sendInvite', ...input });
}
