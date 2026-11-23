import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, useWindowDimensions, View } from 'react-native';
import { Text } from '../ui/AppText';
import Animated, { useAnimatedRef, useAnimatedScrollHandler, scrollTo } from 'react-native-reanimated';
import type { TimelineWork } from '../../lib/projectTimeline';
import type { TaskDelayInfo } from '../../lib/gantt/delayEngine';
import { CategoryHealthBoxes } from './CategoryHealthBoxes';
import { GanttDetailSheet } from './GanttDetailSheet';
import {
  LABEL_WIDTH,
  MONTH_HEADER_HEIGHT,
  ROW_HEIGHT,
  TIMELINE_HEADER_HEIGHT,
  WEEK_HEADER_HEIGHT,
  WORK_HEADER_HEIGHT,
  ZOOM_PX_PER_DAY,
  buildTimelineScale,
  computeTimelineRange,
  differenceInCalendarDays,
  parseDateKey,
  toLocalCalendarDate,
  type ZoomLevel,
} from '../../lib/ganttLayout';
import { EmptyState } from '../ui/EmptyState';

// 2026-11-15: bars styled like the client's Gantt reference.
//   Top bar (red = late vs planned finish, blue = on time / early) = the task as it is really running:
//     solid = done (actual start -> actual end, or -> today while running)
//     light = still to do (today -> projected finish), or the whole
//             projected span when the task hasn't started yet.
//   Thin grey bar right under it = the planned dates (baseline).
//   The "+N days" tag under the task name is the difference.
const BAR_TOP = 16;
const BAR_HEIGHT = 16;
const BASE_TOP = BAR_TOP + BAR_HEIGHT + 3;
const BASE_HEIGHT = 6;
export const BASELINE_COLOR = '#9CA3AF';
export const LATE_COLOR = '#DC2626';
export const ON_TIME_COLOR = '#2563EB';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const shiftDay = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function Bar({ left, width, top, height, color, opacity = 1, radius = 4 }: { left: number; width: number; top: number; height: number; color: string; opacity?: number; radius?: number }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left, top, width: Math.max(width, 3), height, backgroundColor: color, opacity, borderRadius: radius }}
    />
  );
}

// Baseline difference (2026-11-15, client's Gantt reference): finish vs the
// planned finish, every day counted. Finished → actual end; otherwise the
// projected finish. "+2 days" red (late), "-1 day" green (early), "0 days" grey.
function finishVariance(
  t: { dueDate: string | null; actualEndDate: string | null },
  delay: TaskDelayInfo | undefined
): number | null {
  if (!t.dueDate) return null;
  const end = t.actualEndDate ? parseDateKey(t.actualEndDate) : delay ? toLocalCalendarDate(delay.projectedFinish) : null;
  return end ? differenceInCalendarDays(end, parseDateKey(t.dueDate)) : null;
}

