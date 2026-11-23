import { supabase } from '../supabase';
import type { MeetingEventInput } from '../../supabase/functions/_shared/meetingEvent';
import type { Meeting } from './types';

// Google Calendar for MoM meetings (2026-11-19). The Edge Function
// sync-meeting-calendar holds the company Google login and creates, moves or
// cancels the event; Google emails the invites. Setup: docs/google-calendar.md.

export type CalendarResult = { ok: true; eventId: string; htmlLink: string | null } | { ok: false; error: string };

export function meetingEventInput(m: Meeting, projectName: string): MeetingEventInput {
  return {
    meetingId: m.id,
    title: m.title,
    projectName,
    date: m.date,
    time: m.time,
    durationMinutes: m.durationMinutes,
    venue: m.venue,
    notes: m.notes,
    agenda: m.agenda,
    discussionItems: (m.discussionItems ?? []).map((i) => (i.taskCode ? `${i.taskCode} ${i.title}` : i.title)),
    attendeeEmails: m.invitees.map((i) => i.email).filter((e): e is string => !!e),
    createdByName: m.createdByName,
  };
}

async function call(body: object): Promise<CalendarResult> {
  try {
    const { data, error } = await supabase.functions.invoke('sync-meeting-calendar', { body });
    if (error) {
      // FunctionsHttpError carries the response; use the server's plain message when there is one.
      let msg = error.message;
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const b = await ctx.json().catch(() => null);
        if (b?.error) msg = b.error;
      }
      if (/not found|404|Failed to send a request/i.test(msg) && !/calendar was not found/i.test(msg)) {
        msg = 'Google Calendar is not switched on yet (the sync-meeting-calendar function is not deployed)';
      }
      return { ok: false, error: msg };
    }
    const d = data as { eventId: string; htmlLink?: string | null };
    return { ok: true, eventId: d.eventId, htmlLink: d.htmlLink ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function syncMeetingToCalendar(m: Meeting, projectName: string): Promise<CalendarResult> {
  return call({ action: 'upsert', meeting: meetingEventInput(m, projectName) });
}

export function removeMeetingFromCalendar(meetingId: string): Promise<CalendarResult> {
  return call({ action: 'delete', meetingId });
}

// How many invitees will get the Google invite (the rest have no email).
export function calendarGuestCount(m: Pick<Meeting, 'invitees'>): number {
  return new Set(m.invitees.map((i) => i.email?.trim().toLowerCase()).filter(Boolean)).size;
}
