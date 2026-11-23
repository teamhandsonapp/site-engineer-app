import { View } from 'react-native';
import { Text } from '../ui/AppText';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { longestRun, offsetRoute, routeEdge, trunksByTarget, type Box, type Pt } from '../../lib/flowchart/edgeRoute';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import { LINK_COLOR, LINK_STYLE, LINK_WARNING_COLOR, linkDateWarning } from '../../lib/flowchart/linkTypes';

// Soft links (2026-11-15): grey, reference only.
const SOFT_LINK_COLOR = '#9CA3AF';
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

function arrowheadPoints(route: Pt[], nodeScale: number): string {
  // Tip at the route's end (the target box's edge), pointing along the last run.
  const tip = route[route.length - 1];
  const prev = route[route.length - 2];
  const dx = prev.x - tip.x;
  const dy = prev.y - tip.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const arrowLen = 9 * nodeScale;
  const half = 4 * nodeScale;
  const bx = tip.x + ux * arrowLen;
  const by = tip.y + uy * arrowLen;
  return `${tip.x},${tip.y} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`;
}

const pts = (r: Pt[]) => r.map((p) => `${p.x},${p.y}`).join(' ');

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
  avoidZones = [],
}: {
  /** Group outlines links should keep clear of (Flowchart 2). */
  avoidZones?: { box: Box; members: Set<string> }[];
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
  // Right-angle routes (2026-11-15): straight runs with square bends in the gaps.
  const boxes: Box[] = tasks.map((t) => ({ id: t.id, x: t.x, y: t.y, w: NODE_WIDTH * nodeScale, h: NODE_HEIGHT * nodeScale }));
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const gaps = { gapBelow: 10 * nodeScale, gapAbove: 31 * nodeScale, colGap: 13 * nodeScale };
  // Lines already running straight down a column into a card (behind other cards):
  // links from other columns join them (2026-11-23, client).
  const trunks = trunksByTarget(
    seriesEdges.flatMap((e) => {
      const from = boxById.get(e.dependsOnTaskId);
      const to = boxById.get(e.taskId);
      return from && to ? [{ from, to }] : [];
    }),
    boxes
  );
  const route = (fromId: string, toId: string) =>
    routeEdge(boxById.get(fromId)!, boxById.get(toId)!, boxes, gaps, avoidZones, trunks.get(toId) ?? []);

  const seriesLines = seriesEdges
    .map((e) => {
      const from = byId.get(e.dependsOnTaskId); // prerequisite
      const to = byId.get(e.taskId); // blocked task
      if (!from || !to) return null;
      const r = route(from.id, to.id);
      const run = longestRun(r);
      return { edge: e, route: r, from: run.from, to: run.to, warning: e.soft || e.noWarning ? null : linkDateWarning(e.type, from, to) };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
  const labelPos = showLabels
    ? placeLabels(seriesLines.filter((l) => !l.edge.hideLabel).map((l) => ({ id: l.edge.id, from: l.from, to: l.to })), nodeScale)
    : new Map();

  const parallelLines = parallelEdges
    .map((e) => {
      const a = byId.get(e.taskAId);
      const b = byId.get(e.taskBId);
      if (!a || !b) return null;
      const r = route(a.id, b.id);
      const run = longestRun(r);
      return { edge: e, route: r, from: run.from, to: run.to };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return (
    <>
      <Svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}>
        {seriesLines.map(({ edge, route: r }) => {
          const style = LINK_STYLE[edge.type];
          if (edge.soft && !edge.drawAsLink) {
            // Soft link: thin dashed line (grey unless coloured), reference only.
            return <Polyline key={edge.id} points={pts(r)} fill="none" stroke={edge.color ?? SOFT_LINK_COLOR} strokeWidth={edge.color ? 2 : 1.5} strokeDasharray="6,4" />;
          }
          if (style.double) {
            // SS: two parallel lines, 2.5px either side of the route.
            return [1, -1].map((k) => (
              <Polyline key={`${edge.id}-${k}`} points={pts(offsetRoute(r, 2.5 * nodeScale * k))} fill="none" stroke={LINK_COLOR} strokeWidth={1.5} strokeLinejoin="miter" />
            ));
          }
          return (
            <Polyline
              key={edge.id}
              points={pts(r)}
              fill="none"
              stroke={LINK_COLOR}
              strokeWidth={style.cap === 'round' ? 3 : 2}
              strokeDasharray={style.dash}
              strokeLinecap={style.cap ?? 'butt'}
              strokeLinejoin="miter"
            />
          );
        })}
        {seriesLines.map(({ edge, route: r }) => (
          <Polygon key={`arrow-${edge.id}`} points={arrowheadPoints(r, nodeScale)} fill={edge.soft && !edge.drawAsLink ? (edge.color ?? SOFT_LINK_COLOR) : LINK_COLOR} />
        ))}
        {parallelLines.map(({ edge, route: r }) => (
          <Polyline key={edge.id} points={pts(r)} fill="none" stroke={PARALLEL_EDGE_COLOR} strokeWidth={2} strokeDasharray="6,5" />
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
        const looksSoft = edge.soft && !edge.drawAsLink;
        const tint = warning ? LINK_WARNING_COLOR : looksSoft ? SOFT_LINK_COLOR : LINK_COLOR;
        const style = {
          position: 'absolute' as const,
          left: looksSoft ? pos.left - LABEL_W * 0.35 * nodeScale : pos.left,
          top: pos.top,
          width: LABEL_W * (looksSoft ? 1.7 : 1) * nodeScale,
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
              {warning ? `${edge.type}!` : looksSoft ? `${edge.type} soft` : edge.type}
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
