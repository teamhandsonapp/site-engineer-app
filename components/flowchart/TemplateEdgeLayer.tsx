import { View, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Line, Polygon } from 'react-native-svg';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import type { DependencyType } from '../../lib/flowchart/types';
import type { PositionedTemplateTask, TemplateParallelEdge, TemplateSeriesEdge } from '../../lib/flowchart/templateTypes';

// A direct sibling of EdgeLayer.tsx (real flowchart) — same colors, same
// badge-hidden-while-locked fix, same horizontal badge offset math, applied
// to TemplateSeriesEdge/TemplateParallelEdge instead of the real edge types.
//
// Each of the 4 series types now gets its OWN line style, not just a text
// badge — a plain solid line for every type (only distinguishable by a
// badge visible while editing) failed the "each type visually
// distinguishable" ask, and a line with no arrowhead at all never showed
// direction for ANY type. Stays within the existing solid-orange family
// (extends it, per explicit request, rather than inventing an unrelated
// new style) — FS keeps the original plain solid line as the default/most
// common case, the other 3 each get a distinct dash rhythm plus a slightly
// deeper shade so they don't read as "the same line, badge just says
// otherwise" at a glance or when zoomed out past badge-legible size.
const PARALLEL_EDGE_COLOR = '#2563EB';
const SERIES_BADGE_X_OFFSET = 34;
const SERIES_TYPE_STYLE: Record<DependencyType, { color: string; dash?: string }> = {
  FS: { color: '#F0A227' },
  SS: { color: '#F0A227', dash: '5,4' },
  FF: { color: '#C2660B', dash: '2,3' },
  SF: { color: '#B45309', dash: '8,3,2,3' },
};

// See EdgeLayer.tsx's identical center() for why nodeScale is required here.
function center(t: PositionedTemplateTask, nodeScale: number) {
  return { x: t.x + (NODE_WIDTH * nodeScale) / 2, y: t.y + (NODE_HEIGHT * nodeScale) / 2 };
}

// A series edge is directional (X blocks/gates Y), so it needs a visible
// arrowhead — plain <Line>s never showed direction at all before. The
// naive tip position (the target box's exact center) would render
// completely hidden behind that box (task nodes draw ON TOP of this
// layer), so the tip is pulled back to where the incoming line would
// exit the target's own rectangle, via a standard ray/axis-aligned-box
// intersection — not just a fixed pullback distance, which would either
// overshoot on a near-horizontal edge or undershoot on a near-vertical one
// given the box is wide (195) but short (92), a ~2:1 aspect ratio.
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

function EdgeBadge({ onPress, style, children }: { onPress: () => void; style: object; children: React.ReactNode }) {
  const tap = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(onPress)();
  });
  return (
    <GestureDetector gesture={tap}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}

export function TemplateEdgeLayer({
  tasks,
  seriesEdges,
  parallelEdges,
  onEdgePress,
  nodeScale,
}: {
  tasks: PositionedTemplateTask[];
  seriesEdges: TemplateSeriesEdge[];
  parallelEdges: TemplateParallelEdge[];
  onEdgePress?: (edgeId: string, kind: 'series' | 'parallel') => void;
  nodeScale: number;
}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const seriesLines = seriesEdges
    .map((e) => {
      const from = byId.get(e.dependsOnTaskId);
      const to = byId.get(e.taskId);
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
          <Line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={PARALLEL_EDGE_COLOR} strokeWidth={2} strokeDasharray="6,5" />
        ))}
      </Svg>

      {/* Type badge — only rendered when unlocked (real feedback on the real
          flowchart: the label read as pure clutter while just viewing, and
          only matters as a delete tap-target while editing — see
          EdgeLayer.tsx's own comment). */}
      {onEdgePress && seriesLines.map(({ edge, from, to }) => {
        const style = {
          position: 'absolute' as const,
          left: (from.x + to.x) / 2 - 14 + SERIES_BADGE_X_OFFSET,
          top: (from.y + to.y) / 2 - 12,
          minWidth: 28,
          alignItems: 'center' as const,
        };
        return (
          <EdgeBadge key={`badge-${edge.id}`} onPress={() => onEdgePress(edge.id, 'series')} style={style}>
            <View className="bg-white rounded px-1.5 py-0.5" style={{ borderWidth: 1.5, borderColor: SERIES_TYPE_STYLE[edge.type].color }}>
              <Text className="text-2xs font-bold text-neutral-700">{edge.type}</Text>
            </View>
          </EdgeBadge>
        );
      })}

      {onEdgePress && parallelLines.map(({ edge, from, to }) => {
        const style = {
          position: 'absolute' as const,
          left: (from.x + to.x) / 2 - 12,
          top: (from.y + to.y) / 2 - 10,
          minWidth: 24,
          alignItems: 'center' as const,
        };
        return (
          <EdgeBadge key={`pbadge-${edge.id}`} onPress={() => onEdgePress(edge.id, 'parallel')} style={style}>
            <View className="bg-white border border-blue-200 rounded-full px-1.5 py-0.5">
              <Text className="text-2xs font-bold text-blue-600">∥</Text>
            </View>
          </EdgeBadge>
        );
      })}
    </>
  );
}
