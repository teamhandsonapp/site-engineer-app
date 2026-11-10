// The chat screen's view: header, wallpaper, message list, composer and
// menus. Pure UI — every piece of data and every action (send / retry /
// delete / paging / reload) comes in as props from the route, which owns
// useChatMessages. The dev-only preview route (app/site-groups/preview.tsx)
// renders this same view with sample messages.
//
// WhatsApp layout in our colours (docs/site-groups-chat-design.md):
// navy header with group avatar, name and "project · tap for group info";
// search and ⋮ on the right; white date chips (plus a floating one while
// scrolling); "N UNREAD MESSAGES" bar; round scroll-to-bottom button with
// an unread badge; composer floating on the wallpaper.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, Stack } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { chatPalettes, colors } from '../../lib/theme';
import { buildItems, type ChatItem } from '../../lib/groupChats/buildItems';
import { dayChipLabel } from '../../lib/groupChats/format';
import { initials } from '../../lib/groupChats/textParse';
import { senderSlot, themedStyles, useChatPalette, useChatScheme } from '../../lib/groupChats/chatTheme';
import type { Segment } from '../../lib/groupChats/textParse';
import type { ChatMessage } from '../../lib/groupChats/types';
import type { SendOutcome } from '../../lib/groupChats/useChatMessages';
import { ActionSheet, type MenuAction } from '../ui/ActionMenu';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState, SkeletonList } from '../ui/States';
import { useToast } from '../ui/Toast';
import { ChatBackground } from './ChatBackground';
import { Composer, ReadOnlyNote } from './Composer';
import { MessageBubble } from './MessageBubble';
import { OfflineBanner } from './OfflineBanner';
import { SelectTextSheet } from './SelectTextSheet';

export const CHAT_HEADER = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: '#fff',
  headerTitleStyle: { fontSize: 17, fontWeight: '700' as const },
  headerShadowVisible: false,
} as const;

export interface ChatViewProps {
  groupId: string;
  title: string;
  projectName: string | null;
  myName: string | null;
  canSend: boolean;
  initialUnread?: number;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  loadingOlder: boolean;
  loadOlder: () => void;
  reload: () => void;
  send: (body: string) => Promise<SendOutcome>;
  retry: (m: ChatMessage) => Promise<SendOutcome>;
  remove: (m: ChatMessage) => Promise<unknown>;
}

const SHOW_FAB_AFTER = 240;

