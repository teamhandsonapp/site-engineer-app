// Site Groups — the selected project's WhatsApp groups. Only for people in
// whatsapp_access (and only while WHATSAPP_ENABLED). The list itself lives
// in lib/groupChats/chatsStore (shared with the tab badge). Layout follows a
// chats list: white background, search bar on top, 72 pt rows, thin
// separators that start at the text, drafts shown in orange.

import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, type ListRenderItem } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../lib/theme';
import { useSiteGroupsAccess, useSiteGroupsEnabled } from '../../lib/groupChats/access';
import { useSiteGroupChats } from '../../lib/groupChats/chatsStore';
import { getMemoryMessages } from '../../lib/groupChats/cache';
import { themedStyles, useChatPalette, useChatScheme } from '../../lib/groupChats/chatTheme';
import { useDrafts } from '../../lib/groupChats/drafts';
import type { GroupChat, MessageStatus } from '../../lib/groupChats/types';
import { ChatListRow, listStyles, ROW_HEIGHT } from '../../components/groupChats/ChatListRow';
import { OfflineBanner } from '../../components/groupChats/OfflineBanner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, SkeletonList } from '../../components/ui/States';

// Ticks on our own last message come from the messages already cached on
// this phone (no extra request); unknown → no tick.
function lastOwnStatus(c: GroupChat): MessageStatus | null {
  if (!c.last_message_from_me) return null;
  const newest = getMemoryMessages(c.id)?.[0];
  return newest && newest.from_me ? newest.status : null;
}

export default function SiteGroupsScreen() {
  const enabled = useSiteGroupsEnabled();
  const { loading: accessLoading, canManage } = useSiteGroupsAccess();
  const { chats, loading, error, refresh } = useSiteGroupChats();
  const drafts = useDrafts();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const s = sheet(useChatScheme());
  const p = useChatPalette();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => (chats ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || (c.last_message_text ?? '').toLowerCase().includes(q)), [chats, q]);

  const open = useCallback((c: GroupChat) => router.push({ pathname: '/site-groups/[groupId]', params: { groupId: c.id } } as never), []);
  const renderItem: ListRenderItem<GroupChat> = useCallback(
    ({ item }) => <ChatListRow chat={item} draft={drafts[item.id] ?? null} lastStatus={lastOwnStatus(item)} onPress={open} />,
    [open, drafts]
  );

  if (!enabled) {
    return accessLoading ? (
      <SkeletonList rows={5} />
    ) : (
      <EmptyState icon="lock-closed-outline" title="Not available" subtitle="Site Groups isn't available for your account." />
    );
  }

  return (
    <View style={s.fill}>
      <OfflineBanner />
      {canManage ? (
        <Pressable onPress={() => router.push('/site-groups/setup' as never)} accessibilityRole="button" style={[styles.setupRow, { backgroundColor: p.surface }]}>
          <Ionicons name="settings-outline" size={18} color={colors.navy} />
          <Text style={[styles.setupText, { color: p.title }]}>Site Groups Setup</Text>
          <Text style={[styles.setupHint, { color: p.muted }]}>Link groups, manage people</Text>
          <Ionicons name="chevron-forward" size={16} color={p.muted} />
        </Pressable>
      ) : null}
      <View style={s.searchWrap}>
        <View style={s.search}>
          <Ionicons name="search" size={18} color={p.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={p.placeholder} style={s.searchInput} accessibilityLabel="Search groups" returnKeyType="search" />
          {query ? <Ionicons name="close-circle" size={18} color={p.muted} onPress={() => setQuery('')} accessibilityLabel="Clear search" /> : null}
        </View>
      </View>
      {chats === null && loading ? (
        <SkeletonList rows={5} />
      ) : chats === null && error ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={keyOf}
          renderItem={renderItem}
          extraData={drafts}
          getItemLayout={getItemLayout}
          ItemSeparatorComponent={Separator}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.navy} />}
          contentContainerStyle={visible.length === 0 ? styles.emptyContainer : undefined}
          ListEmptyComponent={q ? <EmptyState icon="search-outline" title="No groups found" /> : <EmptyState icon="chatbubbles-outline" title="No site groups for this project yet." />}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const keyOf = (c: GroupChat) => c.id;
const getItemLayout = (_: unknown, index: number) => ({ length: ROW_HEIGHT + StyleSheet.hairlineWidth, offset: (ROW_HEIGHT + StyleSheet.hairlineWidth) * index, index });
function Separator() {
  const s = sheet(useChatScheme());
  return (
    <View style={[listStyles.sepWrap, s.sepBg]}>
      <View style={s.sep} />
    </View>
  );
}

const sheet = themedStyles((p) => ({
  fill: { flex: 1, backgroundColor: p.surface },
  searchWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, backgroundColor: p.surface },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, borderRadius: 20, paddingHorizontal: 14, backgroundColor: p.searchBg },
  searchInput: { flex: 1, fontSize: 15, color: p.title, paddingVertical: 0 },
  sepBg: { backgroundColor: p.surface },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: p.separator },
}));

const styles = StyleSheet.create({
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  setupRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  setupText: { fontSize: 15, fontWeight: '600' },
  setupHint: { flex: 1, fontSize: 12, textAlign: 'right' },
});

export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
