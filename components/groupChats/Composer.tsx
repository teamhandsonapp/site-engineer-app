// WhatsApp-style composer, in our colours: a bar on the chat wallpaper (no
// grey block) with a white pill input (radius 24, min 44, grows to 5
// lines, placeholder "Message") and a 48 pt round send button in our
// primary navy, greyed out while empty. No emoji / attach / camera / mic —
// they aren't supported, so they aren't shown. The safe-area inset keeps it
// clear of the home indicator / gesture bar; the screen's
// KeyboardAvoidingView lifts it above the keyboard.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { haptic } from '../../lib/haptics';
import { themedStyles, useChatPalette, useChatScheme } from '../../lib/groupChats/chatTheme';
import { getDraft, setDraft } from '../../lib/groupChats/drafts';

const MAX_CHARS = 4096;
const LINE = 20;
const SEND = 48;

export function Composer({ groupId, onSend }: { groupId: string; onSend: (body: string) => void }) {
  const [text, setText] = useState(() => getDraft(groupId));
  const trimmed = text.trim();
  const insets = useSafeAreaInsets();
  const s = sheet(useChatScheme());
  const p = useChatPalette();

  useEffect(() => {
    setDraft(groupId, text);
  }, [groupId, text]);

  function send() {
    if (!trimmed) return;
    haptic.tap();
    onSend(trimmed);
    setText('');
  }

  return (
    <View style={[s.bar, { paddingBottom: 6 + insets.bottom }]}>
      <View style={s.pill}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor={p.placeholder}
          multiline
          maxLength={MAX_CHARS}
          style={s.input}
          accessibilityLabel="Message"
          textAlignVertical="center"
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !trimmed }}
        disabled={!trimmed}
        onPress={send}
        style={({ pressed }) => [s.send, !trimmed && s.sendDisabled, pressed && s.sendPressed]}
      >
        <Ionicons name="send" size={20} color={p.sendIcon} style={s.sendIcon} />
      </Pressable>
    </View>
  );
}

export function ReadOnlyNote() {
  const insets = useSafeAreaInsets();
  const s = sheet(useChatScheme());
  const p = useChatPalette();
  return (
    <View style={[s.readOnlyWrap, { paddingBottom: 8 + insets.bottom }]}>
      <View style={s.readOnly}>
        <Ionicons name="eye-outline" size={14} color={p.readOnlyText} />
        <Text style={s.readOnlyText}>You can read this group. Replies are sent by the account owner.</Text>
      </View>
    </View>
  );
}

const sheet = themedStyles((p) => ({
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 6, paddingTop: 6 },
  pill: { flex: 1, minHeight: 44, borderRadius: 24, backgroundColor: p.inputBg, boxShadow: p.bubbleShadow, justifyContent: 'center' },
  input: {
    fontSize: 16,
    lineHeight: LINE,
    color: p.inputText,
    minHeight: 44,
    maxHeight: LINE * 5 + 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  send: { width: SEND, height: SEND, borderRadius: SEND / 2, backgroundColor: p.sendBg, alignItems: 'center', justifyContent: 'center', marginBottom: -2 },
  sendDisabled: { backgroundColor: p.sendBgDisabled },
  sendPressed: { opacity: 0.85 },
  sendIcon: { marginLeft: 3 },
  readOnlyWrap: { alignItems: 'center', paddingTop: 6, paddingHorizontal: 12 },
  readOnly: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: p.readOnlyBg },
  readOnlyText: { fontSize: 12.5, lineHeight: 17, color: p.readOnlyText, flexShrink: 1, textAlign: 'center' },
}));
