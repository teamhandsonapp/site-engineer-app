import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatCardDate } from '../../lib/flowchart/delay';
import { computePhaseCompletions } from '../../lib/flowchart/phaseCompletion';
import { CANVAS_THEMES, type CanvasTheme } from './GridBackground';
import type { FlowchartSeriesEdge, FlowchartTask } from '../../lib/flowchart/types';

// Mobile equivalent of admin-web's own per-phase "Expected completion date"
// badges (TaskDependencyGraph.tsx) — same computePhaseCompletions logic,
// same red/warning pill treatment, just laid out as an in-flow header row
// above the canvas instead of an absolute overlay on top of it (mobile's
// canvas already has toolbar chrome pinned to both top corners; a
// screen-width phase badge competing for that same strip risks overlapping
// them on a narrow device, unlike admin-web's much roomier desktop layout).
export function PhaseCompletionBar({
  tasks,
  seriesEdges,
  theme = 'light',
}: {
  tasks: FlowchartTask[];
  seriesEdges: FlowchartSeriesEdge[];
  // Only the OUTER background follows the canvas theme — the warning chip
  // itself keeps its own red/pink treatment regardless (a status color, not
  // decor, same as e.g. a battery-low indicator staying red in dark mode).
  theme?: CanvasTheme;
}) {
  const phases = computePhaseCompletions(tasks, seriesEdges);
  if (phases.length === 0) return null;

  return (
    <View className="flex-row flex-wrap gap-2 px-3 pt-3 pb-1" style={{ backgroundColor: CANVAS_THEMES[theme].bg }}>
      {phases.map((phase) => (
        <View
          key={phase.label}
          className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg border"
          style={{ borderColor: '#FECACA', backgroundColor: '#FEF2F2' }}
        >
          <Ionicons name="warning-outline" size={13} color="#B91C1C" />
          <Text className="text-xs font-semibold" style={{ color: '#B91C1C' }}>
            Expected {phase.label} completion: {formatCardDate(phase.projectedCompletion)}
          </Text>
        </View>
      ))}
    </View>
  );
}
