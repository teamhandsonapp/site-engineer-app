// One chat bubble (docs/site-groups-chat-design.md §6) — WhatsApp layout
// and proportions in our colours.
//
// Performance: React.memo with a narrow comparison (id, status, body, the
// precomputed layout flags and `selected`), so a new incoming message
// re-renders only that bubble and at most its neighbour whose run flags
// changed. Styles are prebuilt StyleSheets per scheme; link parsing is
// memoised per body.
//
// Layout: radius 8, max 75 % wide, padding 6 / 8 / 8, system font 15/20.
// The first bubble of a run gets a sharp tail at its TOP corner (top-left
// incoming, top-right outgoing), the sender name inside at the top
// (incoming) and the 28 pt avatar beside it, aligned to the top; later
// bubbles keep the avatar's space empty so they line up. Time + ticks sit
// inside, bottom-right; an invisible copy of them ends the last text line
// so text wraps around them (short messages keep the time on the same line).

import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { chatPalettes, type ChatPalette } from '../../lib/theme';
import { CHAT_SCHEMES, senderSlot, themedStyles, useChatScheme, withAlpha, type ChatScheme } from '../../lib/groupChats/chatTheme';
import { timeHHmm } from '../../lib/groupChats/format';
import { emojiOnlyCount, initials, linkify, LONG_TEXT, type Segment } from '../../lib/groupChats/textParse';
import type { ChatMessage, MessageStatus, MessageType } from '../../lib/groupChats/types';

// Dev-only profiling aid: counts bubble renders so a test can check that
// one incoming message doesn't re-render every bubble. Exposed on
// globalThis in development only; release builds never touch it.
export const bubbleRenderCount = { current: 0 };
if (__DEV__) (globalThis as { __siteGroupsBubbleRenders?: { current: number } }).__siteGroupsBubbleRenders = bubbleRenderCount;

type TickKind = 'muted' | 'read';
const TICK: Partial<Record<MessageStatus, { icon: keyof typeof Ionicons.glyphMap; kind: TickKind; label: string }>> = {
  sending: { icon: 'time-outline', kind: 'muted', label: 'sending' },
  sent: { icon: 'checkmark', kind: 'muted', label: 'sent' },
  delivered: { icon: 'checkmark-done', kind: 'muted', label: 'delivered' },
  read: { icon: 'checkmark-done', kind: 'read', label: 'read' },
};

const MEDIA: Partial<Record<MessageType, { icon: keyof typeof Ionicons.glyphMap; label: string }>> = {
  image: { icon: 'camera', label: 'Photo' },
  video: { icon: 'videocam', label: 'Video' },
  document: { icon: 'document-text', label: 'Document' },
  audio: { icon: 'mic', label: 'Voice message' },
  sticker: { icon: 'happy', label: 'Sticker' },
  unsupported: { icon: 'help-circle', label: 'Unsupported message' },
};

export const AVATAR = 28;
const AVATAR_GAP = 6;
const TAIL_W = 8;
const TAIL_H = 12;
const FAILED_W = 26; // red "!" column outside an outgoing bubble

interface Props {
  message: ChatMessage;
  runStart: boolean; // first (top) bubble of a run → tail, name, avatar, 8 pt gap
  runEnd: boolean; // last (bottom) bubble of a run (kept for neighbours' memo)
  showName: boolean;
  selected: boolean; // long-pressed → light highlight over the row
  onLongPress: (m: ChatMessage) => void;
  onFailedPress: (m: ChatMessage) => void;
  onLinkPress: (s: Segment) => void;
}

