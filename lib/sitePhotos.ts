// Site photos organised by location (Project › Floor › Room › Wall).
//
// DUMMY / DEVICE-LOCAL FOR NOW, by explicit request:
//  • The floor / room / wall list below is a fixed sample, the same for every
//    project. It will be replaced by each project's real list (admin-defined,
//    or from drawing tagging) — only LOCATION_TREE needs to change.
//  • Sample photos are bundled images (assets/sample-photos), clearly marked
//    "SAMPLE", spread across a few locations so the folders aren't empty.
//  • Photos taken from a DPR are still uploaded as before (Supabase); their
//    location is remembered ON THIS PHONE (AsyncStorage) so they appear in
//    Files › Site Photos › … — until the Cloudflare R2 + database version
//    replaces this store.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';

export interface PhotoLocation {
  floor: string;
  room: string;
  wall: string;
}

export interface SitePhoto {
  id: string;
  projectId: string;
  location: PhotoLocation;
  source: ImageSourcePropType; // bundled sample image or { uri } of a local photo
  takenAtISO: string;
  by: string;
  taskName?: string | null;
  sample: boolean;
}

// ─── Location tree (sample) ─────────────────────────────────────────────
// Floors in building order, each with its rooms / areas. Walls are the same
// set for every room.
export const LOCATION_TREE: { floor: string; rooms: string[] }[] = [
  { floor: 'Foundation', rooms: ['Footings', 'Plinth Beam', 'Grade Slab'] },
  { floor: 'Ground Floor', rooms: ['Living Hall', 'Kitchen', 'Bedroom 1', 'Bathroom 1', 'Staircase', 'Parking'] },
  { floor: 'First Floor', rooms: ['Bedroom 2', 'Bedroom 3', 'Bathroom 2', 'Balcony', 'Staircase'] },
  { floor: 'Second Floor', rooms: ['Bedroom 4', 'Study', 'Bathroom 3', 'Utility', 'Staircase'] },
  { floor: 'Terrace', rooms: ['Parapet', 'Water Tank', 'Open Terrace'] },
];

export const WALLS: string[] = ['North Wall', 'South Wall', 'East Wall', 'West Wall', 'Ceiling', 'Floor'];

export function roomsFor(floor: string): string[] {
  return LOCATION_TREE.find((f) => f.floor === floor)?.rooms ?? [];
}

export function locationLabel(l: PhotoLocation): string {
  return `${l.floor} › ${l.room} › ${l.wall}`;
}

// ─── Sample photos ──────────────────────────────────────────────────────
const IMG = {
  brick: require('../assets/sample-photos/brick-wall.jpg'),
  plaster: require('../assets/sample-photos/plastered-wall.jpg'),
  column: require('../assets/sample-photos/concrete-column.jpg'),
  rebar: require('../assets/sample-photos/slab-rebar.jpg'),
  tiles: require('../assets/sample-photos/floor-tiles.jpg'),
  stairs: require('../assets/sample-photos/staircase.jpg'),
  conduit: require('../assets/sample-photos/electrical-conduit.jpg'),
  slab: require('../assets/sample-photos/slab-props.jpg'),
};

