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

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setData(null);
    read(projectId).then((d) => {
      if (cancelled) return;
      latest.current = d;
      setData(d);
    });
    const set = listeners.get(projectId) ?? new Set();
    const onChange = (d: MomProjectData) => {
      latest.current = d;
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
    async (fn: (d: MomProjectData) => MomProjectData) => {
      if (!projectId) return;
      const next = fn(latest.current);
      latest.current = next;
      listeners.get(projectId)?.forEach((l) => l(next));
      await write(projectId, next);
    },
    [projectId]
  );

  return { data, update };
}
