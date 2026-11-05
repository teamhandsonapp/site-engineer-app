// Floor → Room → Wall picker, shown before a site photo is added. Big
// tappable tiles one step at a time (no dropdowns), a breadcrumb to step
// back, and a one-tap "Use last location" shortcut.

import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, HIT, radius, space } from '../../lib/theme';
import { haptic } from '../../lib/haptics';
import { getLastLocation, LOCATION_TREE, locationLabel, roomsFor, WALLS, type PhotoLocation } from '../../lib/sitePhotos';
import { AppText } from '../ui/AppText';
import { Button, IconButton } from '../ui/Button';

type Step = 'floor' | 'room' | 'wall';

const WALL_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  'North Wall': 'arrow-up-outline',
  'South Wall': 'arrow-down-outline',
  'East Wall': 'arrow-forward-outline',
  'West Wall': 'arrow-back-outline',
  Ceiling: 'chevron-up-circle-outline',
  Floor: 'chevron-down-circle-outline',
};

function Tile({ label, icon, selected, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => ({
        flexBasis: '47%',
        flexGrow: 1,
        minHeight: 72,
        borderRadius: radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.navy : colors.border,
        backgroundColor: selected ? colors.navySoft : pressed ? colors.surfaceMuted : colors.surface,
        padding: space.md,
        justifyContent: 'center',
        gap: 6,
      })}
    >
      <Ionicons name={icon} size={20} color={colors.navy} />
      <AppText variant="bodyStrong" numberOfLines={2}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function LocationPicker({
  visible,
  onClose,
  onConfirm,
  title = 'Where is this photo?',
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (location: PhotoLocation) => void;
  title?: string;
}) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('floor');
  const [floor, setFloor] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [last, setLast] = useState<PhotoLocation | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep('floor');
    setFloor(null);
    setRoom(null);
    let cancelled = false;
    getLastLocation().then((l) => !cancelled && setLast(l));
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const stepNo = step === 'floor' ? 1 : step === 'room' ? 2 : 3;
  const heading = step === 'floor' ? 'Choose the floor' : step === 'room' ? 'Choose the room' : 'Choose the wall';

  function back() {
    if (step === 'wall') setStep('room');
    else if (step === 'room') setStep('floor');
    else onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={back}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,31,51,0.35)' }} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={{
          maxHeight: '86%',
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingBottom: Math.max(insets.bottom, space.lg),
        }}
      >
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginTop: space.sm }} />
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingTop: space.xs }}>
          <IconButton icon={step === 'floor' ? 'close' : 'arrow-back'} accessibilityLabel={step === 'floor' ? 'Close' : 'Back'} onPress={back} />
          <View style={{ flex: 1 }}>
            <AppText variant="section">{title}</AppText>
            <AppText variant="caption">
              Step {stepNo} of 3 · {heading}
            </AppText>
          </View>
        </View>

        {/* Breadcrumb — tap a step to change it */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, paddingHorizontal: space.lg, marginTop: space.sm }}>
          <Crumb label={floor ?? 'Floor'} active={step === 'floor'} done={!!floor} onPress={() => setStep('floor')} />
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          <Crumb label={room ?? 'Room'} active={step === 'room'} done={!!room} disabled={!floor} onPress={() => floor && setStep('room')} />
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          <Crumb label="Wall" active={step === 'wall'} disabled={!room} onPress={() => room && setStep('wall')} />
        </View>

        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
          {step === 'floor' && last && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Use last location: ${locationLabel(last)}`}
              onPress={() => {
                haptic.select();
                onConfirm(last);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                minHeight: HIT + 12,
                paddingHorizontal: space.md,
                borderRadius: radius.md,
                backgroundColor: pressed ? '#F8E7C2' : colors.amberSoft,
                borderWidth: 1,
                borderColor: '#F3D592',
              })}
            >
              <Ionicons name="time-outline" size={20} color={colors.amberDeep} />
              <View style={{ flex: 1 }}>
                <AppText variant="label" style={{ color: colors.amberDeep }}>
                  Use last location
                </AppText>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {locationLabel(last)}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.amberDeep} />
            </Pressable>
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {step === 'floor' &&
              LOCATION_TREE.map((f) => (
                <Tile
                  key={f.floor}
                  label={f.floor}
                  icon="layers-outline"
                  selected={floor === f.floor}
                  onPress={() => {
                    setFloor(f.floor);
                    setRoom(null);
                    setStep('room');
                  }}
                />
              ))}
            {step === 'room' &&
              floor &&
              roomsFor(floor).map((r) => (
                <Tile
                  key={r}
                  label={r}
                  icon="cube-outline"
                  selected={room === r}
                  onPress={() => {
                    setRoom(r);
                    setStep('wall');
                  }}
                />
              ))}
            {step === 'wall' &&
              floor &&
              room &&
              WALLS.map((w) => <Tile key={w} label={w} icon={WALL_ICON[w] ?? 'square-outline'} onPress={() => onConfirm({ floor, room, wall: w })} />)}
          </View>
          {step === 'wall' && <AppText variant="caption">Tap a wall to continue to the photo.</AppText>}
        </ScrollView>

        {step !== 'floor' && (
          <View style={{ paddingHorizontal: space.lg }}>
            <Button label="Back" icon="arrow-back" variant="secondary" fullWidth onPress={back} />
          </View>
        )}
      </View>
    </Modal>
  );
}

function Crumb({ label, active, done, disabled, onPress }: { label: string; active: boolean; done?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 32,
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderRadius: radius.pill,
        backgroundColor: active ? colors.navy : done ? colors.navySoft : colors.surfaceMuted,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <AppText variant="label" numberOfLines={1} style={{ color: active ? '#FFFFFF' : colors.navy, maxWidth: 140 }}>
        {label}
      </AppText>
    </Pressable>
  );
}
