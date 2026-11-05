// Display helpers for Site Groups (pure; no React).

import { chat } from '../theme';
import type { ChatMessage, GroupChat, MessageType } from './types';

const PLACEHOLDER: Record<Exclude<MessageType, 'text'>, string> = {
  image: '📷 Photo',
  video: '🎥 Video',
  document: '📄 Document',
  audio: '🎤 Voice message',
  sticker: 'Sticker',
  unsupported: 'Unsupported message',
};

// Bubble text: text body, or a placeholder (+ caption) for anything else.
export function messageText(m: Pick<ChatMessage, 'type' | 'body'>): { placeholder: string | null; text: string | null } {
  if (m.type === 'text') return { placeholder: null, text: m.body };
  return { placeholder: PLACEHOLDER[m.type] ?? PLACEHOLDER.unsupported, text: m.body };
}

// Chat list preview: "You: …", "Ravi: …". The groups table only keeps the
// last message's TEXT (not its type), so a caption-less photo has empty text;
// shown as a generic attachment until the type is stored server-side.
export function previewText(c: Pick<GroupChat, 'last_message_text' | 'last_message_sender' | 'last_message_from_me' | 'last_message_at'>): string {
  if (!c.last_message_at) return 'No messages yet';
  const text = (c.last_message_text ?? '').replace(/\s+/g, ' ').trim() || '📎 Attachment';
  if (c.last_message_from_me) return `You: ${text}`;
  const who = (c.last_message_sender ?? '').trim();
  return who ? `${who}: ${text}` : text;
}

const pad = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function timeHHmm(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Chat list: today → HH:mm, Yesterday, else "3 Nov" (+ year if not this year).
export function listTime(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (sameDay(d, now)) return timeHHmm(iso);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

// Date separator inside a chat: Today / Yesterday / "Wed, 5 Nov 2026".
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Stable colour per sender (same person → same colour, every time).
export function senderColorIndex(key: string | null): number {
  const s = key ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % chat.senderPalette.length;
}

export function senderColor(key: string | null): string {
  return chat.senderPalette[senderColorIndex(key)];
}

export const unreadLabel = (n: number) => (n > 99 ? '99+' : String(n));

export function isMuted(mutedUntil: string | null, now = Date.now()): boolean {
  return !!mutedUntil && new Date(mutedUntil).getTime() > now;
}
