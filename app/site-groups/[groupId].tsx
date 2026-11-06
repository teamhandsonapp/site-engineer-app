// One Site Group chat. Full-screen stack route (no tab bar) so the keyboard
// has room. Access: WHATSAPP_ENABLED + a whatsapp_access row; RLS decides
// whether this particular group is visible.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, View, type ListRenderItem } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useAuth } from '../../lib/AuthContext';
import { colors, space } from '../../lib/theme';
import { useSiteGroupsAccess, useSiteGroupsEnabled } from '../../lib/groupChats/access';
import { fetchGroupInfo } from '../../lib/groupChats/api';
import { buildItems, type ChatItem } from '../../lib/groupChats/buildItems';
import { useSiteGroupChats } from '../../lib/groupChats/chatsStore';
import { useChatMessages } from '../../lib/groupChats/useChatMessages';
import type { ChatMessage } from '../../lib/groupChats/types';
import { MessageBubble } from '../../components/groupChats/MessageBubble';
import { Composer, ReadOnlyNote } from '../../components/groupChats/Composer';
import { OfflineBanner } from '../../components/groupChats/OfflineBanner';
import { ChatBackground } from '../../components/groupChats/ChatBackground';
import { themedStyles, useChatScheme } from '../../lib/groupChats/chatTheme';
import { ProjectGate } from '../../components/ProjectGate';
import { ActionSheet, type MenuAction } from '../../components/ui/ActionMenu';
import { AppText } from '../../components/ui/AppText';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, SkeletonList } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADER = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: '#fff',
  headerTitleStyle: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 17 },
} as const;

export default function SiteGroupChatScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const enabled = useSiteGroupsEnabled();
  const { loading: accessLoading } = useSiteGroupsAccess();

  if (!enabled) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ ...HEADER, title: 'Site Groups' }} />
        {accessLoading ? (
          <SkeletonList rows={6} />
        ) : (
          <ErrorState title="Not available" message="Site Groups isn't available for your account." onRetry={() => router.back()} />
        )}
      </View>
    );
  }
  if (!groupId || !UUID.test(groupId)) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ ...HEADER, title: 'Site Groups' }} />
        <ErrorState title="Group not found" message="This link doesn't point to a site group." />
      </View>
    );
  }
  return (
    <ProjectGate routeName="site-groups">
      <Chat groupId={groupId} />
    </ProjectGate>
  );
}

function Chat({ groupId }: { groupId: string }) {
  const { state } = useAuth();
  const myName = state.status === 'signed-in' ? state.profile.fullName : null;
  const { canSend } = useSiteGroupsAccess();
  const { chats } = useSiteGroupChats();
  const fromList = chats?.find((c) => c.id === groupId)?.name ?? null;
  const [fetched, setFetched] = useState<{ name: string } | null | 'missing'>(null);
  const info = fromList ? { name: fromList } : fetched;
  const headerHeight = useHeaderHeight();
  const toast = useToast();

  // Direct navigation (no list loaded): ask the server; RLS hides groups the
  // user can't see, which shows "not available" instead of a crash.
  useEffect(() => {
    if (fromList) return;
    let live = true;
    fetchGroupInfo(groupId)
      .then((g) => live && setFetched(g && g.is_enabled ? { name: g.name } : 'missing'))
      .catch(() => live && setFetched((prev) => prev ?? 'missing'));
    return () => {
      live = false;
    };
  }, [fromList, groupId]);

  const { messages, loading, error, loadingOlder, loadOlder, send, retry, remove, reload } = useChatMessages(groupId, myName);
  const items = useMemo(() => buildItems(messages), [messages]);
  const [menu, setMenu] = useState<{ kind: 'copy' | 'failed'; m: ChatMessage } | null>(null);

  const onLongPress = useCallback((m: ChatMessage) => {
    if (m.body) setMenu({ kind: 'copy', m });
  }, []);
  const onFailedPress = useCallback((m: ChatMessage) => setMenu({ kind: 'failed', m }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const onSend = useCallback(
    async (body: string) => {
      const outcome = await send(body);
      if (outcome === 'rate_limited') toast.error('Sending too fast, try again in a moment');
    },
    [send, toast]
  );

  const actions: MenuAction[] = useMemo(() => {
    if (!menu) return [];
    if (menu.kind === 'copy') {
      return [
        {
          label: 'Copy text',
          icon: 'copy-outline',
          onPress: () => {
            void Clipboard.setStringAsync(menu.m.body ?? '').then(() => toast.success('Copied'));
          },
        },
      ];
    }
    return [
      {
        label: 'Retry',
        icon: 'refresh',
        onPress: () => {
          void retry(menu.m).then((o) => o === 'rate_limited' && toast.error('Sending too fast, try again in a moment'));
        },
      },
      { label: 'Delete', icon: 'trash-outline', destructive: true, confirm: 'Delete this unsent message?', onPress: () => void remove(menu.m) },
    ];
  }, [menu, remove, retry, toast]);

  const renderItem: ListRenderItem<ChatItem> = useCallback(
    ({ item }) =>
      item.kind === 'day' ? (
        <DaySeparator label={item.label} />
      ) : (
        <MessageBubble message={item.message} showSender={item.showSender} tight={item.tight} onLongPress={onLongPress} onFailedPress={onFailedPress} />
      ),
    [onLongPress, onFailedPress]
  );

  const title = info && info !== 'missing' ? info.name : 'Site Group';
  const t = chatStyles(useChatScheme());

  if (info === 'missing') {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ ...HEADER, title: 'Site Groups' }} />
        <ErrorState title="Not available" message="This group doesn't exist or you don't have access to it." onRetry={() => router.back()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <Stack.Screen options={{ ...HEADER, title }} />
      <OfflineBanner />
      <View style={t.area}>
        <ChatBackground />
        {loading && messages.length === 0 ? (
          <View style={styles.fill}>
            <SkeletonList rows={6} />
          </View>
        ) : error && messages.length === 0 ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : messages.length === 0 ? (
          <EmptyState icon="chatbubbles-outline" title="No messages yet" subtitle="Messages in this WhatsApp group will appear here." />
        ) : (
        <FlatList
          data={items}
          inverted
          keyExtractor={keyOf}
          renderItem={renderItem}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={11}
          removeClippedSubviews={Platform.OS === 'android'}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingOlder ? <ActivityIndicator style={styles.older} color={colors.navy} /> : null}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
        )}
      </View>
      {canSend ? <Composer onSend={onSend} /> : <ReadOnlyNote />}
      <ActionSheet visible={!!menu} onClose={closeMenu} actions={actions} title={menu?.kind === 'failed' ? menu.m.error ?? 'Not sent' : undefined} />
    </KeyboardAvoidingView>
  );
}

const keyOf = (item: ChatItem) => item.key;

const chatStyles = themedStyles((p) => ({
  area: { flex: 1, backgroundColor: p.bg },
}));

function DaySeparator({ label }: { label: string }) {
  return (
    <View style={styles.dayWrap}>
      <AppText variant="caption" style={styles.day}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingVertical: space.sm },
  older: { marginVertical: space.md },
  dayWrap: { alignItems: 'center', marginVertical: space.md },
  day: { paddingHorizontal: space.md, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
});

export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
