import { Text, View } from 'react-native';
import { STATUS_COLOR_PALETTE } from '../../../lib/statusColors';
import { formatDateLabel } from '../../../lib/reports/dateRange';
import type { TaskDelayInfo } from '../../../lib/reports/taskReport';

// Deliberately NOT react-native-svg — mirrors admin-web's own DelayComparison
// component, which hand-rolls this one chart with plain <div>s rather than
// recharts too (two horizontal segments need no arcs, plain Views suffice).
interface DelayComparisonChartProps {
  delay: TaskDelayInfo;
}

function toTimeUtc(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getTime();
}

export function DelayComparisonChart({ delay }: DelayComparisonChartProps) {
  const { plannedStart, plannedEnd, actualOrProjectedStart, actualOrProjectedEnd, hasActualEnd, totalDelayDays, source, causedByTaskCode, causedByTaskName } = delay;

  const allDates = [plannedStart, plannedEnd, actualOrProjectedStart, actualOrProjectedEnd].filter((d): d is string => d !== null);

  if (allDates.length === 0) {
    return (
      <View className="items-center justify-center py-6">
        <Text className="text-xs text-neutral-400">Not scheduled yet</Text>
      </View>
    );
  }

  const timelineStart = Math.min(...allDates.map(toTimeUtc));
  const timelineEnd = Math.max(...allDates.map(toTimeUtc), timelineStart + 86_400_000);
  const span = timelineEnd - timelineStart;

  function barStyle(startKey: string | null, endKey: string | null) {
    if (!startKey || !endKey) return null;
    const leftPct = ((toTimeUtc(startKey) - timelineStart) / span) * 100;
    const rightRawPct = ((toTimeUtc(endKey) - timelineStart) / span) * 100;
    const widthPct = Math.max(1.5, rightRawPct - leftPct);
    return { left: `${leftPct}%` as const, width: `${widthPct}%` as const };
  }

  const isDelayed = totalDelayDays > 0;
  const barColor = isDelayed ? STATUS_COLOR_PALETTE.red.dot : STATUS_COLOR_PALETTE.green.dot;
  const bannerPalette = isDelayed ? STATUS_COLOR_PALETTE.red : STATUS_COLOR_PALETTE.green;
  const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

  let bannerText: string;
  if (!isDelayed) {
    bannerText = 'On schedule';
  } else if (source === 'own') {
    bannerText = `Delayed by ${dayWord(totalDelayDays)} — this task's own actual completion ran past its due date.`;
  } else if (causedByTaskName) {
    bannerText = `Delayed by ${dayWord(totalDelayDays)} — inherited from upstream task ${causedByTaskCode ? `${causedByTaskCode} — ` : ''}${causedByTaskName}.`;
  } else {
    bannerText = `Delayed by ${dayWord(totalDelayDays)} — upstream delay, cause not identified.`;
  }

  const plannedBar = barStyle(plannedStart, plannedEnd);
  const actualBar = barStyle(actualOrProjectedStart, actualOrProjectedEnd);

  return (
    <View>
      <View className="mb-3">
        <Text className="text-2xs font-semibold text-neutral-400 mb-1">Planned</Text>
        <View style={{ height: 20, borderRadius: 6, backgroundColor: '#F3F4F6', overflow: 'hidden' }}>
          {plannedBar && <View style={[{ position: 'absolute', top: 0, bottom: 0, borderRadius: 6, backgroundColor: '#9CA3AF' }, plannedBar]} />}
        </View>
        <Text className="text-2xs text-neutral-400 mt-1">
          {formatDateLabel(plannedStart)} – {formatDateLabel(plannedEnd)}
        </Text>
      </View>

      <View className="mb-3">
        <Text className="text-2xs font-semibold text-neutral-400 mb-1">{hasActualEnd ? 'Actual' : 'Projected'}</Text>
        <View style={{ height: 20, borderRadius: 6, backgroundColor: '#F3F4F6', overflow: 'hidden' }}>
          {actualBar && <View style={[{ position: 'absolute', top: 0, bottom: 0, borderRadius: 6, backgroundColor: barColor }, actualBar]} />}
        </View>
        <Text className="text-2xs text-neutral-400 mt-1">
          {formatDateLabel(actualOrProjectedStart)} – {formatDateLabel(actualOrProjectedEnd)}
        </Text>
      </View>

      <View className="rounded-xl px-3 py-2.5" style={{ backgroundColor: bannerPalette.bg, borderWidth: 1, borderColor: bannerPalette.border }}>
        <Text className="text-xs font-semibold" style={{ color: bannerPalette.text }}>
          {bannerText}
        </Text>
      </View>
    </View>
  );
}
