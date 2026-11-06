// Files › Site Photos — real-looking folders: Floor › Room › Wall › photos,
// with photo counts on every folder, a photo grid and a full-screen viewer.
// Data from lib/sitePhotos.ts (sample photos + this phone's DPR photos).

import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, space } from '../../lib/theme';
import { haptic } from '../../lib/haptics';
import { countWhere, LOCATION_TREE, locationLabel, roomsFor, useSitePhotos, WALLS, type SitePhoto } from '../../lib/sitePhotos';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { SkeletonList } from '../ui/States';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function FolderRow({ name, count, icon, onPress }: { name: string; count: number; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${count} photo${count === 1 ? '' : 's'}`}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          minHeight: 60,
          paddingHorizontal: space.lg,
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: space.sm,
        },
        shadow.card,
      ]}
    >
      <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: count > 0 ? colors.amberSoft : colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color={count > 0 ? '#B7791F' : colors.textMuted} />
      </View>
      <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
        {name}
      </AppText>
      <AppText variant="caption">
        {count} photo{count === 1 ? '' : 's'}
      </AppText>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

export function SitePhotosBrowser({ projectId, projectName, onExit }: { projectId: string; projectName: string; onExit: () => void }) {
  const { photos, loading } = useSitePhotos(projectId);
  const [floor, setFloor] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [wall, setWall] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const { width } = useWindowDimensions();

  const inWall = useMemo(
    () => (floor && room && wall ? photos.filter((p) => p.location.floor === floor && p.location.room === room && p.location.wall === wall) : []),
    [photos, floor, room, wall]
  );

  const crumbs: { label: string; onPress: () => void }[] = [
    { label: 'Files', onPress: onExit },
    { label: 'Site Photos', onPress: () => (setFloor(null), setRoom(null), setWall(null)) },
    ...(floor ? [{ label: floor, onPress: () => (setRoom(null), setWall(null)) }] : []),
    ...(room ? [{ label: room, onPress: () => setWall(null) }] : []),
    ...(wall ? [{ label: wall, onPress: () => {} }] : []),
  ];

  function up() {
    if (wall) setWall(null);
    else if (room) setRoom(null);
    else if (floor) setFloor(null);
    else onExit();
  }

  const gap = space.sm;
  const cols = width >= 600 ? 4 : 3;
  const tile = (Math.min(width, 900) - space.lg * 2 - gap * (cols - 1)) / cols;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}>
        {/* Breadcrumb */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: space.sm }}>
          {crumbs.map((c, i) => (
            <View key={`${c.label}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {i > 0 && <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />}
              <Pressable onPress={c.onPress} disabled={i === crumbs.length - 1} hitSlop={6}>
                <AppText variant="label" style={{ color: i === crumbs.length - 1 ? colors.textMuted : colors.navy }}>
                  {c.label}
                </AppText>
              </Pressable>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md, marginLeft: -space.sm }}>
          <IconButton icon="arrow-back" accessibilityLabel="Back" onPress={up} />
          <View style={{ flex: 1 }}>
            <AppText variant="title" numberOfLines={1}>
              {wall ?? room ?? floor ?? 'Site Photos'}
            </AppText>
            <AppText variant="caption" numberOfLines={1}>
              {floor ? `${projectName}${room ? ` · ${floor}` : ''}` : `${projectName} · organised by floor, room and wall`}
            </AppText>
          </View>
        </View>

        {loading ? (
          <SkeletonList rows={5} />
        ) : !floor ? (
          LOCATION_TREE.map((f) => <FolderRow key={f.floor} name={f.floor} icon="layers-outline" count={countWhere(photos, { floor: f.floor })} onPress={() => setFloor(f.floor)} />)
        ) : !room ? (
          roomsFor(floor).map((r) => <FolderRow key={r} name={r} icon="cube-outline" count={countWhere(photos, { floor, room: r })} onPress={() => setRoom(r)} />)
        ) : !wall ? (
          WALLS.map((w) => <FolderRow key={w} name={w} icon="folder" count={countWhere(photos, { floor, room, wall: w })} onPress={() => setWall(w)} />)
        ) : inWall.length === 0 ? (
          <EmptyState icon="images-outline" iconColor={colors.textMuted} title="No photos here yet" subtitle={`Photos tagged ${locationLabel({ floor, room, wall })} in a DPR will show here.`} />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
            {inWall.map((p, i) => (
              <Pressable
                key={p.id}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Photo ${i + 1}, ${formatWhen(p.takenAtISO)}, by ${p.by}`}
                onPress={() => setViewerIndex(i)}
                style={({ pressed }) => ({ width: tile, opacity: pressed ? 0.8 : 1 })}
              >
                <Image source={p.source} style={{ width: tile, height: tile, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted }} />
                <AppText variant="caption" numberOfLines={1} style={{ marginTop: 4 }}>
                  {formatWhen(p.takenAtISO)}
                </AppText>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <PhotoViewer photos={inWall} index={viewerIndex} onIndex={setViewerIndex} />
    </View>
  );
}

function PhotoViewer({ photos, index, onIndex }: { photos: SitePhoto[]; index: number | null; onIndex: (i: number | null) => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  if (index == null || !photos[index]) return null;
  const p = photos[index];
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={() => onIndex(null)}>
      <View style={{ flex: 1, backgroundColor: '#05080D', paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
          <IconButton icon="close" color="#FFFFFF" accessibilityLabel="Close photo" onPress={() => onIndex(null)} />
          <AppText variant="label" tone="inverse" style={{ flex: 1, textAlign: 'center' }}>
            {index + 1} of {photos.length}
          </AppText>
          <View style={{ width: 44 }} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Image source={p.source} resizeMode="contain" style={{ width, height: height * 0.6 }} accessibilityLabel="Site photo" />
        </View>
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: 4 }}>
          <AppText variant="bodyStrong" tone="inverse">
            {locationLabel(p.location)}
          </AppText>
          <AppText variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {formatWhen(p.takenAtISO)} · {p.by}
            {p.taskName ? ` · ${p.taskName}` : ''}
            {p.sample ? ' · Sample photo' : ''}
          </AppText>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <IconButton icon="chevron-back" color="#FFFFFF" accessibilityLabel="Previous photo" disabled={index === 0} onPress={() => onIndex(index - 1)} />
          <IconButton icon="chevron-forward" color="#FFFFFF" accessibilityLabel="Next photo" disabled={index === photos.length - 1} onPress={() => onIndex(index + 1)} />
        </View>
      </View>
    </Modal>
  );
}
