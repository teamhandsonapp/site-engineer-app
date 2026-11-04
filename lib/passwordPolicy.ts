// Mirrors admin-web's supabase/functions/manage-user/index.ts's own
// validatePassword() exactly — this copy is only for immediate typing
// feedback in the UI; the Edge Function is the real enforcement, since a
// manually-typed password reaches it directly regardless of what this
// client-side check already said.
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-zA-Z]/.test(password)) return 'Password must contain at least one letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  return null;
}
