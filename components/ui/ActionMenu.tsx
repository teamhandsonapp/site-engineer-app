// "⋯" overflow menu: hides Edit / Delete / other row actions behind one
// button instead of showing red icons on every row. Destructive actions ask
// for confirmation inside the sheet (no system alert, works on web too).

import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, HIT, radius, space } from '../../lib/theme';
import { haptic } from '../../lib/haptics';
import { AppText } from './AppText';
import { IconButton } from './Button';

export interface MenuAction {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  // For destructive actions: the confirmation question shown first.
  confirm?: string;
}

export function ActionMenu({ actions, title, accessibilityLabel = 'More actions' }: { actions: MenuAction[]; title?: string; accessibilityLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon="ellipsis-horizontal" color={colors.textMuted} accessibilityLabel={accessibilityLabel} onPress={() => setOpen(true)} />
      <ActionSheet visible={open} onClose={() => setOpen(false)} actions={actions} title={title} />
    </>
  );
}

// The sheet on its own, for menus opened by something other than the "⋯"
// button (e.g. long-press on a chat bubble). Same look and behaviour.
export function ActionSheet({
  visible,
  onClose,
  actions,
  title,
}: {
  visible: boolean;
  onClose: () => void;
  actions: MenuAction[];
  title?: string;
}) {
  const [confirming, setConfirming] = useState<MenuAction | null>(null);
  const insets = useSafeAreaInsets();

  function close() {
    setConfirming(null);
    onClose();
  }

  function choose(a: MenuAction) {
    if (a.destructive && a.confirm && !confirming) {
      haptic.press();
      setConfirming(a);
      return;
    }
    close();
    a.onPress();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,31,51,0.35)', justifyContent: 'flex-end' }} onPress={close} accessibilityLabel="Close menu">
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingTop: space.sm,
            paddingBottom: Math.max(insets.bottom, space.lg) + space.sm,
            paddingHorizontal: space.sm,
          }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.sm }} />
          {confirming ? (
            <View style={{ padding: space.md, gap: space.md }}>
              <AppText variant="section">{confirming.confirm}</AppText>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <MenuButton label="Cancel" onPress={() => setConfirming(null)} />
                <MenuButton label={confirming.label} destructive onPress={() => choose(confirming)} />
              </View>
            </View>
          ) : (
            <>
              {title ? (
                <AppText variant="caption" numberOfLines={1} style={{ paddingHorizontal: space.md, paddingBottom: space.sm }}>
                  {title}
                </AppText>
              ) : null}
              {actions.map((a) => (
                <Pressable
                  key={a.label}
                  accessibilityRole="button"
                  onPress={() => choose(a)}
                  style={({ pressed }) => ({
                    minHeight: HIT + 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.md,
                    borderRadius: radius.sm,
                    backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
                  })}
                >
                  {a.icon ? <Ionicons name={a.icon} size={20} color={a.destructive ? colors.danger : colors.navy} /> : null}
                  <AppText variant="bodyStrong" tone={a.destructive ? 'danger' : 'default'}>
                    {a.label}
                  </AppText>
                </Pressable>
              ))}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuButton({ label, onPress, destructive }: { label: string; onPress: () => void; destructive?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: HIT,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: destructive ? (pressed ? '#B91C1C' : colors.danger) : pressed ? colors.surfaceMuted : colors.surface,
        borderWidth: 1,
        borderColor: destructive ? colors.danger : colors.borderStrong,
      })}
    >
      <AppText variant="bodyStrong" style={{ color: destructive ? '#FFFFFF' : colors.navy }}>
        {label}
      </AppText>
    </Pressable>
  );
}