function Bubble({ message: m, runStart, showName, selected, onLongPress, onFailedPress, onLinkPress }: Props) {
  if (__DEV__) bubbleRenderCount.current++;
  const scheme = useChatScheme();
  const s = sheet(scheme);
  const p = chatPalettes[scheme];
  const out = m.from_me;
  const failed = m.status === 'failed';
  const tick = out && !failed ? TICK[m.status] : undefined;
  const media = m.type !== 'text' ? MEDIA[m.type] ?? MEDIA.unsupported : undefined;
  const slot = senderSlot(m.sender_wa_id ?? m.sender_name);
  const name = out ? m.sender_name : m.sender_name ?? m.sender_wa_id ?? 'Unknown';
  const time = timeHHmm(m.wa_timestamp);

  const [expanded, setExpanded] = useState(false);
  const body = m.body ?? '';
  const long = body.length > LONG_TEXT + 100; // don't cut off just a few words
  const shown = long && !expanded ? body.slice(0, LONG_TEXT).replace(/\s+\S*$/, '') : body;
  const segments = useMemo(() => (shown ? linkify(shown) : []), [shown]);
  const emojiCount = m.type === 'text' ? emojiOnlyCount(body) : 0;

  const longPress = useCallback(() => onLongPress(m), [onLongPress, m]);
  const press = useCallback(() => onFailedPress(m), [onFailedPress, m]);

  const a11y = [
    out ? (name && showName ? `${name}, sent from our number` : 'You') : name,
    time,
    media ? `${media.label}${body ? `, ${body}` : ''}` : body,
    failed ? 'not sent' : tick?.label,
  ]
    .filter(Boolean)
    .join(', ');

  const meta = (
    <View style={emojiCount ? s.metaPill : s.meta} pointerEvents="none">
      <Text style={s.time} allowFontScaling={false}>
        {time}
      </Text>
      {tick ? <Ionicons name={tick.icon} size={16} color={tick.kind === 'read' ? p.tickRead : p.meta} style={s.tick} /> : null}
    </View>
  );
  // Same width as the real meta, invisible, at the end of the last line.
  const spacer = (
    <Text style={s.spacer} allowFontScaling={false}>
      {'   '}
      {time}
      {tick ? '    ' : ''}
    </Text>
  );

  const bubbleStyle = [s.bubble, out ? s.out : s.in, runStart && (out ? s.tailCornerOut : s.tailCornerIn)];

  return (
    <View style={[s.row, out ? s.rowOut : s.rowIn, runStart ? s.gapRun : s.gapTight]}>
      {selected ? <View style={s.selected} pointerEvents="none" /> : null}
      {!out ? runStart ? <Avatar name={name} slot={slot} scheme={scheme} /> : <View style={s.avatarSpacer} /> : null}
      {out && failed ? (
        <Pressable onPress={press} accessibilityRole="button" accessibilityLabel="Not sent, tap to retry" hitSlop={8} style={s.failedDot}>
          <Text style={s.failedDotText}>!</Text>
        </Pressable>
      ) : null}
      <View style={[s.column, out ? s.colOut : s.colIn]}>
        {emojiCount ? (
          <Pressable onLongPress={longPress} delayLongPress={350} accessibilityLabel={a11y} accessibilityHint="Long press for options" style={s.emojiWrap}>
            <Text style={s.emoji} accessible={false}>
              {body.trim()}
            </Text>
            {meta}
          </Pressable>
        ) : (
          <Pressable
            onLongPress={longPress}
            onPress={failed ? press : undefined}
            delayLongPress={350}
            accessibilityRole={failed ? 'button' : undefined}
            accessibilityLabel={a11y}
            accessibilityHint={failed ? 'Retry or delete this message' : 'Long press for options'}
            style={bubbleStyle}
          >
            {runStart ? <View style={out ? s.tailOut : s.tailIn} /> : null}
            {showName && name ? (
              <Text numberOfLines={1} style={out ? s.staffName : nameStyles[scheme][slot]}>
                {name}
              </Text>
            ) : null}
            {media ? (
              <View style={s.mediaRow}>
                <Ionicons name={media.icon} size={16} color={p.meta} />
                <Text style={s.mediaLabel}>
                  {media.label}
                  {body ? null : spacer}
                </Text>
              </View>
            ) : null}
            {body ? (
              <Text style={s.text} selectable={false}>
                {segments.map((seg, i) =>
                  seg.kind === 'text' ? (
                    seg.text
                  ) : (
                    <Text key={i} style={s.link} onPress={() => onLinkPress(seg)} suppressHighlighting accessibilityRole="link">
                      {seg.text}
                    </Text>
                  )
                )}
                {long && !expanded ? (
                  <>
                    {'… '}
                    <Text style={s.link} onPress={() => setExpanded(true)} accessibilityRole="button">
                      Read more
                    </Text>
                  </>
                ) : null}
                {spacer}
              </Text>
            ) : null}
            {!body && !media ? <Text style={s.text}>{spacer}</Text> : null}
            {meta}
          </Pressable>
        )}
        {failed ? (
          <Text style={s.failedNote} onPress={press} accessibilityRole="button">
            Not sent · Tap to retry
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export const MessageBubble = memo(
  Bubble,
  (a, b) =>
    a.message.id === b.message.id &&
    a.message.status === b.message.status &&
    a.message.body === b.message.body &&
    a.message.type === b.message.type &&
    a.runStart === b.runStart &&
    a.runEnd === b.runEnd &&
    a.showName === b.showName &&
    a.selected === b.selected &&
    a.onLongPress === b.onLongPress &&
    a.onFailedPress === b.onFailedPress &&
    a.onLinkPress === b.onLinkPress
);

export const Avatar = memo(function Avatar({ name, slot, scheme, size = AVATAR }: { name: string | null; slot: number; scheme: ChatScheme; size?: number }) {
  const st = avatarStyles[scheme][slot];
  return (
    <View style={[st.circle, size !== AVATAR && { width: size, height: size, borderRadius: size / 2, marginRight: 0 }]} accessible={false}>
      <Text style={[st.text, size !== AVATAR && { fontSize: Math.round(size * 0.36) }]} allowFontScaling={false}>
        {initials(name)}
      </Text>
    </View>
  );
});

// Per-scheme, per-palette-slot styles, built once.
const nameStyles = Object.fromEntries(
  CHAT_SCHEMES.map((k) => [k, chatPalettes[k].senderPalette.map((c) => StyleSheet.create({ s: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginBottom: 1, color: c } }).s)])
) as Record<ChatScheme, object[]>;

function makeAvatar(p: ChatPalette) {
  return p.senderPalette.map((c) =>
    StyleSheet.create({
      circle: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, marginRight: AVATAR_GAP, backgroundColor: withAlpha(c, p.avatarAlpha), alignItems: 'center', justifyContent: 'center' },
      text: { fontSize: 11, fontWeight: '700', color: c },
    })
  );
}
export const avatarStyles = Object.fromEntries(CHAT_SCHEMES.map((k) => [k, makeAvatar(chatPalettes[k])])) as Record<ChatScheme, ReturnType<typeof makeAvatar>>;

const sheet = themedStyles((p) => ({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 12 + TAIL_W - 2 },
  rowIn: { justifyContent: 'flex-start' },
  rowOut: { justifyContent: 'flex-end' },
  gapRun: { marginTop: 8 },
  gapTight: { marginTop: 2 },
  selected: { position: 'absolute', left: 0, right: 0, top: -1, bottom: -1, backgroundColor: p.highlight },
  avatarSpacer: { width: AVATAR + AVATAR_GAP },
  column: { maxWidth: '75%' },
  colIn: { alignItems: 'flex-start' },
  colOut: { alignItems: 'flex-end' },
  bubble: { paddingTop: 6, paddingHorizontal: 8, paddingBottom: 8, borderRadius: 8, boxShadow: p.bubbleShadow, minWidth: 64 },
  in: { backgroundColor: p.incomingBg },
  out: { backgroundColor: p.outgoingBg },
  tailCornerIn: { borderTopLeftRadius: 0 },
  tailCornerOut: { borderTopRightRadius: 0 },
  tailIn: { position: 'absolute', top: 0, left: -TAIL_W, width: 0, height: 0, borderTopWidth: TAIL_H, borderTopColor: p.incomingBg, borderLeftWidth: TAIL_W, borderLeftColor: 'transparent' },
  tailOut: { position: 'absolute', top: 0, right: -TAIL_W, width: 0, height: 0, borderTopWidth: TAIL_H, borderTopColor: p.outgoingBg, borderRightWidth: TAIL_W, borderRightColor: 'transparent' },
  staffName: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginBottom: 1, color: p.meta },
  text: { fontSize: 15, lineHeight: 20, color: p.text },
  link: { color: p.link, textDecorationLine: 'underline' },
  spacer: { fontSize: 11, color: 'transparent' },
  meta: { position: 'absolute', right: 7, bottom: 4, flexDirection: 'row', alignItems: 'center' },
  time: { fontSize: 11, lineHeight: 15, color: p.meta },
  tick: { marginLeft: 3 },
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  mediaLabel: { fontSize: 14, lineHeight: 20, color: p.meta },
  emojiWrap: { alignItems: 'flex-end', paddingVertical: 2 },
  emoji: { fontSize: 40, lineHeight: 48 },
  metaPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: withAlpha(p.incomingBg, 0.9), boxShadow: p.bubbleShadow, marginTop: 2 },
  failedDot: { width: 20, height: 20, borderRadius: 10, marginRight: FAILED_W - 20, marginTop: 6, backgroundColor: p.failed, alignItems: 'center', justifyContent: 'center' },
  failedDotText: { color: '#FFFFFF', fontSize: 13, lineHeight: 15, fontWeight: '800' },
  failedNote: { marginTop: 3, marginRight: 2, fontSize: 12, lineHeight: 16, color: p.failed },
}));
