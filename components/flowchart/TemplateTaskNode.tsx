import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-reanimated';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import type { PositionedTemplateTask } from '../../lib/flowchart/templateTypes';

// A simplified sibling of TaskNode.tsx — a template task has no real dates
// (a day-offset RANGE instead, replayed against a chosen anchor date only
// at apply time), no AC/AV, no Task Type, no delay/actual dates, so this
// drops every chip/badge tied to those concepts rather than rendering
// empty/misleading ones. Everything else (box size, drag gesture, gesture
// composition reasoning) is copied verbatim from TaskNode.tsx.
export function TemplateTaskNode({
  task,
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

  const boxStyle = {
    position: 'absolute' as const,
    width: NODE_WIDTH * nodeScale,
    height: NODE_HEIGHT * nodeScale,
    borderRadius: 8,
    borderWidth: isPendingLinkSource ? 2 : 1,
    borderColor: isPendingLinkSource ? '#0F1F33' : '#000000',
    backgroundColor: '#F9FAFB',
    padding: 3,
  };

  const dayRangeLabel = task.dayOffsetStart === task.dayOffsetEnd
    ? `Day ${task.dayOffsetStart}`
    : `Day ${task.dayOffsetStart} → Day ${task.dayOffsetEnd}`;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[boxStyle, animatedStyle]}>
        {/* Day-offset chip stands in for the real chip's date range — same
            top offset as TaskNode's own unified chip position, for the
            exact same gap-calibration reasons (see layout.ts's own
            comment). No delay chip — a template has no "actual" dates to
            fall behind. */}
        <View className="absolute left-0 right-0 items-center" style={{ top: -20 * nodeScale }}>
          <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#FEF08A' }}>
            <Text className="text-2xs font-bold text-yellow-900">{dayRangeLabel}</Text>
          </View>
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="text-2xs font-mono font-bold text-neutral-500">#{task.sortOrder + 1}</Text>
          {task.trackLabel && (
            <View className="px-1.5 py-0.5 rounded bg-neutral-100">
              <Text className="text-2xs font-bold text-neutral-500">{task.trackLabel}</Text>
            </View>
          )}
        </View>
        <Text className="text-2xs text-neutral-500" numberOfLines={1}>{task.workName}</Text>
        <Text className="text-xs font-semibold text-neutral-900" numberOfLines={3}>{task.taskName}</Text>
      </Animated.View>
    </GestureDetector>
  );
}
