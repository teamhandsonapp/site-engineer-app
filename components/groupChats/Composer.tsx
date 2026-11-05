import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, HIT, radius, space, type } from '../../lib/theme';
import { haptic } from '../../lib/haptics';
import { AppText } from '../ui/AppText';

const MAX_CHARS = 4096;
const LINE = type.body.lineHeight;

// Multiline up to 5 visible lines, 4096 chars, send disabled when empty.
// Clears immediately on send (the bubble shows as 'sending').
export function Composer({ onSend }: { onSend: (body: string) => void }) {
  const [text, setText] = useState('');
  const trimmed = text.trim();

  function send() {
    if (!trimmed) return;
    haptic.tap();
    onSend(trimmed);
    setText('');
  }

  return (
    <View style={styles.bar}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Message"
        placeholderTextColor={colors.placeholder}
        multiline
        maxLength={MAX_CHARS}
        style={styles.input}
        accessibilityLabel="Message"
        textAlignVertical="center"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !trimmed }}
        disabled={!trimmed}
        onPress={send}
        style={({ pressed }) => [styles.send, !trimmed && styles.sendDisabled, pressed && styles.sendPressed]}
      >
        <Ionicons name="send" size={18} color={trimmed ? colors.textInverse : colors.textMuted} />
      </Pressable>
    </View>
  );
}

export function ReadOnlyNote() {
  return (
    <View style={styles.readOnly}>
      <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
      <AppText variant="caption" tone="muted" style={styles.readOnlyText}>
        You can read this group. Replies are sent by the account owner.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    ...type.body,
    color: colors.text,
    minHeight: HIT - 4,
    maxHeight: LINE * 5 + space.md * 2,
    paddingHorizontal: space.md,
    paddingTop: space.sm + 2,
    paddingBottom: space.sm + 2,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
  },
  send: { width: HIT, height: HIT, borderRadius: HIT / 2, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { backgroundColor: colors.surfaceMuted },
  sendPressed: { opacity: 0.8 },
  readOnlyText: { flex: 1 },
  readOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
