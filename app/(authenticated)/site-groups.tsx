// Site Groups — the selected project's WhatsApp groups. Only for people in
// whatsapp_access (and only while WHATSAPP_ENABLED). The list itself lives
// in lib/groupChats/chatsStore (shared with the tab badge).

import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View, type ListRenderItem } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../../lib/theme';
import { useSiteGroupsAccess, useSiteGroupsEnabled } from '../../lib/groupChats/access';
import { useSiteGroupChats } from '../../lib/groupChats/chatsStore';
import type { GroupChat } from '../../lib/groupChats/types';
import { ChatListRow } from '../../components/groupChats/ChatListRow';
import { OfflineBanner } from '../../components/groupChats/OfflineBanner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, SkeletonList } from '../../components/ui/States';

export default function SiteGroupsScreen() {
  const enabled = useSiteGroupsEnabled();
  const { loading: accessLoading } = useSiteGroupsAccess();
  const { chats, loading, error, refresh } = useSiteGroupChats();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const open = useCallback((c: GroupChat) => router.push({ pathname: '/site-groups/[groupId]', params: { groupId: c.id } } as never), []);
  const renderItem: ListRenderItem<GroupChat> = useCallback(({ item }) => <ChatListRow chat={item} onPress={open} />, [open]);

  if (!enabled) {
    return accessLoading ? (
      <SkeletonList rows={5} />
    ) : (
      <EmptyState icon="lock-closed-outline" title="Not available" subtitle="Site Groups isn't available for your account." />
    );
  }

  return (
    <View style={styles.fill}>
      <OfflineBanner />
      {chats === null && loading ? (
        <SkeletonList rows={5} />
      ) : chats === null && error ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : (
        <FlatList
          data={chats ?? []}
          keyExtractor={keyOf}
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.navy} />}
          contentContainerStyle={(chats ?? []).length === 0 ? styles.emptyContainer : undefined}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No site groups for this project yet." />}
        />
      )}
    </View>
  );
}

const keyOf = (c: GroupChat) => c.id;
const Separator = () => <View style={styles.sep} />;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: 72 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
});

export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
