import { TRACKING_STALE_AFTER_MINUTES } from './trackingHealth';

// "Tracking gap" detection for the day trail (components/DayTrailMap.tsx +
// DayTimelineView.tsx), so a hole in the data reads as a hole instead of a
// solid line pretending the engineer was tracked the whole time.
//
// Two sources, in priority order:
// 1. 'watcher' — location_disabled_alerts rows with reason 'no_heartbeat',
//    written server-side every 5 min by admin-web's tracking-silence-watcher
//    job. Authoritative: its disabled_at/enabled_at ARE the gap's
//    start/end, and it also catches a gap that's still open right now.
// 2. 'pings' — any two consecutive pings further apart than
//    TRACKING_STALE_AFTER_MINUTES (the same 15-min staleness threshold the
//    health pill uses) that no watcher episode already covers, e.g. a gap
//    shorter than the watcher's own detection window, or one that happened
//    while the watcher wasn't running.

export const GAP_THRESHOLD_MS = TRACKING_STALE_AFTER_MINUTES * 60_000;

export interface GapTrailPoint {
  latitude: number;
  longitude: number;
  occurredAtISO: string;
}

export interface SilenceEpisode {
  id: string;
  startISO: string;
  endISO: string | null; // null = still silent
}

export interface TrackingGap {
  id: string;
  startMs: number;
  endMs: number;
  ongoing: boolean;
  minutes: number;
  source: 'watcher' | 'pings';
  // Last point before / first point after the gap — the dashed segment on
  // the map connects these two. Either can be null (e.g. a gap that started
  // before the first ping of the day, or is still ongoing).
  fromPoint: GapTrailPoint | null;
  toPoint: GapTrailPoint | null;
}

const ms = (iso: string) => new Date(iso).getTime();

export function computeTrackingGaps(
  trail: GapTrailPoint[],
  episodes: SilenceEpisode[],
  nowMs: number,
  window: { startMs: number; endMs: number },
): TrackingGap[] {
  const points = [...trail].sort((a, b) => ms(a.occurredAtISO) - ms(b.occurredAtISO));
  const lastBefore = (t: number) => {
    let found: GapTrailPoint | null = null;
    for (const p of points) {
      if (ms(p.occurredAtISO) <= t) found = p;
      else break;
    }
    return found;
  };
  const firstAfter = (t: number) => points.find((p) => ms(p.occurredAtISO) >= t) ?? null;

  const gaps: TrackingGap[] = [];

  for (const e of episodes) {
    const startMs = Math.max(ms(e.startISO), window.startMs);
    const rawEnd = e.endISO ? ms(e.endISO) : nowMs;
    const endMs = Math.min(rawEnd, window.endMs, nowMs);
    if (endMs <= startMs) continue;
    const ongoing = e.endISO == null;
    gaps.push({
      id: `watcher:${e.id}`,
      startMs,
      endMs,
      ongoing,
      minutes: Math.round((endMs - startMs) / 60_000),
      source: 'watcher',
      fromPoint: lastBefore(startMs),
      toPoint: ongoing ? null : firstAfter(endMs),
    });
  }

  const overlapsWatcher = (a: number, b: number) =>
    gaps.some((g) => g.source === 'watcher' && g.startMs < b && g.endMs > a);

  for (let i = 1; i < points.length; i++) {
    const a = ms(points[i - 1].occurredAtISO);
    const b = ms(points[i].occurredAtISO);
    if (b - a <= GAP_THRESHOLD_MS || overlapsWatcher(a, b)) continue;
    gaps.push({
      id: `pings:${points[i - 1].occurredAtISO}`,
      startMs: a,
      endMs: b,
      ongoing: false,
      minutes: Math.round((b - a) / 60_000),
      source: 'pings',
      fromPoint: points[i - 1],
      toPoint: points[i],
    });
  }

  return gaps.sort((x, y) => x.startMs - y.startMs);
}

// Splits the trail into continuous runs, breaking wherever a gap lies
// between two consecutive points — so the solid line is never drawn across
// a gap (the gap gets its own dashed segment instead).
export function splitTrailIntoRuns<T extends GapTrailPoint>(trail: T[], gaps: TrackingGap[]): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];
  for (let i = 0; i < trail.length; i++) {
    if (i > 0) {
      const a = ms(trail[i - 1].occurredAtISO);
      const b = ms(trail[i].occurredAtISO);
      const broken = b - a > GAP_THRESHOLD_MS || gaps.some((g) => g.startMs < b && g.endMs > a);
      if (broken) {
        runs.push(current);
        current = [];
      }
    }
    current.push(trail[i]);
  }
  if (current.length) runs.push(current);
  return runs;
}

function clock(msValue: number): string {
  return new Date(msValue).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

// "Tracking gap: 45 min (10:05 am–10:50 am)" — shared by the map label and
// the list row so both read identically.
export function gapLabel(g: TrackingGap): string {
  const range = g.ongoing ? `${clock(g.startMs)}–now, still silent` : `${clock(g.startMs)}–${clock(g.endMs)}`;
  return `Tracking gap: ${duration(g.minutes)} (${range})`;
}
