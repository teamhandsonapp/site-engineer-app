// DEV ONLY: the real chat view fed with sample messages (lib/groupChats/
// devFixtures.ts) — no network, nothing written anywhere. Sending appends a
// local bubble that goes sending → sent. Release builds redirect away.

import { useCallback, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ChatSchemeProvider, CHAT_SCHEMES, type ChatScheme } from '../../lib/groupChats/chatTheme';
import { useAuth } from '../../lib/AuthContext';
import { sampleMessages } from '../../lib/groupChats/devFixtures';
import type { ChatMessage } from '../../lib/groupChats/types';
import type { SendOutcome } from '../../lib/groupChats/useChatMessages';
import { ChatView } from '../../components/groupChats/ChatView';

export default function SiteGroupsPreview() {
  if (!__DEV__) return <Redirect href="/site-groups" />;
  return <Preview />;
}

// ?scheme=light|lightBlue|dark  ?readonly=1  ?unread=3  (screenshots only)
function Preview() {
  const params = useLocalSearchParams<{ scheme?: string; readonly?: string; unread?: string }>();
  const scheme: ChatScheme = CHAT_SCHEMES.includes(params.scheme as ChatScheme) ? (params.scheme as ChatScheme) : 'light';
  const { state } = useAuth();
  const myName = state.status === 'signed-in' ? state.profile.fullName : 'You';
  const [messages, setMessages] = useState<ChatMessage[]>(() => sampleMessages(myName));

  const setStatus = (id: string, status: ChatMessage['status']) => setMessages((list) => list.map((m) => (m.id === id ? { ...m, status, error: null } : m)));

  const send = useCallback(
    async (body: string): Promise<SendOutcome> => {
      const id = `preview-local-${Date.now()}`;
      setMessages((list) => [
        { id, group_id: 'preview', wa_message_id: null, client_message_id: id, from_me: true, sender_wa_id: null, sender_name: myName, type: 'text', body, status: 'sending', error: null, wa_timestamp: new Date().toISOString() },
        ...list,
      ]);
      setTimeout(() => setStatus(id, 'sent'), 700);
      return 'sent';
    },
    [myName]
  );
  const retry = useCallback(async (m: ChatMessage): Promise<SendOutcome> => {
    setStatus(m.id, 'sending');
    setTimeout(() => setStatus(m.id, 'sent'), 700);
    return 'sent';
  }, []);
  const remove = useCallback(async (m: ChatMessage) => setMessages((list) => list.filter((x) => x.id !== m.id)), []);

  return (
    <ChatSchemeProvider scheme={scheme}>
    <ChatView
      groupId="preview-block-a"
      title="Block A Site Team"
      projectName="ROAST @ Kokapet"
      initialUnread={Number(params.unread ?? 3) || 0}
      myName={myName}
      canSend={params.readonly !== '1'}
      messages={messages}
      loading={false}
      error={null}
      loadingOlder={false}
      loadOlder={() => {}}
      reload={() => {}}
      send={send}
      retry={retry}
      remove={remove}
    />
    </ChatSchemeProvider>
  );
}
