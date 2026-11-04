import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-reanimated';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import { formatCardDateRange } from '../../lib/flowchart/delay';
import { offsetToDate } from '../../lib/flowchart/templateDates';
import type { PositionedTemplateTask } from '../../lib/flowchart/templateTypes';

// Same 2-letter badge styling as TaskNode.tsx's own ACC_BADGE_STYLE/
// ACV_BADGE_STYLE — duplicated rather than imported/exported, same
// "simplified sibling" convention this whole file already follows.
const ACC_BADGE_STYLE = { bg: '#111111', text: '#ffffff', border: '#111111' };
const ACV_BADGE_STYLE = { bg: '#ffffff', text: '#111111', border: '#9CA3AF' };

// A simplified sibling of TaskNode.tsx — a template task has no Task Type,
// no delay/actual dates (only ever "planned"), so this drops those chips.
// AC/AV and a planned date-range chip DO now render, though: the
// task-creation popup collects real calendar dates + an AC/AV pick, backed
// by dayOffsetStart/End + accountabilityType (see templateTypes.ts) —
// templateCreatedAt is the fixed anchor those offsets convert back through
// (lib/flowchart/templateDates.ts), so the SAME calendar dates picked at
// creation are what render here, consistently, regardless of which day
// it's viewed on.
export function TemplateTaskNode({
  task,
  templateCreatedAt,
  draggingNodeId,
  dragDeltaX,
  dragDeltaY,
  onDragStart,
  onTap,
  isPendingLinkSource,
  // See TaskNode's identical prop — 1 unless clampToSafeBitmapBudget had to
  // shrink an unusually large template to stay under Android's bitmap
  // ceiling (lib/flowchart/layout.ts has the full crash context).
  nodeScale,
}: {
  task: PositionedTemplateTask;
  templateCreatedAt: string;
  draggingNodeId: SharedValue<string | null>;
  dragDeltaX: SharedValue<number>;
  dragDeltaY: SharedValue<number>;
  onDragStart: (taskId: string) => void;
  onTap: (taskId: string) => void;
  isPendingLinkSource: boolean;
  nodeScale: number;
}) {
  const isDragging = useDerivedValue(() => draggingNodeId.value === task.id);

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

  // Matches TaskNode.tsx's own box recipe exactly — uniform padding,
  // centered content, 14px rounding, badge moved above the box (see that
  // file's own comments for the reasoning behind each of these).
  const boxStyle = {
    position: 'absolute' as const,
    width: NODE_WIDTH * nodeScale,
    height: NODE_HEIGHT * nodeScale,
    borderRadius: 14,
    borderWidth: isPendingLinkSource ? 2 : 1,
    borderColor: isPendingLinkSource ? '#0F1F33' : '#000000',
    backgroundColor: '#F9FAFB',
    overflow: 'hidden' as const,
    padding: 10 * nodeScale,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };

  // Same nodeScale-aware font objects as TaskNode.tsx (see its own
  // comment) — a fixed Tailwind text-2xs/text-xs class never shrinks with
  // the box on a heavily-compressed template, so text overflowed past
  // neighboring boxes exactly like the bug already fixed on the real
  // canvas.
  const font2xs = { fontSize: 10 * nodeScale, lineHeight: 14 * nodeScale };
  const fontXs = { fontSize: 11 * nodeScale, lineHeight: 15 * nodeScale };

  const dateRangeLabel = formatCardDateRange(
    offsetToDate(templateCreatedAt, task.dayOffsetStart),
    offsetToDate(templateCreatedAt, task.dayOffsetEnd)
  );

  const badge = task.accountabilityType === 'ACC' ? ACC_BADGE_STYLE : task.accountabilityType === 'ACV' ? ACV_BADGE_STYLE : null;
  const badgeLabel = task.accountabilityType === 'ACC' ? 'AC' : 'AV';

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[boxStyle, animatedStyle]}>
        {/* Same top offset as TaskNode's own unified chip position, for the
            exact same gap-calibration reasons (see layout.ts's own
            comment). No delay chip — a template task is never "actually"
            in progress, only planned. */}
        <View className="absolute left-0 right-0 items-center" style={{ top: -20 * nodeScale }}>
          <View className="rounded-full" style={{ paddingHorizontal: 6 * nodeScale, paddingVertical: 2 * nodeScale, backgroundColor: '#FEF08A' }}>
            <Text className="font-bold text-yellow-900" style={font2xs}>{dateRangeLabel}</Text>
          </View>
        </View>

        {/* Badge — ABOVE the box, same -20 tier pinned to the right instead
            of centered, same reasoning as TaskNode's own comment. */}
        {badge && (
          <View
            className="absolute rounded"
            style={{
              top: -20 * nodeScale,
              right: 0,
              paddingHorizontal: 6 * nodeScale,
              paddingVertical: 2 * nodeScale,
              backgroundColor: badge.bg,
              borderWidth: 1.5,
              borderColor: badge.border,
            }}
          >
            <Text className="font-bold" style={[font2xs, { color: badge.text }]}>{badgeLabel}</Text>
          </View>
        )}

        {/* 3 lines, centered as one block (boxStyle's own justifyContent/
            alignItems: 'center'): muted id, muted category subtitle
            (workName), bold task name. trackLabel doesn't render on the
            box face — still set/edited via the task sheet, just not shown
            here, same as before this pass. */}
        <Text className="font-mono font-bold text-neutral-500" style={[font2xs, { textAlign: 'center' }]}>#{task.sortOrder + 1}</Text>
        <Text className="text-neutral-500" numberOfLines={2} style={[font2xs, { textAlign: 'center' }]}>{task.workName}</Text>
        <Text className="font-semibold text-neutral-900" numberOfLines={2} style={[fontXs, { textAlign: 'center' }]}>{task.taskName}</Text>
      </Animated.View>
    </GestureDetector>
  );
}
