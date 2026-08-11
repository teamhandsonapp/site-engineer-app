import { View, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import type { PositionedTemplateTask, TemplateParallelEdge, TemplateSeriesEdge } from '../../lib/flowchart/templateTypes';

// A direct sibling of EdgeLayer.tsx (real flowchart) — same colors, same
// badge-hidden-while-locked fix, same horizontal badge offset math, applied
// to TemplateSeriesEdge/TemplateParallelEdge instead of the real edge types.
const SERIES_EDGE_COLOR = '#F0A227';
const PARALLEL_EDGE_COLOR = '#2563EB';
const SERIES_BADGE_X_OFFSET = 34;

// See EdgeLayer.tsx's identical center() for why nodeScale is required here.
function center(t: PositionedTemplateTask, nodeScale: number) {
  return { x: t.x + (NODE_WIDTH * nodeScale) / 2, y: t.y + (NODE_HEIGHT * nodeScale) / 2 };
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
        {seriesLines.map(({ edge, from, to }) => (
          <Line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={SERIES_EDGE_COLOR} strokeWidth={2} />
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
            <View className="bg-white border border-neutral-300 rounded px-1.5 py-0.5">
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
