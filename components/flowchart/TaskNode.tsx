import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-reanimated';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import { resolveDelayChip, formatActualDateRange, formatCardDateRange, splitTaskName } from '../../lib/flowchart/delay';
import { getTaskBoxBackground } from '../../lib/flowchart/taskTypeColor';
import type { PositionedTask } from '../../lib/flowchart/types';

const ACC_BADGE_STYLE = { bg: '#111111', text: '#ffffff', border: '#111111' };
const ACV_BADGE_STYLE = { bg: '#ffffff', text: '#111111', border: '#9CA3AF' };

export function TaskNode({
  task,
  typeColors,
  draggingNodeId,
  dragDeltaX,
  dragDeltaY,
  onDragStart,
  onTap,
  isPendingLinkSource,
  // 1 for every normal project (the overwhelmingly common case) — only ever
  // smaller than 1 when clampToSafeBitmapBudget (lib/flowchart/layout.ts)
  // had to shrink an unusually large graph to stay under Android's bitmap
  // ceiling. MUST scale both the box itself and the chip offsets below by
  // this same factor — see that function's own comment on why a
  // position-only shrink guarantees box-on-box overlap otherwise.
  nodeScale,
}: {
  task: PositionedTask;
  typeColors: Record<string, string>;
  draggingNodeId: SharedValue<string | null>;
  dragDeltaX: SharedValue<number>;
  dragDeltaY: SharedValue<number>;
  onDragStart: (taskId: string) => void;
  onTap: (taskId: string) => void;
  isPendingLinkSource: boolean;
  nodeScale: number;
}) {
  const isDragging = useDerivedValue(() => draggingNodeId.value === task.id);

  // Movement itself is owned by the CANVAS's single Pan gesture (see
  // FlowchartCanvas) — this node only needs to (a) claim "I'm the one being
  // dragged" via long-press, and (b) recognize a plain tap. Giving this node
  // its OWN Pan gesture too would put two competing Pan recognizers in the
  // same touch area (this node's GestureDetector nested inside the canvas's),
  // which is exactly the kind of gesture-arbitration conflict that's hard to
  // get right and harder to verify without a physical device to test on.
  const longPress = Gesture.LongPress()
    .minDuration(350)
    .onStart(() => {
      runOnJS(onDragStart)(task.id);
    });

  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((_e, success) => {
      if (success) runOnJS(onTap)(task.id);
    });

  const gesture = Gesture.Race(longPress, tap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: task.x + (isDragging.value ? dragDeltaX.value : 0) },
      { translateY: task.y + (isDragging.value ? dragDeltaY.value : 0) },
    ],
    zIndex: isDragging.value ? 10 : 1,
    opacity: isDragging.value ? 0.85 : 1,
  }));

  // Box background is the task's own Task Type color mixed with its AC/AV
  // identity (dark tint for AC, light pastel for AV) — same
  // getTaskBoxBackground mix admin-web's flowchart uses, falls back to the
  // same neutral gray admin-web's own FORCED_GRAY.bg uses (#F9FAFB) when
  // either input is missing (no type set, or no accountability resolved) —
  // not plain white, which would be a visible mismatch from admin-web.
  const typeColor = task.taskTypeId ? typeColors[task.taskTypeId] ?? null : null;
  const boxMix = getTaskBoxBackground(typeColor, task.workAccountabilityType);
  const textColor = boxMix?.textColor ?? '#171717';

  // NativeWind's className styling doesn't reach react-native-reanimated's
  // Animated.View reliably (confirmed live: the box rendered with zero
  // background/border while its plain-View children — the badge, the date
  // chips — styled correctly via className right next to it) — so this
  // node's own box appearance is set via plain inline style instead of
  // Tailwind classes, only on this one wrapper.
  const boxStyle = {
    position: 'absolute' as const,
    width: NODE_WIDTH * nodeScale,
    height: NODE_HEIGHT * nodeScale,
    borderRadius: 8,
    borderWidth: isPendingLinkSource ? 2 : 1,
    borderColor: isPendingLinkSource ? '#0F1F33' : '#000000',
    backgroundColor: boxMix?.background ?? '#F9FAFB',
    // Tightened from 8, then from 5, then from a uniform 3 — asymmetric
    // now (less at the bottom) since the bottom edge was the one with
    // visibly excess empty space once category could wrap to 2 lines
    // instead of running long past the box's own width. Top/sides stay at
    // 3, close to the floor still legible against this box's 1px border.
    paddingTop: 3,
    paddingBottom: 1,
    paddingLeft: 3,
    paddingRight: 3,
  };

  const { category, action } = splitTaskName(task.taskName);
  const delayChip = resolveDelayChip(task);
  const dateRange = formatCardDateRange(task.plannedStartDate, task.dueDate);
  const actualDateRange = formatActualDateRange(task.actualStartDate, task.actualEndDate);
  const badge = task.workAccountabilityType === 'ACC' ? ACC_BADGE_STYLE : task.workAccountabilityType === 'ACV' ? ACV_BADGE_STYLE : null;
  const badgeLabel = task.workAccountabilityType === 'ACC' ? 'AC' : 'AV';

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[boxStyle, animatedStyle]}>
        {/* Restored — repeating the same +Nd on every downstream task is
            correct, not a bug: cascade_delay_days is one flat push applied
            uniformly across the whole downstream closure (see
            cascadePlannedDatesFromActualDelay in admin-web), so if task 1a
            slips by N days, every task after it genuinely IS delayed by
            that same N days too, all the way down the chain. The
            phase-level Expected Completion badges above the canvas
            (PhaseCompletionBar) show the resulting completion-date impact;
            this is the per-task "why" underneath it. */}
        {/* Two fixed rows now, not a conditional single row: the planned
            (yellow) chip always sits at the far row (-40) regardless of
            delay/actual data, and the near row (-20) holds whichever of
            delay/actual-dates chips actually apply (0, 1, or 2 of them,
            side by side) — same two-row split as admin-web's canvas. An
            "own" delay (real actual-vs-planned gap, not a cascaded
            estimate) always implies actual dates exist too (see
            ownDelayDays in lib/flowchart/delay.ts), so those two
            frequently appear together on the near row. */}
        {(delayChip || actualDateRange) && (
          <View className="absolute left-0 right-0 flex-row justify-center items-center gap-1.5" style={{ top: -20 * nodeScale }}>
            {delayChip && (
              <View
                className="px-1.5 py-0.5 rounded-full flex-row"
                style={{ backgroundColor: '#FEE2E2', borderWidth: delayChip.isOwnDelay ? 1.5 : 0, borderColor: '#000' }}
              >
                <Text className="text-2xs font-bold text-red-700">+{delayChip.days}d</Text>
              </View>
            )}
            {actualDateRange && (
              <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#FCA5A5' }}>
                <Text className="text-2xs font-bold text-red-900">{actualDateRange}</Text>
              </View>
            )}
          </View>
        )}
        <View className="absolute left-0 right-0 items-center" style={{ top: -40 * nodeScale }}>
          <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#FEF08A' }}>
            <Text className="text-2xs font-bold text-yellow-900">{dateRange}</Text>
          </View>
        </View>

        {/* taskId and the AC/AV badge share one flex row (not the badge
            absolutely-positioned separately) — React Native ignores a
            parent's own `padding` when placing an absolutely-positioned
            child (it aligns to the outer border, not the padding edge),
            which is exactly why the badge previously sat visibly higher
            than — not aligned with — the taskId text right next to it. A
            shared row with `items-center` guarantees they align regardless
            of that quirk. */}
        <View className="flex-row items-center justify-between">
          <Text className="text-2xs font-mono font-bold" style={{ color: textColor, opacity: 0.75 }}>{task.taskId}</Text>
          {badge && (
            <View
              className="px-1.5 py-0.5 rounded"
              style={{ backgroundColor: badge.bg, borderWidth: 1.5, borderColor: badge.border }}
            >
              <Text className="text-2xs font-bold" style={{ color: badge.text }}>{badgeLabel}</Text>
            </View>
          )}
        </View>
        {/* category wraps up to 2 lines instead of truncating at 1 — a long
            category (well above the ~15-char median) used to read as
            overflowing/running past the box's own width rather than
            cleanly ellipsizing. Still capped (not unbounded) so the box
            doesn't need to grow to fit BOTH a long wrapped category AND a
            long wrapped action at once.
            action's own cap was trimmed from 3 lines back to 2 — real data
            showed 2-line-category + 3-line-action together needed a
            genuinely taller box (108px) than the common case (80-91px),
            and shrinking the fixed box back down for the common case (per
            real feedback) means that combination can no longer fit;
            action now ellipsizes instead of the box overflowing for that
            handful of the longest real task names. */}
        {category && <Text className="text-2xs" numberOfLines={2} style={{ color: textColor, opacity: 0.75 }}>{category}</Text>}
        <Text className="text-xs font-semibold" numberOfLines={2} style={{ color: textColor }}>{action}</Text>
      </Animated.View>
    </GestureDetector>
  );
}
