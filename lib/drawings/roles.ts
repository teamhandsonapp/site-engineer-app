import type { UserRole } from '../AuthContext';

// Same split as supabase/drawings-app-access.sql:
//   viewers (view drawings, add tags and tag photos) = web roles + site engineer
//   editors (everything the web allows)              = admin, manager, senior SE
export function canViewDrawings(role: UserRole): boolean {
  return role === 'admin' || role === 'manager' || role === 'senior_site_engineer' || role === 'site_engineer';
}
export function canEditDrawings(role: UserRole): boolean {
  return role === 'admin' || role === 'manager' || role === 'senior_site_engineer';
}
