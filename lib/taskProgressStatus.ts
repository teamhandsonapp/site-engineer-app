// Calculated DPR task status — the database is the source of truth
// (supabase/migrations/20261113120000_task_progress_status.sql: function
// task_progress_status + view task_progress_statuses). This file reads that
// view, holds the shared labels/colours, and mirrors the same rules in
// computeProgressStatus() so they're unit-tested (lib/__tests__/) and can be
// used as a fallback. Keep the two in step.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type ProgressStatus = 'yet_to_start' | 'delayed' | 'on_hold' | 'in_progress' | 'completed';

export const PROGRESS_STATUS_ORDER: ProgressStatus[] = ['yet_to_start', 'delayed', 'in_progress', 'on_hold', 'completed'];

export const PROGRESS_STATUS_META: Record<ProgressStatus, { label: string; color: string; bg: string; border: string }> = {
  yet_to_start: { label: 'Yet to Start', color: '#4B5563', bg: '#F3F4F6', border: '#D1D5DB' },
  delayed: { label: 'Delayed', color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  on_hold: { label: 'On Hold', color: '#C2410C', bg: '#FFF7ED', border: '#FED7AA' },
  in_progress: { label: 'In Progress', color: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE' },
  completed: { label: 'Completed', color: '#15803D', bg: '#F0FDF4', border: '#BBF7D0' },
};

export interface ProgressStatusInfo {
  status: ProgressStatus;
  reason: string;
  overdue: boolean;
  progress: number;
  missingDates: string[];
}

/** Calculated status for these tasks (one query). Missing ids are simply absent. */
export async function fetchProgressStatuses(taskIds: string[]): Promise<Map<string, ProgressStatusInfo>> {
  const out = new Map<string, ProgressStatusInfo>();
  const ids = [...new Set(taskIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('task_progress_statuses')
      .select('task_id, status, reason, overdue, progress, missing_dates')
      .in('task_id', ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { task_id: string; status: ProgressStatus; reason: string; overdue: boolean; progress: number; missing_dates: string[] | null }[]) {
      out.set(r.task_id, { status: r.status, reason: r.reason, overdue: r.overdue, progress: r.progress, missingDates: r.missing_dates ?? [] });
    }
  }
  return out;
}

/** Hook: calculated statuses for a list of task ids (refetched when the id list changes). */
export function useProgressStatuses(taskIds: string[]): Map<string, ProgressStatusInfo> {
  const [map, setMap] = useState<Map<string, ProgressStatusInfo>>(new Map());
  const key = [...taskIds].sort().join(',');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetchProgressStatuses(key.split(','))
      .then((m) => alive && setMap(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  return map;
}

// ── Pure mirror of the SQL rules (tested) ────────────────────────────────

export interface StatusInput {
  today: string; // 'YYYY-MM-DD', India time
  taskStatus: string; // tasks.status (workflow)
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  // Every DPR row of the task: date, % share, whether it counts as filled (submitted or PR).
  entries: { date: string; percent: number | null; filled: boolean }[];
  holidays?: string[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (k: string) => `${Number(k.slice(8, 10))} ${MONTHS[Number(k.slice(5, 7)) - 1]}`;
const addDays = (k: string, n: number) => {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isSunday = (k: string) => new Date(`${k}T00:00:00Z`).getUTCDay() === 0;
const minKey = (...ks: (string | null)[]) => ks.filter((k): k is string => !!k).sort()[0] ?? null;

export function computeProgressStatus(i: StatusInput): ProgressStatusInfo {
  const progress = Math.min(100, i.entries.reduce((s, e) => s + (e.percent ?? 0), 0));
  const firstFilled = minKey(...i.entries.filter((e) => e.filled).map((e) => e.date));
  const base = { progress, overdue: false, missingDates: [] as string[] };

  if (progress >= 100 || i.taskStatus === 'completed') {
    return { ...base, status: 'completed', reason: progress >= 100 ? 'Completed: progress is 100%' : 'Completed: the task is marked completed' };
  }
  const overdue = !!i.plannedEnd && i.today > i.plannedEnd;
  const started = !!i.actualStart || !!firstFilled || i.taskStatus === 'in_progress' || i.taskStatus === 'on_hold';

  if (!started) {
    if (!i.plannedStart || i.plannedStart >= i.today) {
      const reason = !i.plannedStart
        ? 'Yet to Start: no planned start date yet'
        : i.plannedStart === i.today
          ? 'Yet to Start: planned to start today'
          : `Yet to Start: planned to start ${day(i.plannedStart)}`;
      return { ...base, overdue, status: 'yet_to_start', reason };
    }
    return { ...base, overdue, status: 'delayed', reason: `Delayed: planned to start ${day(i.plannedStart)}, not started yet` };
  }

  const from = i.actualStart ?? minKey(i.plannedStart, firstFilled);
  const yesterday = addDays(i.today, -1);
  const to = i.plannedEnd && i.plannedEnd < yesterday ? i.plannedEnd : yesterday;
  const filled = new Set(i.entries.filter((e) => e.filled).map((e) => e.date));
  const holidays = new Set(i.holidays ?? []);
  const missing: string[] = [];
  if (from && from <= to) {
    for (let k = from; k <= to; k = addDays(k, 1)) {
      if (!isSunday(k) && !holidays.has(k) && !filled.has(k)) missing.push(k);
    }
  }
  if (missing.length) {
    const list = missing.slice(0, 5).map(day).join(', ');
    const more = missing.length > 5 ? ` and ${missing.length - 5} more` : '';
    return { progress, overdue, missingDates: missing, status: 'on_hold', reason: `On Hold: DPR${missing.length > 1 ? 's' : ''} missing for ${list}${more}` };
  }
  return {
    progress,
    overdue,
    missingDates: [],
    status: 'in_progress',
    reason: `In Progress: all DPRs up to yesterday are filled, ${progress}% done${overdue && i.plannedEnd ? ` — past the planned end (${day(i.plannedEnd)})` : ''}`,
  };
}
