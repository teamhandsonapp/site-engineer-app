// One chat bubble. React.memo with a narrow comparison (id, status, body and
// the layout flags) so a new incoming message re-renders only that bubble
// and, at most, its neighbour whose grouping changed. All styles are static
// (StyleSheet); handlers come in as stable callbacks.

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { chat, colors, radius, space, type } from '../../lib/theme';
import { messageText, senderColorIndex, timeHHmm } from '../../lib/groupChats/format';
import type { ChatMessage, MessageStatus } from '../../lib/groupChats/types';
import { AppText } from '../ui/AppText';

// Dev-only profiling aid: counts bubble renders so a test can check that
// one incoming message doesn't re-render every bubble. Exposed on
// globalThis in development only; release builds never touch it.
export const bubbleRenderCount = { current: 0 };
if (__DEV__) (globalThis as { __siteGroupsBubbleRenders?: { current: number } }).__siteGroupsBubbleRenders = bubbleRenderCount;

const TICK: Partial<Record<MessageStatus, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }>> = {
  sending: { icon: 'time-outline', color: colors.textMuted, label: 'Sending' },
  sent: { icon: 'checkmark', color: colors.textMuted, label: 'Sent' },
  delivered: { icon: 'checkmark-done', color: colors.textMuted, label: 'Delivered' },
  read: { icon: 'checkmark-done', color: chat.readTick, label: 'Read' },
  failed: { icon: 'alert-circle', color: colors.danger, label: 'Not sent — tap for options' },
};

interface Props {
  message: ChatMessage;
  showSender: boolean;
  tight: boolean; // next (newer) bubble is from the same sender → less space
  onLongPress: (m: ChatMessage) => void;
  onFailedPress: (m: ChatMessage) => void;
}

function Bubble({ message: m, showSender, tight, onLongPress, onFailedPress }: Props) {
  if (__DEV__) bubbleRenderCount.current++;
  const { placeholder, text } = messageText(m);
  const tick = m.from_me ? TICK[m.status] : undefined;
  const failed = m.status === 'failed';
  const longPress = useCallback(() => onLongPress(m), [onLongPress, m]);
  const press = useCallback(() => onFailedPress(m), [onFailedPress, m]);

  return (
    <View style={[styles.row, m.from_me ? styles.rowOut : styles.rowIn, tight ? styles.tight : styles.loose]}>
      <Pressable
        onLongPress={longPress}
        onPress={failed ? press : undefined}
        delayLongPress={350}
        accessibilityRole={failed ? 'button' : undefined}
        accessibilityHint={failed ? 'Retry or delete this message' : 'Long press for options'}
        style={[styles.bubble, m.from_me ? styles.out : styles.in, failed && styles.failed]}
      >
        {showSender && !m.from_me ? (
          <AppText variant="label" numberOfLines={1} style={senderStyles[senderColorIndex(m.sender_wa_id ?? m.sender_name)]}>
            {m.sender_name ?? m.sender_wa_id ?? 'Unknown'}
          </AppText>
        ) : null}
        {placeholder ? (
          <AppText variant="bodyStrong" style={styles.placeholder}>
            {placeholder}
          </AppText>
        ) : null}
        {text ? (
          <AppText variant="body" selectable={false} style={styles.text}>
            {text}
          </AppText>
        ) : null}
        <View style={styles.meta}>
          <AppText variant="caption" style={styles.time}>
            {timeHHmm(m.wa_timestamp)}
          </AppText>
          {tick ? <Ionicons name={tick.icon} size={14} color={tick.color} accessibilityLabel={tick.label} /> : null}
        </View>
      </Pressable>
      {failed ? (
        <AppText variant="caption" tone="danger" style={styles.failedNote}>
          Not sent · tap to retry
        </AppText>
      ) : null}
    </View>
  );
}

export const MessageBubble = memo(
  Bubble,
  (a, b) =>
    a.message.id === b.message.id &&
    a.message.status === b.message.status &&
    a.message.body === b.message.body &&
    a.showSender === b.showSender &&
    a.tight === b.tight &&
    a.onLongPress === b.onLongPress &&
    a.onFailedPress === b.onFailedPress
);

// One precomputed style per palette colour (no per-render style objects).
const senderStyles = chat.senderPalette.map((color) => StyleSheet.create({ s: { marginBottom: 2, color } }).s);

const styles = StyleSheet.create({
  row: { paddingHorizontal: space.md, maxWidth: '100%' },
  rowIn: { alignItems: 'flex-start' },
  rowOut: { alignItems: 'flex-end' },
  tight: { marginTop: 2 },
  loose: { marginTop: space.sm },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: 6,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  in: { backgroundColor: chat.incomingBg, borderColor: colors.border, borderTopLeftRadius: 4 },
  out: { backgroundColor: chat.outgoingBg, borderColor: chat.outgoingBorder, borderTopRightRadius: 4 },
  failed: { borderColor: colors.danger },
  placeholder: { color: colors.textSecondary },
  text: { color: colors.text },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 },
  time: { fontSize: type.caption.fontSize - 1, lineHeight: 14 },
  failedNote: { marginTop: 2, marginRight: 2 },
});
