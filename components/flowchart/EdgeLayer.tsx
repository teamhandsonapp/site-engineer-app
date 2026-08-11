import { View, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import type { FlowchartParallelEdge, FlowchartSeriesEdge, PositionedTask } from '../../lib/flowchart/types';

// Same color convention as admin-web's TaskDependencyGraph.tsx — series
// (FS/SS/FF/SF) is a real, enforced ordering relationship, so it's solid;
// parallel is symmetric/non-blocking/visual-only, so it stays dashed with
// no direction implied.
const SERIES_EDGE_COLOR = '#F0A227';
const PARALLEL_EDGE_COLOR = '#2563EB';
// See the series-badge render comment below for why this exists.
const SERIES_BADGE_X_OFFSET = 34;

// nodeScale mirrors TaskNode's own prop (1 unless clampToSafeBitmapBudget
// had to shrink an unusually large graph) — a line's endpoint must land on
// the CENTER of whatever size TaskNode is actually rendering that task's
// box at right now, not always NODE_WIDTH/HEIGHT's fixed full size, or
// every connector would visibly miss a shrunk box's true center.
function center(t: PositionedTask, nodeScale: number) {
  return { x: t.x + (NODE_WIDTH * nodeScale) / 2, y: t.y + (NODE_HEIGHT * nodeScale) / 2 };
}

// A tappable edge badge, built from react-native-gesture-handler's own
// Gesture.Tap() — NOT a plain react-native <Pressable>. This whole layer
// renders inside the canvas's outer GestureDetector (the one driving
// pinch/pan, composed with no activation threshold), and a plain Pressable
// nested in that subtree loses the touch to the Pan recognizer before
// onPress ever fires — confirmed live: the badges were visible and
// correctly positioned but never actually opened anything on tap. TaskNode
// already worked around this the same way (its own Gesture.Race(longPress,
// tap)); this mirrors that exact approach instead of inventing a new one.
function EdgeBadge({
  onPress,
  style,
  children,
}: {
  onPress: () => void;
  style: object;
  children: React.ReactNode;
}) {
  const tap = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(onPress)();
  });
  return (
    <GestureDetector gesture={tap}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}

