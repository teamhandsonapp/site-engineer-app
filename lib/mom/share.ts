// Message text + "open in WhatsApp / mail app / Google Calendar" links for
// the MoM section. Everything here works without any server: each link just
// opens the right app pre-filled, and the admin taps Send there. Fully
// automatic sending (WhatsApp Business API / an email service) can replace
// these later without changing the screens.

import { Linking } from 'react-native';
import { fetchContacts } from '../contacts';
import { fetchProjectContacts } from '../projectContacts';
import { devWarn } from '../devLog';
import type { Meeting, Recipient } from './types';

// ---------- recipients (Contact Book + Specific Book) ----------

export async function fetchRecipients(projectId: string): Promise<Recipient[]> {
  const [contacts, projectContacts] = await Promise.all([
    fetchContacts().catch((err) => {
      devWarn('[mom] Contact Book unavailable:', err);
      return [];
    }),
    fetchProjectContacts(projectId).catch((err) => {
      devWarn('[mom] Specific Book unavailable:', err);
      return [];
    }),
  ]);
  const list: Recipient[] = [
    ...contacts.map((c) => ({
      key: `contact:${c.id}`,
      source: 'contact' as const,
      name: c.name,
      phone: c.phoneNumber || null,
      email: c.email,
      category: c.category,
      company: c.companyName,
    })),
    ...projectContacts.map((c) => ({
      key: `project:${c.id}`,
      source: 'project' as const,
      name: c.name,
      phone: c.phoneNumber || null,
      email: c.email,
      category: c.category,
      company: c.companyName,
    })),
  ];
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- formatting ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatTime12(time: string): string {
  const [h, min] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
}

// Meeting start as a real instant. Times are entered in IST (+05:30) —
// every project this app serves is in India, same convention as attendance.
export function meetingStart(m: Pick<Meeting, 'date' | 'time'>): Date {
  return new Date(`${m.date}T${m.time}:00+05:30`);
}

export function meetingEnd(m: Pick<Meeting, 'date' | 'time' | 'durationMinutes'>): Date {
  return new Date(meetingStart(m).getTime() + m.durationMinutes * 60_000);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

// ---------- message text ----------

export function inviteMessage(m: Meeting, projectName: string): string {
  return [
    `Meeting invitation — ${projectName}`,
    '',
    `*${m.title}*`,
    `Date: ${formatDateLong(m.date)}`,
    `Time: ${formatTime12(m.time)} (${formatDuration(m.durationMinutes)})`,
    `Venue: ${m.venue}`,
    m.notes ? `\n${m.notes}` : '',
    '',
    'Please reply with the agenda points you want to discuss.',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
}

export function agendaRequestMessage(m: Meeting, projectName: string): string {
  return [
    `Agenda request — ${projectName}`,
    '',
    `For the meeting "${m.title}" on ${formatDateLong(m.date)} at ${formatTime12(m.time)}, please send the points you want on the agenda.`,
  ].join('\n');
}

export function finalAgendaMessage(m: Meeting, projectName: string): string {
  return [
    `Meeting agenda — ${projectName}`,
    '',
    `*${m.title}*`,
    `${formatDateLong(m.date)}, ${formatTime12(m.time)} · ${m.venue}`,
    '',
    ...m.finalAgenda.map((p, i) => `${i + 1}. ${p}`),
  ].join('\n');
}

// ---------- links ----------

// wa.me needs the number in international format, digits only. A bare
// 10-digit number is treated as Indian (+91), matching the Contact Book.
export function whatsappNumber(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 ? digits : null;
}

export function whatsappUrl(phone: string | null, text: string): string | null {
  const n = whatsappNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

export function mailtoUrl(emails: string[], subject: string, body: string): string {
  return `mailto:${emails.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function calendarStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Google Calendar's "create event" page, pre-filled — no Google sign-in or
// API key needed in the app; the admin just taps Save in Google Calendar.
export function googleCalendarUrl(m: Meeting, projectName: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${m.title} — ${projectName}`,
    dates: `${calendarStamp(meetingStart(m))}/${calendarStamp(meetingEnd(m))}`,
    details: [m.notes, m.finalAgenda.length ? `Agenda:\n${m.finalAgenda.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : '']
      .filter(Boolean)
      .join('\n\n'),
    location: m.venue,
    ctz: 'Asia/Kolkata',
  });
  const guests = m.invitees.map((i) => i.email).filter((e): e is string => !!e);
  if (guests.length) params.set('add', guests.join(','));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function openLink(url: string): Promise<void> {
  await Linking.openURL(url);
}
