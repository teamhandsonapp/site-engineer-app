import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { PieChartDatum } from './types';

interface PieChartProps {
  data: PieChartDatum[]; // include zero-value entries too — they still show in the legend
  size?: number;
  valueFormatter?: (v: number) => string;
  emptyLabel?: string;
}

// Full (non-donut) wedge pie, for Task Report's status-breakdown parameter.
// Starts at 12 o'clock (angle = -90deg), same convention as ProgressRing.
export function PieChart({ data, size = 120, valueFormatter = (v) => String(v), emptyLabel = 'No data available' }: PieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const nonZero = data.filter((d) => d.value > 0);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  return (
    <View className="flex-row items-center gap-4">
      {total === 0 ? (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text className="text-2xs text-neutral-400 text-center">{emptyLabel}</Text>
        </View>
      ) : nonZero.length === 1 ? (
        // A single 360deg wedge can't be drawn as one arc path (its start and
        // end point coincide) — a plain filled circle is the correct
        // degenerate case, not a special-cased arc.
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={r} fill={nonZero[0].color} />
        </Svg>
      ) : (
        <Svg width={size} height={size}>
          {(() => {
            let angle = -Math.PI / 2;
            return nonZero.map((d) => {
              const sweep = (d.value / total) * 2 * Math.PI;
              const end = angle + sweep;
              const x1 = cx + r * Math.cos(angle);
              const y1 = cy + r * Math.sin(angle);
              const x2 = cx + r * Math.cos(end);
              const y2 = cy + r * Math.sin(end);
              const largeArc = sweep > Math.PI ? 1 : 0;
              const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
              angle = end;
              return <Path key={d.key} d={path} fill={d.color} />;
            });
          })()}
        </Svg>
      )}

      <View className="flex-1 gap-1.5">
        {data.map((d) => (
          <View key={d.key} className="flex-row items-center gap-2">
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: d.color }} />
            <Text className="text-xs text-neutral-600 flex-1" numberOfLines={1}>
              {d.label}
            </Text>
            <Text className="text-xs font-semibold text-neutral-700">
              {valueFormatter(d.value)}
              {total > 0 ? ` (${Math.round((d.value / total) * 100)}%)` : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