export function EdgeLayer({
  tasks,
  seriesEdges,
  parallelEdges,
  // Only set (and only rendered as tappable) when the canvas is UNLOCKED —
  // Part 5's own scope. An SVG <Line> can't usefully be hit-tested along an
  // arbitrary diagonal either way, so the actual tap target is a small,
  // visible marker at each edge's midpoint instead — the existing type
  // badge for series edges, and a small pill for parallel edges (which had
  // no midpoint marker at all before, since nothing needed to be tapped on
  // one yet).
  onEdgePress,
  nodeScale,
}: {
  tasks: PositionedTask[];
  seriesEdges: FlowchartSeriesEdge[];
  parallelEdges: FlowchartParallelEdge[];
  onEdgePress?: (edgeId: string, kind: 'series' | 'parallel') => void;
  nodeScale: number;
}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const seriesLines = seriesEdges
    .map((e) => {
      const from = byId.get(e.dependsOnTaskId); // prerequisite
      const to = byId.get(e.taskId); // blocked task
      if (!from || !to) return null;
      return { edge: e, from: center(from, nodeScale), to: center(to, nodeScale) };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const parallelLines = parallelEdges
    .map((e) => {
      const a = byId.get(e.taskAId);
      const b = byId.get(e.taskBId);
      if (!a || !b) return null;
      return { edge: e, from: center(a, nodeScale), to: center(b, nodeScale) };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return (
    <>
      <Svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}>
        {seriesLines.map(({ edge, from, to }) => (
          <Line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={SERIES_EDGE_COLOR} strokeWidth={2} />
        ))}
        {parallelLines.map(({ edge, from, to }) => (
          <Line
            key={edge.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={PARALLEL_EDGE_COLOR}
            strokeWidth={2}
            strokeDasharray="6,5"
          />
        ))}
      </Svg>

      {/* Type badge per series edge, at its midpoint — client feedback was
          that the relationship type (FS/SS/FF/SF) should be visible on the
          connecting line itself, including on the locked/view-only canvas
          (the common case), not just while actively managing links. Reverses
          an earlier pass's opposite call (which hid it entirely when locked,
          on then-current feedback that it read as clutter) — same
          "always render, only tappable when unlocked" duality the parallel
          badge below already uses.
          Offset sideways from the true midpoint (not centered on the line)
          — for a straight vertical chain edge (the common case), the exact
          midpoint sits right where the box below's own date/delay chip
          hugs its top edge (see TaskNode's `top: -20`), and the tightened
          VERTICAL_TARGET_GAP no longer leaves room for both a badge AND a
          chip stacked in the same spot without overlapping. Nudging the
          badge to one side avoids that collision entirely rather than
          fighting for vertical space that doesn't exist — a horizontal
          edge (the parallel-partner case) has no such conflict (chips sit
          near each box's TOP, not at box-center height where a horizontal
          line's midpoint falls), so the same fixed nudge is harmless there
          too, just a small, deliberate sideways shift off the line. */}
      {seriesLines.map(({ edge, from, to }) => {
        const style = {
          position: 'absolute' as const,
          left: (from.x + to.x) / 2 - 14 + SERIES_BADGE_X_OFFSET,
          top: (from.y + to.y) / 2 - 12,
          minWidth: 28,
          alignItems: 'center' as const,
        };
        const content = (
          // text-2xs (10px) is this app's smallest defined size — still
          // felt too large/heavy for a small inline badge, so this drops
          // to an explicit 9px below that floor. Contrast carries the
          // legibility at this size, not size itself: near-black text
          // (not mid-gray), a real (not hairline) border in the series
          // line's own color, and a tight but not clipped 12px line-height
          // so descenders on the badge's own rounded corners have room.
          <View className="bg-white rounded px-1.5 py-0.5" style={{ borderWidth: 1.5, borderColor: SERIES_EDGE_COLOR }}>
            <Text className="font-bold text-neutral-900" style={{ fontSize: 9, lineHeight: 12 }}>{edge.type}</Text>
          </View>
        );
        if (!onEdgePress) {
          return <View key={`badge-${edge.id}`} pointerEvents="none" style={style}>{content}</View>;
        }
        return (
          <EdgeBadge key={`badge-${edge.id}`} onPress={() => onEdgePress(edge.id, 'series')} style={style}>
            {content}
          </EdgeBadge>
        );
      })}

      {/* Parallel links had no midpoint marker at all before — a dashed
          line alone gives nothing to tap. This small pill is new, purely so
          a parallel link has the same "tap its midpoint marker to delete
          it" affordance as a series edge's type badge. A "∥" (parallel-to)
          glyph is used for the label — some device fonts don't carry that
          codepoint and substitute a fallback glyph that can read as a
          plain "I" at this size; the dashed blue line color plus the pill
          shape still distinguish it from a series badge either way. */}
      {parallelLines.map(({ edge, from, to }) => {
        const style = {
          position: 'absolute' as const,
          left: (from.x + to.x) / 2 - 12,
          top: (from.y + to.y) / 2 - 10,
          minWidth: 24,
          alignItems: 'center' as const,
        };
        const content = (
          <View className="bg-white border border-blue-200 rounded-full px-1.5 py-0.5">
            <Text className="text-2xs font-bold text-blue-600">∥</Text>
          </View>
        );
        if (!onEdgePress) {
          return <View key={`pbadge-${edge.id}`} pointerEvents="none" style={style}>{content}</View>;
        }
        return (
          <EdgeBadge key={`pbadge-${edge.id}`} onPress={() => onEdgePress(edge.id, 'parallel')} style={style}>
            {content}
          </EdgeBadge>
        );
      })}
    </>
  );
}
