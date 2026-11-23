import { supabase } from '../supabase';
import type { Meeting } from './types';

// DEV TEST ONLY — MoM meeting invites via the Meta WhatsApp Cloud API test
// number (Edge Function send-meeting-whatsapp, docs/whatsapp.md). Off unless
// EXPO_PUBLIC_WA_TEST=true; with it off nothing here runs.
export const WA_TEST_ENABLED = process.env.EXPO_PUBLIC_WA_TEST === 'true';

export interface WaInviteResult {
  name: string;
  phone: string | null;
  status: 'sent' | 'failed' | 'skipped';
  messageId: string | null;
  error: string | null;
  via?: 'template' | 'text';
}

export interface WaSendSummary {
  meetingId: string;
  template: string | null;
  sent: number;
  failed: number;
  skipped: number;
  results: WaInviteResult[];
  error: string | null; // whole call failed (not signed in, not deployed, offline…)
}

export async function sendMeetingWhatsAppTest(
  meeting: Meeting,
  projectName: string,
  invitees: { name: string; phone: string | null }[] = meeting.invitees
): Promise<WaSendSummary> {
  const base = { meetingId: meeting.id, template: null, sent: 0, failed: 0, skipped: 0, results: [] as WaInviteResult[] };
  try {
    const { data, error } = await supabase.functions.invoke('send-meeting-whatsapp', {
      body: {
        title: meeting.title,
        projectName,
        date: meeting.date,
        time: meeting.time,
        venue: meeting.venue,
        invitees: invitees.map((i) => ({ name: i.name, phone: i.phone })),
      },
    });
    if (error) {
      // FunctionsHttpError carries the response; pull the server's message if there is one.
      let msg = error.message;
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json().catch(() => null);
        if (body?.error) msg = body.error;
      }
      return { ...base, error: msg };
    }
    const d = data as { template?: string; sent: number; failed: number; skipped: number; results: WaInviteResult[] };
    return { ...base, template: d.template ?? null, sent: d.sent, failed: d.failed, skipped: d.skipped, results: d.results ?? [], error: null };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}
