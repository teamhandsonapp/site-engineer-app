import { supabase } from './supabase';
import type { UserRole } from './AuthContext';

// Mirrors admin-web's new Permission enum (prisma/schema.prisma) — a flat
// action-level permission, not a resource/screen gate (that's still role
// itself, e.g. the Access & Roles / Invoice drawer items only rendering for
// admin/manager — see DrawerContent.tsx). ALL implies every lesser
// permission; hasPermission() below encodes that, don't compare for an
// exact match elsewhere.
export type Permission = 'READ' | 'WRITE' | 'DELETE' | 'ALL';

// Read-only reference data (role_permissions has no INSERT/UPDATE/DELETE
// grant to `authenticated` at all — see supabase/rls-policies.sql), so this
// is a plain cached fetch, not something this app ever writes. The actual
// enforcement for anything sensitive (creating a user, sending an invoice)
// happens server-side in the manage-user/send-invoice Edge Functions, which
// look this same table up themselves rather than trusting whatever this
// client-side check already decided — this is for UI gating (hide a button
// a call would just get rejected anyway), not the real security boundary.
let cache: { role: UserRole; permissions: Set<Permission> } | null = null;

export async function fetchPermissionsForRole(role: UserRole): Promise<Set<Permission>> {
  if (cache && cache.role === role) return cache.permissions;
  const { data, error } = await supabase.from('role_permissions').select('permission').eq('role', role);
  if (error) throw new Error(error.message);
  const permissions = new Set((data ?? []).map((r) => r.permission as Permission));
  cache = { role, permissions };
  return permissions;
}

export function hasPermission(permissions: Set<Permission>, required: Permission): boolean {
  if (permissions.has('ALL')) return true;
  return permissions.has(required);
}
