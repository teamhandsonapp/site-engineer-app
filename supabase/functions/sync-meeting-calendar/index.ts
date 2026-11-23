// sync-meeting-calendar (2026-11-19): puts a MoM meeting in the company Google
// Calendar, or takes it out. Called by the app after a meeting is saved or
// deleted (lib/mom/googleCalendar.ts). Setup: docs/google-calendar.md.
//
// One company Google account owns the calendar. Its login lives only here,
// as Supabase secrets (never in the app):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
//   GOOGLE_CALENDAR_ID (optional, default 'primary')
// Google emails the invite to every attendee (sendUpdates=all), and the
// update / cancellation when the meeting changes or is deleted.
//
// Body: { action: 'upsert', meeting: MeetingEventInput } | { action: 'delete', meetingId }
// Reply: { ok: true, eventId, htmlLink? } or { error } with a plain message.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { buildMeetingEvent, eventIdFor, type MeetingEventInput } from '../_shared/meetingEvent.ts';

const API = 'https://www.googleapis.com/calendar/v3';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function accessToken(): Promise<string> {
  const id = Deno.env.get('GOOGLE_CLIENT_ID');
  const secret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const refresh = Deno.env.get('GOOGLE_REFRESH_TOKEN');
  if (!id || !secret || !refresh) throw new Error('Google Calendar is not set up yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN missing)');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    if (body.error === 'invalid_grant') {
      throw new Error('The Google login for the company calendar has expired or was removed. Redo step 4 of docs/google-calendar.md');
    }
    throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`);
  }
  return body.access_token as string;
}

function plainGoogleError(status: number, body: { error?: { message?: string } }): string {
  const msg = body?.error?.message ?? '';
  if (status === 401) return 'Google rejected the company calendar login. Redo step 4 of docs/google-calendar.md';
  if (status === 403 && /rate|quota/i.test(msg)) return 'Google Calendar limit reached for now. Try again in a few minutes';
  if (status === 403) return `Google Calendar refused the request: ${msg || 'no permission'}`;
  if (status === 404) return 'The company calendar was not found. Check GOOGLE_CALENDAR_ID';
  return `Google Calendar error ${status}${msg ? `: ${msg}` : ''}`;
}

async function google(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // 1. Signed-in Admin or Manager only (same rule as the MoM screen).
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const email = userData?.user?.email;
  if (userErr || !email) return json({ error: 'Not signed in' }, 401);
  const { data: profile } = await supabase.from('user_profiles').select('role, status, is_active').eq('email', email).maybeSingle();
  if (!profile || profile.status !== 'active' || profile.is_active === false || !['admin', 'manager'].includes(profile.role)) {
    return json({ error: 'Only Admin and Manager can add meetings to Google Calendar' }, 403);
  }

  // 2. Input.
  let input: { action?: string; meeting?: MeetingEventInput; meetingId?: string };
  try {
    input = await req.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }
  const calendar = encodeURIComponent(Deno.env.get('GOOGLE_CALENDAR_ID') || 'primary');

  try {
    const token = await accessToken();

    if (input.action === 'delete') {
      if (!input.meetingId) return json({ error: 'meetingId missing' }, 400);
      const id = eventIdFor(input.meetingId);
      const r = await google(token, 'DELETE', `/calendars/${calendar}/events/${id}?sendUpdates=all`);
      // Already gone counts as done.
      if (r.ok || r.status === 404 || r.status === 410) return json({ ok: true, eventId: id });
      return json({ error: plainGoogleError(r.status, r.data) }, 502);
    }

    if (input.action === 'upsert') {
      if (!input.meeting?.meetingId) return json({ error: 'meeting missing' }, 400);
      let event;
      try {
        event = buildMeetingEvent(input.meeting);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Meeting details are not valid' }, 400);
      }
      const { id, ...patch } = event;
      // Update first (also brings back an event that was cancelled before);
      // create it when Google has never seen this id.
      let r = await google(token, 'PATCH', `/calendars/${calendar}/events/${id}?sendUpdates=all`, patch);
      if (r.status === 404) r = await google(token, 'POST', `/calendars/${calendar}/events?sendUpdates=all`, event);
      if (!r.ok) return json({ error: plainGoogleError(r.status, r.data) }, 502);
      return json({ ok: true, eventId: id, htmlLink: (r.data as { htmlLink?: string }).htmlLink ?? null });
    }

    return json({ error: "action must be 'upsert' or 'delete'" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
