// Device-local storage for the MoM section, one AsyncStorage entry per
// project. Deliberately behind this small hook so the screens don't care
// where data lives — swapping to Supabase tables later only changes this
// file. Until then, meetings/schedules/history are visible only on the
// phone (or browser) that created them.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { devWarn } from '../devLog';
import type { MomProjectData } from './types';

const KEY_PREFIX = 'mom:v1:';
const EMPTY: MomProjectData = { meetings: [], schedules: [], history: [] };

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function read(projectId: string): Promise<MomProjectData> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + projectId);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<MomProjectData>;
    return {
      meetings: parsed.meetings ?? [],
      schedules: parsed.schedules ?? [],
      history: parsed.history ?? [],
    };
  } catch (err) {
    devWarn('[mom] could not read saved data:', err);
    return EMPTY;
  }
}

async function write(projectId: string, data: MomProjectData): Promise<void> {
  await AsyncStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(data));
}

// Shared across every mounted tab so a change in one (e.g. a report sent
// from Custom Alerts) shows up in another (Reports history) immediately.
const listeners = new Map<string, Set<(d: MomProjectData) => void>>();

export function useMomData(projectId: string | null) {
  const [data, setData] = useState<MomProjectData | null>(null);
  const latest = useRef<MomProjectData>(EMPTY);
  // Which project `latest` really holds (null while it's still loading).
  const loadedFor = useRef<string | null>(null);
  // Saves run one after another, so two quick changes can't overwrite each other.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    // Until this project's data has loaded, update() reads it itself rather
    // than building on the previous project's data.
    loadedFor.current = null;
    setData(null);
    read(projectId).then((d) => {
      if (cancelled) return;
      latest.current = d;
      loadedFor.current = projectId;
      setData(d);
    });
    const set = listeners.get(projectId) ?? new Set();
    const onChange = (d: MomProjectData) => {
      latest.current = d;
      loadedFor.current = projectId;
      setData(d);
    };
    set.add(onChange);
    listeners.set(projectId, set);
    return () => {
      cancelled = true;
      set.delete(onChange);
    };
  }, [projectId]);

  const update = useCallback(
    (fn: (d: MomProjectData) => MomProjectData): Promise<void> => {
      if (!projectId) return Promise.resolve();
      const run = async () => {
        if (loadedFor.current !== projectId) {
          latest.current = await read(projectId);
          loadedFor.current = projectId;
        }
        const next = fn(latest.current);
        // Save first, then show it — so the screen never displays a change
        // that wasn't actually stored. A failed write throws to the caller.
        await write(projectId, next);
        latest.current = next;
        listeners.get(projectId)?.forEach((l) => l(next));
      };
      const result = queue.current.then(run, run);
      queue.current = result.catch(() => {});
      return result;
    },
    [projectId]
  );

  return { data, update };
}