const SAMPLE_SPECS: { loc: PhotoLocation; img: keyof typeof IMG; daysAgo: number; by: string; task: string }[] = [
  { loc: { floor: 'Foundation', room: 'Footings', wall: 'Floor' }, img: 'rebar', daysAgo: 40, by: 'Kabilan', task: 'Footing reinforcement' },
  { loc: { floor: 'Foundation', room: 'Footings', wall: 'Floor' }, img: 'slab', daysAgo: 38, by: 'Kabilan', task: 'Footing concrete' },
  { loc: { floor: 'Foundation', room: 'Plinth Beam', wall: 'North Wall' }, img: 'column', daysAgo: 30, by: 'Prashuramu', task: 'Plinth beam casting' },
  { loc: { floor: 'Ground Floor', room: 'Living Hall', wall: 'North Wall' }, img: 'brick', daysAgo: 14, by: 'Kabilan', task: 'GF blockwork' },
  { loc: { floor: 'Ground Floor', room: 'Living Hall', wall: 'North Wall' }, img: 'plaster', daysAgo: 6, by: 'Prashuramu', task: 'GF internal plastering' },
  { loc: { floor: 'Ground Floor', room: 'Living Hall', wall: 'East Wall' }, img: 'brick', daysAgo: 13, by: 'Kabilan', task: 'GF blockwork' },
  { loc: { floor: 'Ground Floor', room: 'Living Hall', wall: 'Ceiling' }, img: 'slab', daysAgo: 20, by: 'Kabilan', task: 'GF roof slab' },
  { loc: { floor: 'Ground Floor', room: 'Kitchen', wall: 'South Wall' }, img: 'conduit', daysAgo: 9, by: 'Prashuramu', task: 'GF electrical conduits' },
  { loc: { floor: 'Ground Floor', room: 'Kitchen', wall: 'Floor' }, img: 'tiles', daysAgo: 3, by: 'Kabilan', task: 'GF flooring' },
  { loc: { floor: 'Ground Floor', room: 'Staircase', wall: 'West Wall' }, img: 'stairs', daysAgo: 11, by: 'Prashuramu', task: 'Staircase casting' },
  { loc: { floor: 'First Floor', room: 'Bedroom 2', wall: 'North Wall' }, img: 'brick', daysAgo: 5, by: 'Kabilan', task: 'FF blockwork' },
  { loc: { floor: 'First Floor', room: 'Bedroom 2', wall: 'Ceiling' }, img: 'rebar', daysAgo: 8, by: 'Kabilan', task: 'FF roof slab reinforcement' },
  { loc: { floor: 'First Floor', room: 'Balcony', wall: 'East Wall' }, img: 'column', daysAgo: 7, by: 'Prashuramu', task: 'Balcony columns' },
];

function samplePhotos(projectId: string): SitePhoto[] {
  const now = Date.now();
  return SAMPLE_SPECS.map((s, i) => ({
    id: `sample-${i}`,
    projectId,
    location: s.loc,
    source: IMG[s.img],
    takenAtISO: new Date(now - s.daysAgo * 86_400_000 - i * 3_600_000).toISOString(),
    by: s.by,
    taskName: s.task,
    sample: true,
  }));
}

// ─── Device-local store for photos added from a DPR ────────────────────
interface StoredPhoto {
  id: string;
  location: PhotoLocation;
  uri: string;
  takenAtISO: string;
  by: string;
  taskName: string | null;
}

const KEY = (projectId: string) => `site-photos:v1:${projectId}`;
const LAST_LOCATION_KEY = 'site-photos:last-location';
const listeners = new Map<string, Set<() => void>>();

async function readStored(projectId: string): Promise<StoredPhoto[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY(projectId));
    return raw ? (JSON.parse(raw) as StoredPhoto[]) : [];
  } catch {
    return [];
  }
}

export async function addSitePhoto(
  projectId: string,
  photo: { location: PhotoLocation; uri: string; by: string; taskName?: string | null }
): Promise<void> {
  const list = await readStored(projectId);
  const entry: StoredPhoto = {
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    location: photo.location,
    uri: photo.uri,
    takenAtISO: new Date().toISOString(),
    by: photo.by,
    taskName: photo.taskName ?? null,
  };
  await AsyncStorage.setItem(KEY(projectId), JSON.stringify([entry, ...list]));
  await AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(photo.location)).catch(() => {});
  listeners.get(projectId)?.forEach((l) => l());
}

export async function getLastLocation(): Promise<PhotoLocation | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_LOCATION_KEY);
    return raw ? (JSON.parse(raw) as PhotoLocation) : null;
  } catch {
    return null;
  }
}

// All photos for a project: this phone's DPR photos first, then samples.
export function useSitePhotos(projectId: string | null) {
  const [photos, setPhotos] = useState<SitePhoto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!projectId) {
      setPhotos([]);
      setLoading(false);
      return;
    }
    const stored = await readStored(projectId);
    const local: SitePhoto[] = stored.map((p) => ({
      id: p.id,
      projectId,
      location: p.location,
      source: { uri: p.uri },
      takenAtISO: p.takenAtISO,
      by: p.by,
      taskName: p.taskName,
      sample: false,
    }));
    setPhotos([...local, ...samplePhotos(projectId)]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
    if (!projectId) return;
    const set = listeners.get(projectId) ?? new Set();
    const l = () => void load();
    set.add(l);
    listeners.set(projectId, set);
    return () => {
      set.delete(l);
    };
  }, [projectId, load]);

  return { photos, loading, reload: load };
}

export function countWhere(photos: SitePhoto[], match: Partial<PhotoLocation>): number {
  return photos.filter(
    (p) =>
      (!match.floor || p.location.floor === match.floor) &&
      (!match.room || p.location.room === match.room) &&
      (!match.wall || p.location.wall === match.wall)
  ).length;
}
