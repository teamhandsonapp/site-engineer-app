// Long-press → "Select text": the message in a sheet where it IS selectable.
// Bubbles themselves are never selectable, which keeps scrolling smooth.

import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { themedStyles, useChatScheme } from '../../lib/groupChats/chatTheme';
import { HIT } from '../../lib/theme';

export function SelectTextSheet({ text, onClose }: { text: string | null; onClose: () => void }) {
  const s = sheet(useChatScheme());
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={text !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={s.header}>
          <Text style={s.title}>Select text</Text>
          <Pressable onPress={onClose} style={s.close} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={s.closeText}>Done</Text>
          </Pressable>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.content}>
          <Text selectable style={s.text}>
            {text}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const sheet = themedStyles((p) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: p.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '75%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.separator },
  title: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 16, color: p.title },
  close: { minWidth: HIT, height: HIT, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 15, color: p.unreadText },
  scroll: { flexGrow: 0 },
  content: { padding: 16 },
  text: { fontFamily: 'IBMPlexSans_400Regular', fontSize: 16, lineHeight: 23, color: p.title },
}));
