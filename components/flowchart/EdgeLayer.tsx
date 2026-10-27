import { View, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Line, Polygon } from 'react-native-svg';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import type { DependencyType, FlowchartParallelEdge, FlowchartSeriesEdge, PositionedTask } from '../../lib/flowchart/types';

// Same color convention as admin-web's TaskDependencyGraph.tsx — series
// (FS/SS/FF/SF) is a real, enforced ordering relationship, so it's solid;
// parallel is symmetric/non-blocking/visual-only, so it stays dashed with
// no direction implied.
//
// Each of the 4 series types now gets its OWN line style, not just a text
// badge — a plain solid line for every type (only distinguishable by the
// small badge) failed the "each type visually distinguishable" ask, and a
// line with no arrowhead at all never showed direction for ANY type.
// Stays within the existing solid-orange family (extends it, per explicit
// request, rather than inventing an unrelated new style) — FS keeps the
// original plain solid line as the default/most common case, the other 3
// each get a distinct dash rhythm plus a slightly deeper shade. Mirrors
// TemplateEdgeLayer.tsx's identical map exactly.
const PARALLEL_EDGE_COLOR = '#2563EB';
// See the series-badge render comment below for why this exists.
const SERIES_BADGE_X_OFFSET = 34;
const SERIES_TYPE_STYLE: Record<DependencyType, { color: string; dash?: string }> = {
  FS: { color: '#F0A227' },
  SS: { color: '#F0A227', dash: '5,4' },
  FF: { color: '#C2660B', dash: '2,3' },
  SF: { color: '#B45309', dash: '8,3,2,3' },
};

// nodeScale mirrors TaskNode's own prop (1 unless clampToSafeBitmapBudget
// had to shrink an unusually large graph) — a line's endpoint must land on
// the CENTER of whatever size TaskNode is actually rendering that task's
// box at right now, not always NODE_WIDTH/HEIGHT's fixed full size, or
// every connector would visibly miss a shrunk box's true center.
function center(t: PositionedTask, nodeScale: number) {
  return { x: t.x + (NODE_WIDTH * nodeScale) / 2, y: t.y + (NODE_HEIGHT * nodeScale) / 2 };
}

// See TemplateEdgeLayer.tsx's identical arrowheadPoints() for the full
// rationale (pulled back to the target box's real edge via a ray/box
// intersection, not the box's exact center which task nodes would render
// over and hide entirely).
function arrowheadPoints(from: { x: number; y: number }, to: { x: number; y: number }, nodeScale: number): string {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const halfW = (NODE_WIDTH * nodeScale) / 2;
  const halfH = (NODE_HEIGHT * nodeScale) / 2;
  const t = Math.min(dx !== 0 ? halfW / Math.abs(dx) : Infinity, dy !== 0 ? halfH / Math.abs(dy) : Infinity);
  const tipX = to.x + dx * t;
  const tipY = to.y + dy * t;

  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const arrowLen = 9 * nodeScale;
  const arrowHalfWidth = 4 * nodeScale;
  const backX = tipX + ux * arrowLen;
  const backY = tipY + uy * arrowLen;
  const c1x = backX + px * arrowHalfWidth;
  const c1y = backY + py * arrowHalfWidth;
  const c2x = backX - px * arrowHalfWidth;
  const c2y = backY - py * arrowHalfWidth;
  return `${tipX},${tipY} ${c1x},${c1y} ${c2x},${c2y}`;
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
        {seriesLines.map(({ edge, from, to }) => {
          const style = SERIES_TYPE_STYLE[edge.type];
          return (
            <Line
              key={edge.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={style.color}
              strokeWidth={2}
              strokeDasharray={style.dash}
            />
          );
        })}
        {seriesLines.map(({ edge, from, to }) => (
          <Polygon key={`arrow-${edge.id}`} points={arrowheadPoints(from, to, nodeScale)} fill={SERIES_TYPE_STYLE[edge.type].color} />
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
          left: (from.x + to.x) / 2 - 14 * nodeScale + SERIES_BADGE_X_OFFSET * nodeScale,
          top: (from.y + to.y) / 2 - 12 * nodeScale,
          minWidth: 28 * nodeScale,
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
          // Scaled by nodeScale like every dimension in this file, matching
          // TaskNode's own fix for the same "fixed-size text on a shrunk
          // graph overlaps its neighbors" bug.
          <View className="bg-white rounded" style={{ paddingHorizontal: 6 * nodeScale, paddingVertical: 2 * nodeScale, borderWidth: 1.5, borderColor: SERIES_TYPE_STYLE[edge.type].color }}>
            <Text className="font-bold text-neutral-900" style={{ fontSize: 9 * nodeScale, lineHeight: 12 * nodeScale }}>{edge.type}</Text>
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
          left: (from.x + to.x) / 2 - 12 * nodeScale,
          top: (from.y + to.y) / 2 - 10 * nodeScale,
          minWidth: 24 * nodeScale,
          alignItems: 'center' as const,
        };
        const content = (
          <View className="bg-white border border-blue-200 rounded-full" style={{ paddingHorizontal: 6 * nodeScale, paddingVertical: 2 * nodeScale }}>
            <Text className="font-bold text-blue-600" style={{ fontSize: 10 * nodeScale, lineHeight: 14 * nodeScale }}>∥</Text>
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
