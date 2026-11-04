import { supabase } from './supabase';

// Admin-only broadcast push — goes through the send-broadcast-push Edge
// Function (admin-web/supabase/functions/send-broadcast-push), which checks
// the caller is an admin server-side and reads everyone's push tokens with
// its own service-role client. user_profiles' RLS never lets this app read
// another user's token directly.
export type PushAudience = 'field' | 'all';

async function invokeWithToken(body: Record<string, unknown>, accessToken: string) {
  return supabase.functions.invoke('send-broadcast-push', {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function invokeBroadcast<T>(body: Record<string, unknown>): Promise<T> {
  // lib/supabase.ts stops auto-refresh whenever the app isn't foreground
  // (and on web, whenever the tab loses focus), so the stored access token
  // can be stale by the time this runs. getSession() alone isn't enough:
  // it trusts the token's own expiry, so a session the server has already
  // ended (e.g. force-logout) still looks valid locally. On a 401, force a
  // refresh once and retry before giving up.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You’re signed out — log in again.');
  let { data, error } = await invokeWithToken(body, session.access_token);
  if ((error as { context?: Response } | null)?.context?.status === 401) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (!refreshed.session) throw new Error('Your session has ended — log out and log in again.');
    ({ data, error } = await invokeWithToken(body, refreshed.session.access_token));
  }
  if (error) {
    // A non-2xx response puts the function's own { message } in the
    // response body, not in error.message (which is a generic "non-2xx").
    const context = (error as { context?: Response }).context;
    const detail = context ? await context.json().catch(() => null) : null;
    throw new Error(detail?.message ?? error.message);
  }
  if (!data?.ok) throw new Error(data?.message ?? 'Request failed');
  return data as T;
}

export function fetchPushAudienceSummary(audience: PushAudience) {
  return invokeBroadcast<{ total: number; withToken: number }>({ type: 'summary', audience });
}

export function sendBroadcastPush(audience: PushAudience, title: string, body: string) {
  return invokeBroadcast<{ sent: number; failed: number }>({ type: 'send', audience, title, body });
}