export function ChatView({ groupId, title, projectName, myName, canSend, initialUnread = 0, messages, loading, error, loadingOlder, loadOlder, reload, send, retry, remove }: ChatViewProps) {
  const headerHeight = useHeaderHeight();
  const toast = useToast();
  const scheme = useChatScheme();
  const t = chatStyles(scheme);
  const p = useChatPalette();
  const listRef = useRef<FlatList<ChatItem>>(null);

  // Search (UI only: filters the messages already loaded on this phone).
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (searching && q ? messages.filter((m) => (m.body ?? '').toLowerCase().includes(q) || (m.sender_name ?? '').toLowerCase().includes(q)) : messages), [messages, searching, q]);

  // The unread bar marks where the user left off; it stays for this visit.
  const [unreadAtOpen] = useState(initialUnread);
  const items = useMemo(() => buildItems(shown, myName, new Date(), searching ? 0 : unreadAtOpen), [shown, myName, searching, unreadAtOpen]);

  const [menu, setMenu] = useState<{ kind: 'copy' | 'failed'; m: ChatMessage } | { kind: 'link'; url: string } | { kind: 'chat' } | null>(null);
  const [selectText, setSelectText] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const onLongPress = useCallback((m: ChatMessage) => {
    if (m.body) setMenu({ kind: 'copy', m });
  }, []);
  const onFailedPress = useCallback((m: ChatMessage) => setMenu({ kind: 'failed', m }), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Web links ask first (they leave the app); phone and email open directly.
  const onLinkPress = useCallback((seg: Segment) => {
    if (seg.kind === 'text') return;
    if (seg.kind === 'url') setMenu({ kind: 'link', url: seg.href });
    else void Linking.openURL(seg.href).catch(() => {});
  }, []);
  const selectedId = menu && (menu.kind === 'copy' || menu.kind === 'failed') ? menu.m.id : null;

  const onSend = useCallback(
    async (body: string) => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      const outcome = await send(body);
      if (outcome === 'rate_limited') toast.error('Sending too fast, try again in a moment');
    },
    [send, toast]
  );

  const actions: MenuAction[] = useMemo(() => {
    if (!menu) return [];
    if (menu.kind === 'chat') {
      return [
        { label: 'Group info', icon: 'information-circle-outline', onPress: () => setInfoOpen(true) },
        { label: 'Search', icon: 'search-outline', onPress: () => setSearching(true) },
        { label: 'Refresh', icon: 'refresh', onPress: () => void reload() },
      ];
    }
    if (menu.kind === 'link') {
      return [
        { label: 'Open link', icon: 'open-outline', onPress: () => void Linking.openURL(menu.url).catch(() => toast.error("Couldn't open this link")) },
        { label: 'Copy link', icon: 'copy-outline', onPress: () => void Clipboard.setStringAsync(menu.url).then(() => toast.success('Copied')) },
      ];
    }
    if (menu.kind === 'copy') {
      const body = menu.m.body ?? '';
      return [
        { label: 'Copy text', icon: 'copy-outline', onPress: () => void Clipboard.setStringAsync(body).then(() => toast.success('Copied')) },
        { label: 'Select text', icon: 'text-outline', onPress: () => setSelectText(body) },
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
  }, [menu, reload, remove, retry, toast]);

  // Scroll-to-bottom button + count of messages that arrived while away.
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newWhileAway, setNewWhileAway] = useState(0);
  const newestId = messages[0]?.id;
  const lastNewest = useRef(newestId);
  useEffect(() => {
    if (newestId && newestId !== lastNewest.current && awayFromBottom && messages[0] && !messages[0].from_me) setNewWhileAway((n) => n + 1);
    lastNewest.current = newestId;
  }, [newestId, awayFromBottom, messages]);

  // Floating date chip while scrolling (the day of the top-most visible row).
  const [floatingDay, setFloatingDay] = useState<string | null>(null);
  const [chipOpacity] = useState(() => new Animated.Value(0));
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable for the FlatList (it must never change identity).
  const [onViewableItemsChanged] = useState(() => ({ viewableItems }: { viewableItems: ViewToken<ChatItem>[] }) => {
    // Inverted list: the highest index on screen is the top-most row.
    let top: ViewToken<ChatItem> | null = null;
    for (const v of viewableItems) if (v.index != null && (!top || (top.index ?? -1) < v.index)) top = v;
    const it = top?.item;
    if (!it) return;
    const label = it.kind === 'msg' ? dayLabelFor(it.message.wa_timestamp) : it.kind === 'day' ? it.label : null;
    if (label) setFloatingDay(label);
  });

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const away = y > SHOW_FAB_AFTER;
      setAwayFromBottom((prev) => (prev === away ? prev : away));
      if (!away) setNewWhileAway(0);
      chipOpacity.stopAnimation();
      chipOpacity.setValue(1);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => Animated.timing(chipOpacity, { toValue: 0, duration: 250, useNativeDriver: Platform.OS !== 'web' }).start(), 1200);
    },
    [chipOpacity]
  );
  useEffect(() => () => void (hideTimer.current && clearTimeout(hideTimer.current)), []);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setNewWhileAway(0);
  }, []);

  const renderItem: ListRenderItem<ChatItem> = useCallback(
    ({ item }) =>
      item.kind === 'day' ? (
        <DateChip label={item.label} />
      ) : item.kind === 'unread' ? (
        <UnreadBar count={item.count} />
      ) : (
        <MessageBubble
          message={item.message}
          runStart={item.runStart}
          runEnd={item.runEnd}
          showName={item.showName}
          selected={item.message.id === selectedId}
          onLongPress={onLongPress}
          onFailedPress={onFailedPress}
          onLinkPress={onLinkPress}
        />
      ),
    [onLongPress, onFailedPress, onLinkPress, selectedId]
  );

  const slot = senderSlot(groupId);
  const subtitle = `${projectName ? `${projectName} · ` : ''}tap for group info`;

  const header = searching ? (
    <Stack.Screen
      options={{
        ...CHAT_HEADER,
        headerTitle: () => (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search…"
            placeholderTextColor="rgba(255,255,255,0.6)"
            autoFocus
            style={t.searchInput}
            returnKeyType="search"
            accessibilityLabel="Search messages"
          />
        ),
        headerRight: () => (
          <Pressable
            onPress={() => {
              setSearching(false);
              setQuery('');
            }}
            hitSlop={10}
            accessibilityLabel="Close search"
            style={t.headerIcon}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        ),
      }}
    />
  ) : (
    <Stack.Screen
      options={{
        ...CHAT_HEADER,
        title,
        headerTitleAlign: 'left',
        headerTitle: () => (
          <Pressable onPress={() => setInfoOpen(true)} style={t.headerTitle} accessibilityRole="button" accessibilityLabel={`${title}, group info`}>
            <GroupAvatar name={title} slot={slot} size={36} />
            <View style={t.headerText}>
              <Text style={t.headerName} numberOfLines={1}>
                {title}
              </Text>
              <Text style={t.headerSub} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
          </Pressable>
        ),
        headerRight: () => (
          <View style={t.headerIcons}>
            <Pressable onPress={() => setSearching(true)} hitSlop={8} accessibilityLabel="Search" style={t.headerIcon}>
              <Ionicons name="search" size={21} color="#fff" />
            </Pressable>
            <Pressable onPress={() => setMenu({ kind: 'chat' })} hitSlop={8} accessibilityLabel="More options" style={t.headerIcon}>
              <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
            </Pressable>
          </View>
        ),
      }}
    />
  );

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
      {header}
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
          <EmptyState icon="chatbubbles-outline" title="No messages yet" subtitle="Messages in this site group will appear here." />
        ) : searching && q && shown.length === 0 ? (
          <EmptyState icon="search-outline" title="No messages found" subtitle={`Nothing matches "${query.trim()}" in the loaded messages.`} />
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            inverted
            keyExtractor={keyOf}
            renderItem={renderItem}
            extraData={selectedId}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={11}
            removeClippedSubviews={Platform.OS === 'android'}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.3}
            onScroll={onScroll}
            scrollEventThrottle={64}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={VIEWABILITY}
            ListFooterComponent={loadingOlder ? <ActivityIndicator style={styles.older} color={colors.navy} /> : null}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          />
        )}
        {floatingDay ? (
          <Animated.View style={[t.floatingChip, { opacity: chipOpacity }]} pointerEvents="none">
            <DateChip label={floatingDay} floating />
          </Animated.View>
        ) : null}
        {awayFromBottom ? (
          <Pressable onPress={scrollToBottom} style={t.fab} accessibilityRole="button" accessibilityLabel={newWhileAway ? `Scroll to newest, ${newWhileAway} new` : 'Scroll to newest'}>
            <Ionicons name="chevron-down" size={22} color={p.fabIcon} />
            {newWhileAway ? (
              <View style={t.fabBadge}>
                <Text style={t.fabBadgeText}>{newWhileAway > 99 ? '99+' : newWhileAway}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
        {canSend ? <Composer groupId={groupId} onSend={onSend} /> : <ReadOnlyNote />}
      </View>
      <ActionSheet
        visible={!!menu}
        onClose={closeMenu}
        actions={actions}
        title={menu?.kind === 'failed' ? menu.m.error ?? 'Not sent' : menu?.kind === 'link' ? `Open ${menu.url}?` : undefined}
      />
      <SelectTextSheet text={selectText} onClose={() => setSelectText(null)} />
      <GroupInfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} title={title} projectName={projectName} canSend={canSend} loadedCount={messages.length} slot={slot} />
    </KeyboardAvoidingView>
  );
}

const VIEWABILITY = { itemVisiblePercentThreshold: 10 };
const keyOf = (item: ChatItem) => item.key;

// The same label the day rows use, for the floating chip.
const dayLabelFor = (iso: string) => dayChipLabel(iso);

// Solid colour + white initials: reads on the navy header and in Group info.
export function GroupAvatar({ name, slot, size }: { name: string; slot: number; size: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: chatPalettes.light.senderPalette[slot], alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <Text style={{ color: '#FFFFFF', fontSize: Math.round(size * 0.38), fontWeight: '700' }} allowFontScaling={false}>
        {initials(name)}
      </Text>
    </View>
  );
}

function DateChip({ label, floating }: { label: string; floating?: boolean }) {
  const t = chatStyles(useChatScheme());
  return (
    <View style={floating ? undefined : t.dayWrap} accessibilityRole="header">
      <Text style={t.dayChip}>{label}</Text>
    </View>
  );
}

function UnreadBar({ count }: { count: number }) {
  const t = chatStyles(useChatScheme());
  return (
    <View style={t.unreadBar}>
      <Text style={t.unreadText}>
        {count} UNREAD MESSAGE{count === 1 ? '' : 'S'}
      </Text>
    </View>
  );
}

// Group info: what the app knows about this group (no extra requests).
function GroupInfoSheet({ visible, onClose, title, projectName, canSend, loadedCount, slot }: { visible: boolean; onClose: () => void; title: string; projectName: string | null; canSend: boolean; loadedCount: number; slot: number }) {
  const insets = useSafeAreaInsets();
  const t = chatStyles(useChatScheme());
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={t.scrim} onPress={onClose} />
      <View style={[t.infoSheet, { paddingBottom: 20 + insets.bottom }]}>
        <View style={t.grabber} />
        <View style={t.infoTop}>
          <GroupAvatar name={title} slot={slot} size={72} />
          <Text style={t.infoName}>{title}</Text>
          <Text style={t.infoSub}>Site group{projectName ? ` · ${projectName}` : ''}</Text>
        </View>
        <InfoRow icon={canSend ? 'chatbubble-ellipses-outline' : 'eye-outline'} label={canSend ? 'You can send messages from the app' : 'You can read this group; replies are sent by the account owner'} />
        <InfoRow icon="time-outline" label={`${loadedCount} message${loadedCount === 1 ? '' : 's'} loaded on this phone`} />
        <InfoRow icon="lock-closed-outline" label="Only people with Site Groups access can see this chat" />
        <Pressable
          onPress={() => {
            onClose();
            router.back();
          }}
          style={t.infoButton}
        >
          <Text style={t.infoButtonText}>Back to Site Groups</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function InfoRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const t = chatStyles(useChatScheme());
  const p = useChatPalette();
  return (
    <View style={t.infoRow}>
      <Ionicons name={icon} size={20} color={p.muted} />
      <Text style={t.infoRowText}>{label}</Text>
    </View>
  );
}

const chatStyles = themedStyles((p) => ({
  area: { flex: 1, backgroundColor: p.bg },
  headerTitle: { flexDirection: 'row', alignItems: 'center', marginLeft: Platform.OS === 'ios' ? 0 : -16, maxWidth: 250 },
  headerText: { marginLeft: 10, flexShrink: 1 },
  headerName: { color: '#FFFFFF', fontSize: 16, lineHeight: 20, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.72)', fontSize: 12.5, lineHeight: 16 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  headerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  searchInput: { color: '#FFFFFF', fontSize: 17, minWidth: 220, paddingVertical: 6 },
  dayWrap: { alignItems: 'center', marginTop: 10, marginBottom: 4 },
  dayChip: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: p.dateChipText, backgroundColor: p.dateChipBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, overflow: 'hidden', boxShadow: p.bubbleShadow, letterSpacing: 0.3 },
  floatingChip: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' },
  unreadBar: { alignSelf: 'stretch', alignItems: 'center', marginTop: 10, marginBottom: 2, paddingVertical: 5, backgroundColor: p.unreadBg },
  unreadText: { fontSize: 12.5, lineHeight: 17, fontWeight: '600', color: p.unreadText, letterSpacing: 0.3 },
  fab: { position: 'absolute', right: 12, bottom: 76, width: 40, height: 40, borderRadius: 20, backgroundColor: p.fabBg, alignItems: 'center', justifyContent: 'center', boxShadow: '0px 1px 3px rgba(11, 20, 26, 0.25)' },
  fabBadge: { position: 'absolute', top: -8, right: -4, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: p.badgeBg, alignItems: 'center', justifyContent: 'center' },
  fabBadgeText: { fontSize: 11, fontWeight: '700', color: p.badgeText },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  infoSheet: { backgroundColor: p.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 20 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: p.separator, marginTop: 8 },
  infoTop: { alignItems: 'center', paddingVertical: 16 },
  infoName: { fontSize: 20, lineHeight: 26, fontWeight: '700', color: p.title, marginTop: 10, textAlign: 'center' },
  infoSub: { fontSize: 14, lineHeight: 19, color: p.muted, marginTop: 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.separator },
  infoRowText: { flex: 1, fontSize: 15, lineHeight: 20, color: p.title },
  infoButton: { marginTop: 8, height: 46, borderRadius: 23, borderWidth: 1, borderColor: p.separator, alignItems: 'center', justifyContent: 'center' },
  infoButtonText: { fontSize: 15, fontWeight: '600', color: p.title },
}));

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingTop: 6, paddingBottom: 10 },
  older: { marginVertical: 12 },
});
