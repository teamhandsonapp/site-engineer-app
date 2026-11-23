// MoM meeting -> Google Calendar event body (2026-11-19). Plain TypeScript with
// no Deno or React Native APIs, so the Edge Function (sync-meeting-calendar)
// and the Jest tests (lib/__tests__/meetingEvent.test.ts) share it.

export interface MeetingEventInput {
  meetingId: string;
  title: string;
  projectName: string;
  date: string; // 'YYYY-MM-DD' (IST)
  time: string; // 'HH:MM' 24h (IST)
  durationMinutes: number;
  venue: string;
  notes?: string;
  agenda?: string;
  discussionItems?: string[];
  attendeeEmails: string[];
  createdByName?: string | null;
}

export const TIME_ZONE = 'Asia/Kolkata';
export const MAX_ATTENDEES = 50;

// Google lets us pick the event id (base32hex: 0-9 a-v, 5–1024 chars). Hex of
// the meeting id fits that alphabet, so the same meeting always maps to the
// same event: a retry or a second save updates it instead of creating a copy.
export function eventIdFor(meetingId: string): string {
  let hex = '';
  for (const ch of meetingId) {
    const code = ch.codePointAt(0)!;
    hex += code.toString(16).padStart(2, '0');
  }
  return `pmcmom${hex}`.slice(0, 1024);
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function cleanEmails(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const e = (raw ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= MAX_ATTENDEES) break;
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

// Wall-clock IST start/end as 'YYYY-MM-DDTHH:MM:00' (India has no DST, so
// adding minutes to the wall clock is exact).
export function wallClockRange(date: string, time: string, durationMinutes: number): { start: string; end: string } {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) throw new Error('Meeting date or time is not valid');
  const mins = Math.max(5, Math.min(24 * 60, Math.round(durationMinutes) || 60));
  const s = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]));
  const e = new Date(s.getTime() + mins * 60_000);
  const fmt = (x: Date) =>
    `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}:00`;
  return { start: fmt(s), end: fmt(e) };
}

export function buildMeetingEvent(m: MeetingEventInput) {
  const { start, end } = wallClockRange(m.date, m.time, m.durationMinutes);
  const title = m.title.trim() || 'Meeting';
  const project = m.projectName.trim();
  const items = (m.discussionItems ?? []).map((s) => s.trim()).filter(Boolean);
  const description = [
    project ? `Project: ${project}` : '',
    m.agenda?.trim() ? `Agenda:\n${m.agenda.trim()}` : '',
    items.length ? `To discuss:\n${items.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
    m.notes?.trim() ? `Notes:\n${m.notes.trim()}` : '',
    m.createdByName ? `Created by ${m.createdByName} in PMC Portal.` : 'Created in PMC Portal.',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 8000);
  return {
    id: eventIdFor(m.meetingId),
    summary: (project ? `${title} — ${project}` : title).slice(0, 250),
    location: m.venue.trim().slice(0, 500),
    description,
    start: { dateTime: start, timeZone: TIME_ZONE },
    end: { dateTime: end, timeZone: TIME_ZONE },
    attendees: cleanEmails(m.attendeeEmails).map((email) => ({ email })),
    status: 'confirmed',
    reminders: { useDefault: true },
  };
}
