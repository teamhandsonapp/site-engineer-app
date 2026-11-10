// Pure text helpers for chat bubbles: tappable links / phones / emails, and
// "emoji-only" detection. Results are memoised per message body by the
// bubble (useMemo), never recomputed on scroll.

export type Segment = { kind: 'text'; text: string } | { kind: 'url' | 'email' | 'phone'; text: string; href: string };

// URL (with or without scheme), email, or a phone number of 10+ digits
// (spaces / dashes allowed, optional +country code).
const TOKEN =
  /\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]]|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+\d{1,3}[\s-]?)?\b\d(?:[\s-]?\d){9,13}\b/gi;

export function linkify(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const text = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: body.slice(last, at) });
    if (text.includes('@') && !/^https?:|^www\./i.test(text)) out.push({ kind: 'email', text, href: `mailto:${text}` });
    else if (/^(https?:\/\/|www\.)/i.test(text)) out.push({ kind: 'url', text, href: /^https?:/i.test(text) ? text : `https://${text}` });
    else out.push({ kind: 'phone', text, href: `tel:${text.replace(/[\s-]/g, '')}` });
    last = at + text.length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}

export const hasLinks = (body: string) => linkify(body).some((s) => s.kind !== 'text');

// 1–3 emoji and nothing else (whitespace allowed) → shown large, no bubble.
// Built defensively: if the JS engine lacks Unicode property escapes, the
// feature simply turns off instead of crashing.
let EMOJI: RegExp | null = null;
try {
  EMOJI = new RegExp('\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier}|\\u200D\\p{Extended_Pictographic})*', 'gu');
} catch {
  EMOJI = null;
}

export function emojiOnlyCount(body: string | null): number {
  if (!EMOJI || !body) return 0;
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 40) return 0;
  const found = trimmed.match(EMOJI);
  if (!found || found.length > 3) return 0;
  return trimmed.replace(EMOJI, '').replace(/[\s️]/g, '') === '' ? found.length : 0;
}

export const LONG_TEXT = 900;

export function initials(name: string | null): string {
  const n = (name ?? '').trim();
  if (!n) return '?';
  if (/^\+?[\d\s-]+$/.test(n)) return n.replace(/\D/g, '').slice(-2) || '?';
  const parts = n.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
