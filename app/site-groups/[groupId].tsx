// One Site Group chat. Full-screen stack route (no tab bar) so the keyboard
// has room. Access: WHATSAPP_ENABLED + a whatsapp_access row; RLS decides
// whether this particular group is visible. This file owns the data
// (useChatMessages); components/groupChats/ChatView.tsx draws it.

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { colors } from '../../lib/theme';
import { useSiteGroupsAccess, useSiteGroupsEnabled } from '../../lib/groupChats/access';
import { fetchGroupInfo } from '../../lib/groupChats/api';
import { useSiteGroupChats } from '../../lib/groupChats/chatsStore';
import { useChatMessages } from '../../lib/groupChats/useChatMessages';
import { ChatView, CHAT_HEADER as HEADER } from '../../components/groupChats/ChatView';
import { ProjectGate } from '../../components/ProjectGate';
import { ErrorState, SkeletonList } from '../../components/ui/States';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const { projects, selectedProjectId } = useProject();
  const listed = chats?.find((c) => c.id === groupId) ?? null;
  const fromList = listed?.name ?? null;
  const projectName = projects.find((pr) => pr.id === (listed?.project_id ?? selectedProjectId))?.name ?? null;
  const [fetched, setFetched] = useState<{ name: string } | null | 'missing'>(null);
  const info = fromList ? { name: fromList } : fetched;

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

  if (info === 'missing') {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ ...HEADER, title: 'Site Groups' }} />
        <ErrorState title="Not available" message="This group doesn't exist or you don't have access to it." onRetry={() => router.back()} />
      </View>
    );
  }

  return (
    <ChatView
      groupId={groupId}
      title={info?.name ?? 'Site Group'}
      projectName={projectName}
      initialUnread={listed?.unread_count ?? 0}
      myName={myName}
      canSend={canSend}
      messages={messages}
      loading={loading}
      error={error}
      loadingOlder={loadingOlder}
      loadOlder={loadOlder}
      reload={reload}
      send={send}
      retry={retry}
      remove={remove}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
});

export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
