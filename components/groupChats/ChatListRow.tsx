// One row of the Site Groups list, WhatsApp chats-list proportions in our
// colours: 72 pt row, 50 pt initials avatar, bold 16 name, 14 grey preview
// ("You:" / sender, ticks on our own last message, "Draft:" in orange),
// 12 pt time (accent when unread), round accent unread badge, muted icon.

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { chatPalettes } from '../../lib/theme';
import { initials } from '../../lib/groupChats/textParse';
import { senderSlot, themedStyles, useChatPalette, useChatScheme, withAlpha } from '../../lib/groupChats/chatTheme';
import { isMuted, listTime, previewText, unreadLabel } from '../../lib/groupChats/format';
import type { GroupChat, MessageStatus } from '../../lib/groupChats/types';

export const ROW_HEIGHT = 72;
const AVATAR = 50;

function Row({ chat, draft, lastStatus, onPress }: { chat: GroupChat; draft: string | null; lastStatus: MessageStatus | null; onPress: (c: GroupChat) => void }) {
  const s = sheet(useChatScheme());
  const p = useChatPalette();
  const muted = isMuted(chat.muted_until);
  const unread = chat.unread_count > 0;
  const slot = senderSlot(chat.id);
  const colour = chatPalettes.light.senderPalette[slot];
  const preview = previewText(chat);
  const own = !!chat.last_message_from_me && !draft;
  const tick = own && lastStatus ? (lastStatus === 'sent' ? 'checkmark' : lastStatus === 'delivered' || lastStatus === 'read' ? 'checkmark-done' : lastStatus === 'sending' ? 'time-outline' : null) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${chat.name}${unread ? `, ${chat.unread_count} unread` : ''}${draft ? ', draft' : ''}`}
      onPress={() => onPress(chat)}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      <View style={[s.avatar, { backgroundColor: withAlpha(colour, 0.16) }]}>
        <Text style={[s.avatarText, { color: colour }]} allowFontScaling={false}>
          {initials(chat.name)}
        </Text>
      </View>
      <View style={s.body}>
        <View style={s.line}>
          <Text numberOfLines={1} style={s.name}>
            {chat.name}
          </Text>
          <Text style={[s.time, unread && s.timeUnread]}>{listTime(chat.last_message_at)}</Text>
        </View>
        <View style={s.line}>
          <View style={s.previewWrap}>
            {draft ? (
              <Text numberOfLines={1} style={s.preview}>
                <Text style={s.draft}>Draft: </Text>
                {draft.replace(/\s+/g, ' ').trim()}
              </Text>
            ) : (
              <>
                {tick ? <Ionicons name={tick} size={16} color={lastStatus === 'read' ? p.tickRead : p.muted} style={s.tick} /> : null}
                <Text numberOfLines={1} style={s.preview}>
                  {preview}
                </Text>
              </>
            )}
          </View>
          {muted ? <Ionicons name="notifications-off" size={16} color={p.muted} accessibilityLabel="Muted" /> : null}
          {unread ? (
            <View style={[s.badge, muted && s.badgeMuted]}>
              <Text style={s.badgeText}>{unreadLabel(chat.unread_count)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export const ChatListRow = memo(Row);

const sheet = themedStyles((p) => ({
  row: { flexDirection: 'row', alignItems: 'center', height: ROW_HEIGHT, paddingLeft: 16, paddingRight: 16, backgroundColor: p.surface },
  pressed: { backgroundColor: p.surfacePressed },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  avatarText: { fontSize: 18, fontWeight: '700' },
  body: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '700', color: p.title },
  time: { fontSize: 12, lineHeight: 16, color: p.muted },
  timeUnread: { color: p.tickRead, fontWeight: '600' },
  previewWrap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  tick: { marginRight: 3 },
  preview: { flexShrink: 1, fontSize: 14, lineHeight: 19, color: p.muted },
  draft: { color: p.draft, fontWeight: '600' },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: p.badgeBg, alignItems: 'center', justifyContent: 'center' },
  badgeMuted: { backgroundColor: p.sendBgDisabled },
  badgeText: { fontSize: 11.5, lineHeight: 14, fontWeight: '700', color: p.badgeText },
}));

export const listStyles = StyleSheet.create({
  sepWrap: { paddingLeft: 16 + AVATAR + 14 },
});
