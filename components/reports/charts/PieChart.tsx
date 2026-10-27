import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { PieChartDatum } from './types';

interface PieChartProps {
  data: PieChartDatum[]; // include zero-value entries too — they still show in the legend
  size?: number;
  valueFormatter?: (v: number) => string;
  emptyLabel?: string;
  // Punches a white center hole for the donut look (assumes a white card
  // background, true everywhere this chart is currently used) — off by
  // default so existing full-wedge call sites (Task Report's status
  // breakdown) are unaffected.
  donut?: boolean;
  // Compact dashboard cards are too narrow for a side legend — off hides it
  // and centers the ring alone; on (default) keeps the existing layout.
  showLegend?: boolean;
  // Overlays each slice's own percentage just outside the ring, near that
  // slice's own color, instead of (or alongside) a side legend — by
  // explicit request, so "which number goes with which color" doesn't
  // require glancing away from the chart.
  sliceLabels?: boolean;
}

// Full (non-donut) wedge pie, for Task Report's status-breakdown parameter.
// Starts at 12 o'clock (angle = -90deg), same convention as ProgressRing.
export function PieChart({
  data,
  size = 120,
  valueFormatter = (v) => String(v),
  emptyLabel = 'No data available',
  donut = false,
  showLegend = true,
  sliceLabels = false,
}: PieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const nonZero = data.filter((d) => d.value > 0);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  // Just past the ring's own outer edge, not on top of it — by explicit
  // request. The wrapping box below reserves this much extra room on every
  // side so an outside label never gets clipped or collides with a sibling
  // (e.g. the side legend) sitting right next to the chart. Labels sit at
  // labelR = r + 17, i.e. ~15px past the size/2 edge — 18 is the smallest
  // pad that still clears that with a little breathing room, down from 28
  // (which was reserving far more space than the labels actually need,
  // reading as excess gap above/below the chart wherever it's used).
  const OUTSIDE_LABEL_PAD = 18;
  const labelR = r + 17;
  const outerSize = size + (sliceLabels ? OUTSIDE_LABEL_PAD * 2 : 0);

  return (
    <View className={showLegend ? 'flex-row items-center gap-4' : 'items-center'}>
      {total === 0 ? (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text className="text-2xs text-neutral-400 text-center">{emptyLabel}</Text>
        </View>
      ) : (
        <View style={{ width: outerSize, height: outerSize, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: size, height: size }}>
            {nonZero.length === 1 ? (
              // A single 360deg wedge can't be drawn as one arc path (its
              // start and end point coincide) — a plain filled circle is the
              // correct degenerate case, not a special-cased arc.
              <Svg width={size} height={size}>
                <Circle cx={cx} cy={cy} r={r} fill={nonZero[0].color} />
                {donut && <Circle cx={cx} cy={cy} r={r * 0.55} fill="#fff" />}
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
                {donut && <Circle cx={cx} cy={cy} r={r * 0.55} fill="#fff" />}
              </Svg>
            )}
            {sliceLabels &&
              (() => {
                let angle = -Math.PI / 2;
                return nonZero.map((d) => {
                  const sweep = (d.value / total) * 2 * Math.PI;
                  const mid = angle + sweep / 2;
                  angle += sweep;
                  const percent = Math.round((d.value / total) * 100);
                  const x = cx + labelR * Math.cos(mid);
                  const y = cy + labelR * Math.sin(mid);
                  return (
                    <View
                      key={`label-${d.key}`}
                      pointerEvents="none"
                      style={{ position: 'absolute', left: x - 20, top: y - 7, width: 40, alignItems: 'center' }}
                    >
                      <Text
                        style={{
                          fontSize: 9,
                          fontWeight: '800',
                          color: '#000',
                        }}
                      >
                        {percent}%
                      </Text>
                    </View>
                  );
                });
              })()}
          </View>
        </View>
      )}

      {showLegend && (
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
      )}
    </View>
  );
}