function VarianceTag({ days }: { days: number | null }) {
  if (days === null) return null;
  const late = days > 0;
  const early = days < 0;
  const text = `${late ? '+' : ''}${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
  return (
    <View
      className="self-start rounded px-1.5 mt-0.5"
      style={{ backgroundColor: late ? '#FEE2E2' : early ? '#DCFCE7' : '#F3F4F6' }}
    >
      <Text style={{ fontSize: 10, fontWeight: '700', color: late ? '#B91C1C' : early ? '#15803D' : '#6B7280' }}>{text}</Text>
    </View>
  );
}

// The single most important usability property of this screen: the time
// axis stays visible while scrolling down through trades, and the
// trade/task labels stay visible while scrolling right through time. Real
// device feel (momentum, overscroll) can't be confirmed without a
// simulator (see project notes) — but the sync mechanism itself is the
// standard Reanimated pattern, not a novel one: the body's own scroll
// events run a UI-thread worklet that calls `scrollTo` directly on the
// frozen header/label ScrollViews, so there is exactly one source of
// truth for scroll position (the body) and zero risk of the two drifting
// out of sync from JS-thread lag — the header/label views never accept
// touch input themselves (scrollEnabled=false), they are purely driven.
export function GanttChart({
  works,
  delayById,
  groundedIds,
  taskTypeColors,
  zoom,
  refreshing,
  onRefresh,
}: {
  works: TimelineWork[];
  delayById: Record<string, TaskDelayInfo>;
  groundedIds: Set<string>;
  taskTypeColors: Record<string, string>;
  zoom: ZoomLevel;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  // Task-name column: 168 on normal phones and up; on narrower phones 40% of
  // the screen (min 120) so the timeline keeps usable room (batch 5).
  const { width: screenWidth } = useWindowDimensions();
  const labelWidth = screenWidth >= 390 ? LABEL_WIDTH : Math.max(120, Math.round(screenWidth * 0.4));
  const headerScrollRef = useAnimatedRef<Animated.ScrollView>();
  const labelScrollRef = useAnimatedRef<Animated.ScrollView>();
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  // RN's ScrollView only stretches to fill a flex parent along the cross
  // axis, not the scroll axis — a vertical ScrollView nested inside a
  // horizontal one (the body) won't reliably inherit a bounded height from
  // its parent's default flexbox behavior alone. Measuring the body's own
  // rendered box and applying it explicitly removes that ambiguity rather
  // than depending on it, since this can't be checked on a real device.
  const [bodyHeight, setBodyHeight] = useState(0);
  const [bodyWidth, setBodyWidth] = useState(0);
  const bodyScrollRef = useAnimatedRef<Animated.ScrollView>();
  const jumpedForZoom = useRef<ZoomLevel | null>(null);

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  // Same set of dates admin-web's own GanttBoard feeds into its timeline
  // range — every row's planned dates AND (for a grounded task) its
  // projected start/finish, so a task running well past its due date still
  // expands the visible range far enough to show where it's now projected
  // to land, not just its original plan.
  const allDates = useMemo(() => {
    const dates: Date[] = [];
    for (const w of works) {
      for (const t of w.tasks) {
        if (t.plannedStartDate) dates.push(parseDateKey(t.plannedStartDate));
        if (t.dueDate) dates.push(parseDateKey(t.dueDate));
        if (groundedIds.has(t.id)) {
          const delay = delayById[t.id];
          if (delay) {
            dates.push(toLocalCalendarDate(delay.projectedStart));
            dates.push(toLocalCalendarDate(delay.projectedFinish));
          }
        }
      }
    }
    return dates;
  }, [works, delayById, groundedIds]);

  const scale = useMemo(() => {
    const { rangeStart, rangeEnd } = computeTimelineRange(allDates, today);
    return buildTimelineScale(rangeStart, rangeEnd, ZOOM_PX_PER_DAY[zoom]);
  }, [allDates, today, zoom]);

  const todayX = scale.dateToX(today);
  const showTodayMarker = todayX >= 0 && todayX <= scale.totalWidth;

  // Open on today (red line ~3/4 across, so the last two weeks show) instead of the range start,
  // which can be months back — once per zoom level, so a pull-to-refresh
  // doesn't yank the view away from where the user scrolled (2026-11-14).
  useEffect(() => {
    if (!bodyWidth || !showTodayMarker || jumpedForZoom.current === zoom) return;
    jumpedForZoom.current = zoom;
    const x = Math.max(0, Math.min(todayX - bodyWidth * 0.75, scale.totalWidth - bodyWidth));
    const id = setTimeout(() => {
      (bodyScrollRef.current as unknown as { scrollTo?: (o: { x: number; y: number; animated: boolean }) => void } | null)?.scrollTo?.({ x, y: 0, animated: false });
      (headerScrollRef.current as unknown as { scrollTo?: (o: { x: number; y: number; animated: boolean }) => void } | null)?.scrollTo?.({ x, y: 0, animated: false });
    }, 50);
    return () => clearTimeout(id);
  }, [bodyWidth, showTodayMarker, todayX, zoom, scale.totalWidth, bodyScrollRef, headerScrollRef]);

  const onBodyHorizontalScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollTo(headerScrollRef, e.contentOffset.x, 0, false);
    },
  });
  const onBodyVerticalScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollTo(labelScrollRef, 0, e.contentOffset.y, false);
    },
  });

  const hasWorks = works.length > 0;
  const hasAnyTasks = works.some((w) => w.tasks.length > 0);

  if (!hasWorks || !hasAnyTasks) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <EmptyState
          icon="calendar-outline"
          iconColor="#9CA3AF"
          title="No tasks yet"
          subtitle="This project doesn't have any scheduled tasks yet — check back once work has been planned."
        />
      </View>
    );
  }

  if (allDates.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <EmptyState
          icon="calendar-outline"
          iconColor="#9CA3AF"
          title="No dated tasks yet"
          subtitle="Tasks exist for this project but none have planned dates yet, so there's nothing to chart."
        />
      </View>
    );
  }

  const detailTask = detailTaskId ? works.flatMap((w) => w.tasks.map((t) => ({ ...t, workName: w.workName, workColor: w.workColor }))).find((t) => t.id === detailTaskId) ?? null : null;

  return (
    <View className="flex-1 bg-white">
      {/* Frozen corner */}
      <View
        className="absolute top-0 left-0 bg-white border-r border-b border-neutral-200"
        style={{ width: labelWidth, height: TIMELINE_HEADER_HEIGHT, zIndex: 3 }}
      />

      {/* Frozen time-axis header — horizontally driven by the body, never scrolls on its own */}
      <View
        className="absolute top-0 bg-white border-b border-neutral-200 overflow-hidden"
        style={{ left: labelWidth, right: 0, height: TIMELINE_HEADER_HEIGHT, zIndex: 2 }}
      >
        <Animated.ScrollView
          ref={headerScrollRef}
          horizontal
          style={{ flex: 1 }}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
        >
          <View style={{ width: scale.totalWidth }}>
            <View className="flex-row" style={{ height: MONTH_HEADER_HEIGHT }}>
              {scale.months.map((m) => (
                <View
                  key={`${m.label}-${m.left}`}
                  className="border-r border-neutral-100 justify-center px-2"
                  style={{ width: m.width }}
                >
                  <Text className="text-xs font-semibold text-neutral-600">{m.label}</Text>
                </View>
              ))}
            </View>
            <View className="flex-row" style={{ height: WEEK_HEADER_HEIGHT }}>
              {scale.weeks.map((w) => (
                <View
                  key={w.start.getTime()}
                  className="border-r border-neutral-100 items-center justify-center"
                  style={{ width: w.width }}
                >
                  <Text className="text-2xs text-neutral-400">
                    {w.start.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </Animated.ScrollView>
      </View>

      {/* Frozen trade/task labels — vertically driven by the body, never scrolls on its own */}
      <View
        className="absolute left-0 bg-white border-r border-neutral-200 overflow-hidden"
        style={{ top: TIMELINE_HEADER_HEIGHT, bottom: 0, width: labelWidth, zIndex: 2 }}
      >
        <Animated.ScrollView ref={labelScrollRef} style={{ flex: 1 }} scrollEnabled={false} showsVerticalScrollIndicator={false}>
          {works.map((w) => (
            <View key={w.workId}>
              <View
                className="flex-row items-center gap-1.5 px-2.5 bg-neutral-50 border-b border-neutral-100"
                style={{ height: WORK_HEADER_HEIGHT }}
              >
                <View className="w-2 h-2 rounded-full" style={{ backgroundColor: w.workColor }} />
                <Text className="text-xs font-bold text-neutral-700 flex-1" numberOfLines={1}>
                  {w.workName}
                </Text>
              </View>
              {w.tasks.map((t) => (
                <View
                  key={t.id}
                  className="justify-center px-2.5 border-b border-neutral-50"
                  style={{ height: ROW_HEIGHT }}
                >
                  <Text className="text-xs text-neutral-700" numberOfLines={2}>
                    {t.taskName}
                  </Text>
                  <VarianceTag days={finishVariance(t, delayById[t.id])} />
                </View>
              ))}
            </View>
          ))}
        </Animated.ScrollView>
      </View>

      {/* Scrollable body — the one real scroll surface; outer scroll drives
          the header, inner scroll drives the labels (see handlers above). */}
      <View
        className="absolute bg-white"
        style={{ top: TIMELINE_HEADER_HEIGHT, left: labelWidth, right: 0, bottom: 0 }}
        onLayout={(e) => {
          setBodyHeight(e.nativeEvent.layout.height);
          setBodyWidth(e.nativeEvent.layout.width);
        }}
      >
        <Animated.ScrollView
          ref={bodyScrollRef}
          horizontal
          style={{ flex: 1 }}
          onScroll={onBodyHorizontalScroll}
          scrollEventThrottle={16}
          nestedScrollEnabled
          showsHorizontalScrollIndicator
        >
          <Animated.ScrollView
            onScroll={onBodyVerticalScroll}
            scrollEventThrottle={16}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            style={{ width: scale.totalWidth, height: bodyHeight || undefined }}
            refreshControl={
              onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor="#0F1F33" /> : undefined
            }
          >
            <View style={{ width: scale.totalWidth }}>
              {showTodayMarker && (
                <View
                  className="absolute top-0 bottom-0 bg-red-500"
                  style={{ left: todayX, width: 2, zIndex: 1 }}
                />
              )}
              {works.map((w) => (
                <View key={w.workId}>
                  <View className="bg-neutral-50 border-b border-neutral-100" style={{ height: WORK_HEADER_HEIGHT }} />
                  {w.tasks.map((t) => {
                    const grounded = groundedIds.has(t.id);
                    const delay = delayById[t.id];

                    // An ungrounded task (no real schedule commitment
                    // anywhere in its own chain) must never render a bar
                    // that could be misread as "on schedule" — same rule
                    // admin-web's GanttTaskBars enforces.
                    if (!grounded || !delay) {
                      return (
                        <View key={t.id} className="border-b border-neutral-50 justify-center" style={{ height: ROW_HEIGHT }}>
                          <Text className="text-2xs italic text-neutral-300 px-2">No planned dates set</Text>
                          <CategoryHealthBoxes items={t.checklistItems} />
                        </View>
                      );
                    }

                    const today = toLocalCalendarDate(new Date());
                    const days = (a: Date, b: Date) => differenceInCalendarDays(b, a) + 1;
                    const planned = t.plannedStartDate && t.dueDate
                      ? { start: parseDateKey(t.plannedStartDate), end: parseDateKey(t.dueDate) }
                      : null;
                    const projStart = toLocalCalendarDate(delay.projectedStart);
                    const projEnd = toLocalCalendarDate(delay.projectedFinish);
                    // Done part (solid) and still-to-do part (light).
                    let done: { start: Date; end: Date } | null = null;
                    let todo: { start: Date; end: Date } | null = null;
                    if (t.actualStartDate) {
                      const aStart = parseDateKey(t.actualStartDate);
                      if (t.actualEndDate) {
                        done = { start: aStart, end: parseDateKey(t.actualEndDate) };
                      } else {
                        done = { start: aStart, end: today >= aStart ? today : aStart };
                        if (projEnd > done.end) todo = { start: shiftDay(done.end, 1), end: projEnd };
                      }
                    } else {
                      todo = { start: projStart, end: projEnd >= projStart ? projEnd : projStart };
                    }
                    // Colour by status (Civil Works' department colour is grey): late red, else blue.
                    const variance = finishVariance(t, delay);
                    const color = variance !== null && variance > 0 ? LATE_COLOR : ON_TIME_COLOR;
                    const x = scale.dateToX;
                    const px = scale.pxPerDay;
                    const span = (r: { start: Date; end: Date }) => ({ left: x(r.start), width: x(r.end) - x(r.start) + px });
                    const barStart = done?.start ?? todo!.start;
                    const barEnd = todo?.end ?? done!.end;
                    const rightEdge = Math.max(x(barEnd) + px, planned ? x(planned.end) + px : 0);
                    const label = t.actualEndDate
                      ? `${days(barStart, barEnd)}d · ${dayLabel(barStart)} – ${dayLabel(barEnd)}`
                      : t.actualStartDate
                        ? `Running · ${dayLabel(barStart)} – ${dayLabel(barEnd)}`
                        : `Not started · ${dayLabel(barStart)} – ${dayLabel(barEnd)}`;

                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => setDetailTaskId(t.id)}
                        className="border-b border-neutral-50"
                        style={{ height: ROW_HEIGHT }}
                      >
                        {done && <Bar {...span(done)} top={BAR_TOP} height={BAR_HEIGHT} color={color} />}
                        {todo && <Bar {...span(todo)} top={BAR_TOP} height={BAR_HEIGHT} color={color} opacity={0.35} />}
                        {planned && <Bar {...span(planned)} top={BASE_TOP} height={BASE_HEIGHT} color={BASELINE_COLOR} radius={3} />}
                        <Text
                          numberOfLines={1}
                          className="absolute"
                          style={{ top: BAR_TOP + 1, left: rightEdge + 6, fontSize: 10, fontWeight: '600', color: '#374151' }}
                        >
                          {label}
                        </Text>
                        <CategoryHealthBoxes items={t.checklistItems} />
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </Animated.ScrollView>
        </Animated.ScrollView>
      </View>

      <GanttDetailSheet
        task={detailTask}
        delayById={delayById}
        works={works}
        onClose={() => setDetailTaskId(null)}
      />
    </View>
  );
}
