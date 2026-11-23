// send-meeting-whatsapp — DEV TEST ONLY (MoM meeting invites over the Meta
// WhatsApp Cloud API test number). Called by the app right after a meeting
// is saved when EXPO_PUBLIC_WA_TEST=true. See docs/whatsapp.md.
//
// Secrets (supabase secrets set --env-file .env.meta.local):
//   META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, META_WA_WABA_ID,
//   META_WA_TEMPLATE (hello_world | meeting_invite), META_WA_TEMPLATE_LANG,
//   META_WA_TEST_ALLOWLIST (comma-separated, digits with country code),
//   META_WA_ALLOW_TEXT_FALLBACK (true/false)
// The token is never returned or logged.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const GRAPH = 'https://graph.facebook.com/v25.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

type Invitee = { name?: string; phone?: string | null };
type Input = {
  title?: string;
  projectName?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM 24h, IST
  venue?: string;
  invitees?: Invitee[];
};
type Result = {
  name: string;
  phone: string | null;
  status: 'sent' | 'failed' | 'skipped';
  messageId: string | null;
  error: string | null;
  via?: 'template' | 'text';
};

// +91 81110 41101 -> 918111041101 ; 8111041101 -> 918111041101 ; 0091… -> 91…
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : (iso ?? '');
}
function fmtTime(hhmm: string | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return hhmm ?? '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function plainError(code: number | undefined, message: string | undefined): string {
  switch (code) {
    case 190:
      return 'Access token expired or invalid — generate a new token in Meta and update META_WA_TOKEN';
    case 131030:
      return 'Recipient is not in the test number’s allowed list — add and verify this number in Meta (API Setup › To)';
    case 132001:
      return 'Template does not exist or is not approved for this language';
    case 132000:
      return 'Template parameter count does not match the template';
    case 131047:
      return 'More than 24 hours since this person last messaged the test number — only templates can be sent';
    case 131026:
      return 'Message could not be delivered (number not on WhatsApp?)';
    case 100:
      return `Bad request: ${message ?? 'invalid parameter'}`;
    default:
      return message ? `Meta error${code ? ` ${code}` : ''}: ${message}` : 'Unknown error from Meta';
  }
}

async function postMessage(token: string, phoneId: string, payload: unknown): Promise<{ ok: boolean; id: string | null; code?: number; message?: string }> {
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, id: body?.messages?.[0]?.id ?? null };
  return { ok: false, id: null, code: body?.error?.code, message: body?.error?.error_data?.details ?? body?.error?.message };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // 1. Logged-in user only.
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);

  // 2. Config.
  const token = Deno.env.get('META_WA_TOKEN');
  const phoneId = Deno.env.get('META_WA_PHONE_NUMBER_ID');
  if (!token || !phoneId) return json({ error: 'WhatsApp test is not configured (META_WA_TOKEN / META_WA_PHONE_NUMBER_ID missing)' }, 500);
  const template = Deno.env.get('META_WA_TEMPLATE') || 'hello_world';
  const lang = Deno.env.get('META_WA_TEMPLATE_LANG') || (template === 'hello_world' ? 'en_US' : 'en');
  const allow = new Set(
    (Deno.env.get('META_WA_TEST_ALLOWLIST') ?? '')
      .split(',')
      .map((s) => normalizePhone(s.trim()))
      .filter((s): s is string => !!s)
  );
  const textFallback = (Deno.env.get('META_WA_ALLOW_TEXT_FALLBACK') ?? '').toLowerCase() === 'true';

  // 3. Input.
  let input: Input;
  try {
    input = await req.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }
  const invitees = Array.isArray(input.invitees) ? input.invitees.slice(0, 50) : [];
  const title = (input.title ?? '').trim() || 'Meeting';
  const project = (input.projectName ?? '').trim() || '-';
  const date = fmtDate(input.date);
  const time = fmtTime(input.time);
  const venue = (input.venue ?? '').trim() || '-';

  const results: Result[] = [];
  const seen = new Set<string>();
  for (const inv of invitees) {
    const name = (inv.name ?? '').trim() || 'there';
    const phone = normalizePhone(inv.phone ?? null);
    const base = { name, phone };
    if (!phone) {
      results.push({ ...base, status: 'skipped', messageId: null, error: 'No valid phone number' });
      continue;
    }
    if (seen.has(phone)) {
      results.push({ ...base, status: 'skipped', messageId: null, error: 'Same number already messaged' });
      continue;
    }
    seen.add(phone);
    if (!allow.has(phone)) {
      results.push({ ...base, status: 'skipped', messageId: null, error: 'not in test list' });
      continue;
    }

    const components =
      template === 'hello_world'
        ? undefined
        : [{ type: 'body', parameters: [name, title, project, date, time, venue].map((text) => ({ type: 'text', text })) }];
    const sent = await postMessage(token, phoneId, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: { name: template, language: { code: lang }, ...(components ? { components } : {}) },
    });
    if (sent.ok) {
      results.push({ ...base, status: 'sent', messageId: sent.id, error: null, via: 'template' });
      continue;
    }

    let error = plainError(sent.code, sent.message);
    if (textFallback && sent.code !== 190) {
      const text = `Hi ${name}, you're invited to "${title}" (${project}) on ${date} at ${time}, ${venue}.`;
      const t = await postMessage(token, phoneId, { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } });
      if (t.ok) {
        results.push({ ...base, status: 'sent', messageId: t.id, error: null, via: 'text' });
        continue;
      }
      error = `${error}; text fallback also failed: ${plainError(t.code, t.message)}`;
    }
    results.push({ ...base, status: 'failed', messageId: null, error });
  }

  const count = (s: Result['status']) => results.filter((r) => r.status === s).length;
  return json({ template, sent: count('sent'), failed: count('failed'), skipped: count('skipped'), results });
});
