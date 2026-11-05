import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, space } from '../../lib/theme';
import { isMuted, listTime, previewText, unreadLabel } from '../../lib/groupChats/format';
import type { GroupChat } from '../../lib/groupChats/types';
import { AppText } from '../ui/AppText';

function Row({ chat, onPress }: { chat: GroupChat; onPress: (c: GroupChat) => void }) {
  const muted = isMuted(chat.muted_until);
  const unread = chat.unread_count > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${chat.name}${unread ? `, ${chat.unread_count} unread` : ''}`}
      onPress={() => onPress(chat)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatar}>
        <Ionicons name="people" size={20} color={colors.navy} />
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
            {chat.name}
          </AppText>
          <AppText variant="caption" style={unread ? styles.timeUnread : undefined}>
            {listTime(chat.last_message_at)}
          </AppText>
        </View>
        <View style={styles.line}>
          <AppText variant="body" tone="muted" numberOfLines={1} style={styles.preview}>
            {previewText(chat)}
          </AppText>
          {muted ? <Ionicons name="notifications-off-outline" size={15} color={colors.textMuted} accessibilityLabel="Muted" /> : null}
          {unread ? (
            <View style={[styles.badge, muted && styles.badgeMuted]}>
              <AppText variant="caption" style={styles.badgeText}>
                {unreadLabel(chat.unread_count)}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export const ChatListRow = memo(Row);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: colors.surface },
  pressed: { backgroundColor: colors.surfaceMuted },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navySoft, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flex: 1 },
  preview: { flex: 1 },
  timeUnread: { color: colors.warning, fontFamily: 'IBMPlexSans_600SemiBold' },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' },
  badgeMuted: { backgroundColor: colors.borderStrong },
  badgeText: { color: colors.amberDeep, fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 12 },
});
