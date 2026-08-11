import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import Animated, { useAnimatedRef, useAnimatedScrollHandler, scrollTo } from 'react-native-reanimated';
import type { TimelineWork } from '../../lib/projectTimeline';
import type { TaskDelayInfo } from '../../lib/gantt/delayEngine';
import { getTaskBoxBackground } from '../../lib/flowchart/taskTypeColor';
import { CategoryHealthBoxes } from './CategoryHealthBoxes';
import { HatchStripe } from './HatchStripe';
import { GanttDetailSheet } from './GanttDetailSheet';
import {
  BAR_HEIGHT,
  LABEL_WIDTH,
  MONTH_HEADER_HEIGHT,
  ROW_HEIGHT,
  TIMELINE_HEADER_HEIGHT,
  WEEK_HEADER_HEIGHT,
  WORK_HEADER_HEIGHT,
  ZOOM_PX_PER_DAY,
  addDays,
  buildTimelineScale,
  computeTimelineRange,
  differenceInCalendarDays,
  parseDateKey,
  toLocalCalendarDate,
  type ZoomLevel,
} from '../../lib/ganttLayout';
import { getStatusColor } from '../../lib/statusColors';
import { EmptyState } from '../ui/EmptyState';

// Planned bar sits above the Projected/Actual bar, touching (no gap) —
// same geometry as admin-web's GanttTaskBars.tsx.
const PLANNED_BAR_TOP = (ROW_HEIGHT - BAR_HEIGHT * 2) / 2;
const PROJECTED_BAR_TOP = PLANNED_BAR_TOP + BAR_HEIGHT;

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
        style={{ width: LABEL_WIDTH, height: TIMELINE_HEADER_HEIGHT, zIndex: 3 }}
      />

      {/* Frozen time-axis header — horizontally driven by the body, never scrolls on its own */}
      <View
        className="absolute top-0 bg-white border-b border-neutral-200 overflow-hidden"
        style={{ left: LABEL_WIDTH, right: 0, height: TIMELINE_HEADER_HEIGHT, zIndex: 2 }}
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
        style={{ top: TIMELINE_HEADER_HEIGHT, bottom: 0, width: LABEL_WIDTH, zIndex: 2 }}
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
        style={{ top: TIMELINE_HEADER_HEIGHT, left: LABEL_WIDTH, right: 0, bottom: 0 }}
        onLayout={(e) => setBodyHeight(e.nativeEvent.layout.height)}
      >
        <Animated.ScrollView
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

                    const typeColor = t.taskTypeId ? taskTypeColors[t.taskTypeId] ?? null : null;
                    const boxMix = getTaskBoxBackground(typeColor, t.workAccountabilityType);

                    const plannedBar = t.plannedStartDate && t.dueDate
                      ? (() => {
                          const start = parseDateKey(t.plannedStartDate!);
                          const due = parseDateKey(t.dueDate!);
                          const left = scale.dateToX(start);
                          return { left, width: Math.max(scale.dateToX(due) - left + scale.pxPerDay, 2) };
                        })()
                      : null;

                    const statusColor = getStatusColor(t.status).dot;
                    const projectedStart = toLocalCalendarDate(delay.projectedStart);
                    const projectedFinish = toLocalCalendarDate(delay.projectedFinish);
                    const dueDateObj = t.dueDate ? parseDateKey(t.dueDate) : null;
                    const hasDelay = !!dueDateObj && delay.totalDelayDays > 0;

                    const normalEnd = hasDelay && dueDateObj && dueDateObj < projectedFinish ? dueDateObj : projectedFinish;
                    const normalSpanDays = differenceInCalendarDays(normalEnd, projectedStart) + 1;
                    const hasNormalSegment = normalSpanDays > 0;
                    const normalSegment = hasNormalSegment
                      ? {
                          left: scale.dateToX(projectedStart),
                          width: Math.max(scale.dateToX(normalEnd) - scale.dateToX(projectedStart) + scale.pxPerDay, 2),
                        }
                      : null;
                    const delaySegment = hasDelay
                      ? (() => {
                          const start = hasNormalSegment ? addDays(normalEnd, 1) : projectedStart;
                          return {
                            left: scale.dateToX(start),
                            width: Math.max(scale.dateToX(projectedFinish) - scale.dateToX(start) + scale.pxPerDay, 2),
                          };
                        })()
                      : null;

                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => setDetailTaskId(t.id)}
                        className="border-b border-neutral-50"
                        style={{ height: ROW_HEIGHT }}
                      >
                        {plannedBar && (
                          <View
                            className="absolute rounded-sm"
                            style={{
                              top: PLANNED_BAR_TOP, height: BAR_HEIGHT, left: plannedBar.left, width: plannedBar.width,
                              backgroundColor: boxMix?.background ?? w.workColor, opacity: boxMix ? 1 : 0.55,
                            }}
                          />
                        )}
                        {normalSegment && (
                          <View
                            className="absolute rounded-sm"
                            style={{
                              top: PROJECTED_BAR_TOP, height: BAR_HEIGHT, left: normalSegment.left, width: normalSegment.width,
                              backgroundColor: statusColor, opacity: 0.55,
                            }}
                          />
                        )}
                        {delaySegment && (
                          <View className="absolute" style={{ top: PROJECTED_BAR_TOP, left: delaySegment.left }}>
                            <HatchStripe width={delaySegment.width} height={BAR_HEIGHT} />
                          </View>
                        )}
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
