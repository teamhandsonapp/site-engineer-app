import { View } from 'react-native';
import { Text } from '../ui/AppText';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Line, Polygon } from 'react-native-svg';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import { LINK_COLOR, LINK_STYLE, LINK_WARNING_COLOR, linkDateWarning } from '../../lib/flowchart/linkTypes';
import type { FlowchartParallelEdge, FlowchartSeriesEdge, PositionedTask } from '../../lib/flowchart/types';

// Label position: the line's middle, pushed off the line along its normal —
// upwards for flat-ish lines, to the right for steep ones — then nudged
// further out if it would land on a label already placed.
function placeLabels(
  lines: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[],
  s: number
): Map<string, { left: number; top: number }> {
  const out = new Map<string, { left: number; top: number }>();
  const placed: { x: number; y: number }[] = [];
  const w = LABEL_W * s;
  const h = LABEL_H * s;
  for (const l of lines) {
    const dx = l.to.x - l.from.x;
    const dy = l.to.y - l.from.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    // "Above" a flat-ish line; to the right of a steep one.
    const flip = Math.abs(ny) >= 0.35 ? ny > 0 : nx < 0;
    if (flip) {
      nx = -nx;
      ny = -ny;
    }
    const mx = (l.from.x + l.to.x) / 2;
    const my = (l.from.y + l.to.y) / 2;
    let d = LABEL_GAP * s + Math.max(w * Math.abs(nx), h * Math.abs(ny)) / 2;
    let cx = mx + nx * d;
    let cy = my + ny * d;
    for (let i = 0; i < 6 && placed.some((p) => Math.abs(p.x - cx) < w && Math.abs(p.y - cy) < h); i++) {
      d += h + 2 * s;
      cx = mx + nx * d;
      cy = my + ny * d;
    }
    placed.push({ x: cx, y: cy });
    out.set(l.id, { left: cx - w / 2, top: cy - h / 2 });
  }
  return out;
}

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
// 2026-11-13: line styles now come from lib/flowchart/linkTypes.ts —
// FS solid, SS double, FF dotted, SF dashed (one colour; the style tells
// them apart). Labels sit ABOVE the line's middle and dodge each other.
const LABEL_W = 30;
const LABEL_H = 18;
const LABEL_GAP = 10;

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
  onSeriesLabelPress,
  nodeScale,
  showLabels = true,
}: {
  tasks: PositionedTask[];
  seriesEdges: FlowchartSeriesEdge[];
  parallelEdges: FlowchartParallelEdge[];
  onEdgePress?: (edgeId: string, kind: 'series' | 'parallel') => void;
  // Series label taps (always on, locked or not): opens the link's info sheet.
  onSeriesLabelPress?: (edgeId: string) => void;
  nodeScale: number;
  // Off when zoomed far out — the line styles stay, the chips go.
  showLabels?: boolean;
}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const seriesLines = seriesEdges
    .map((e) => {
      const from = byId.get(e.dependsOnTaskId); // prerequisite
      const to = byId.get(e.taskId); // blocked task
      if (!from || !to) return null;
      return { edge: e, from: center(from, nodeScale), to: center(to, nodeScale), warning: linkDateWarning(e.type, from, to) };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
  const labelPos = showLabels ? placeLabels(seriesLines.map((l) => ({ id: l.edge.id, from: l.from, to: l.to })), nodeScale) : new Map();

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
          const style = LINK_STYLE[edge.type];
          if (style.double) {
            // SS: two parallel lines, 2.5px either side of the centre line.
            const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
            const ox = (-(to.y - from.y) / len) * 2.5 * nodeScale;
            const oy = ((to.x - from.x) / len) * 2.5 * nodeScale;
            return [1, -1].map((k) => (
              <Line
                key={`${edge.id}-${k}`}
                x1={from.x + ox * k}
                y1={from.y + oy * k}
                x2={to.x + ox * k}
                y2={to.y + oy * k}
                stroke={LINK_COLOR}
                strokeWidth={1.5}
              />
            ));
          }
          return (
            <Line
              key={edge.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={LINK_COLOR}
              strokeWidth={style.cap === 'round' ? 3 : 2}
              strokeDasharray={style.dash}
              strokeLinecap={style.cap ?? 'butt'}
            />
          );
        })}
        {seriesLines.map(({ edge, from, to }) => (
          <Polygon key={`arrow-${edge.id}`} points={arrowheadPoints(from, to, nodeScale)} fill={LINK_COLOR} />
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
      {seriesLines.map(({ edge, warning }) => {
        const pos = labelPos.get(edge.id);
        if (!pos) return null;
        const tint = warning ? LINK_WARNING_COLOR : LINK_COLOR;
        const style = {
          position: 'absolute' as const,
          left: pos.left,
          top: pos.top,
          width: LABEL_W * nodeScale,
          height: LABEL_H * nodeScale,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
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
          <View
            testID={`link-label-${edge.type}`}
            className="rounded"
            style={{
              paddingHorizontal: 4 * nodeScale,
              borderWidth: 1.5,
              borderColor: tint,
              backgroundColor: warning ? '#FEF2F2' : '#FFFFFF',
              height: LABEL_H * nodeScale,
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 10 * nodeScale, lineHeight: 13 * nodeScale, fontWeight: '700', color: warning ? LINK_WARNING_COLOR : '#111827' }}>
              {warning ? `${edge.type}!` : edge.type}
            </Text>
          </View>
        );
        const press = onSeriesLabelPress ?? (onEdgePress ? (id: string) => onEdgePress(id, 'series') : null);
        if (!press) {
          return <View key={`badge-${edge.id}`} pointerEvents="none" style={style}>{content}</View>;
        }
        return (
          <EdgeBadge key={`badge-${edge.id}`} onPress={() => press(edge.id)} style={style}>
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
