import { useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import type { BarChartCategory, BarChartSeries } from './types';

// One flexible bar-chart primitive covering every bar-chart use site across
// Task Report and Weekly Report — vertical/grouped (daily activity,
// quantity of work, procurement alerts), horizontal/stacked (completion by
// department), and horizontal/grouped (average delay by Work). Deliberately
// does NOT support vertical/stacked — unused by any of the 12 parameters,
// so that combination isn't implemented (an unverifiable code path is worse
// than a narrower, fully-exercised one).
//
// Bars are plain <Rect>s inside one <Svg> per chart (vertical mode) or per
// row (horizontal mode); labels are absolutely-positioned RN <Text>, not
// <SvgText> — matches EdgeLayer.tsx's own established "Svg for shapes, plain
// Text overlay for labels" split rather than fighting SVG's font handling.
interface BarChartProps {
  orientation: 'vertical' | 'horizontal';
  mode: 'grouped' | 'stacked';
  series: BarChartSeries[];
  categories: BarChartCategory[];
  valueFormatter?: (value: number) => string;
  categoryValueLabel?: (cat: BarChartCategory) => string;
  showLegend?: boolean;
  chartHeight?: number;
  rowHeight?: number;
  emptyLabel?: string;
}

const TRACK_COLOR = '#E5E7EB';
const GRID_COLOR = '#F3F4F6';

function seriesTotal(cat: BarChartCategory, series: BarChartSeries[]): number {
  return series.reduce((sum, s) => sum + (cat.values[s.key] ?? 0), 0);
}

function colorFor(cat: BarChartCategory, s: BarChartSeries): string {
  return cat.colors?.[s.key] ?? s.color;
}

function Legend({ series }: { series: BarChartSeries[] }) {
  if (series.length <= 1) return null;
  return (
    <View className="flex-row flex-wrap gap-3 mt-2.5">
      {series.map((s) => (
        <View key={s.key} className="flex-row items-center gap-1.5">
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: s.color }} />
          <Text className="text-2xs text-neutral-500">{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

function VerticalGrouped({
  series,
  categories,
  chartHeight,
  valueFormatter,
}: {
  series: BarChartSeries[];
  categories: BarChartCategory[];
  chartHeight: number;
  valueFormatter: (v: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const maxValue = Math.max(1, ...categories.flatMap((c) => series.map((s) => c.values[s.key] ?? 0)));
  const effectiveMax = maxValue * 1.15;

  const groupGap = 10;
  const groupWidth = width > 0 ? (width - groupGap * (categories.length + 1)) / categories.length : 0;
  const barGap = 4;
  const rawBarWidth = series.length > 0 ? (groupWidth - barGap * (series.length - 1)) / series.length : groupWidth;
  const barWidth = Math.max(4, Math.min(28, rawBarWidth));
  const groupContentWidth = barWidth * series.length + barGap * (series.length - 1);
  const groupOffsetX = Math.max(0, (groupWidth - groupContentWidth) / 2);

  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <View style={{ height: chartHeight + 14 }}>
          <Svg width={width} height={chartHeight} style={{ position: 'absolute', left: 0, top: 0 }}>
            <Line x1={0} y1={chartHeight} x2={width} y2={chartHeight} stroke={GRID_COLOR} strokeWidth={1} />
            {categories.map((cat, catIndex) => {
              const groupX = groupGap + catIndex * (groupWidth + groupGap);
              return series.map((s, sIndex) => {
                const value = cat.values[s.key] ?? 0;
                const barHeight = (value / effectiveMax) * chartHeight;
                const x = groupX + groupOffsetX + sIndex * (barWidth + barGap);
                return (
                  <Rect
                    key={`${cat.key}-${s.key}`}
                    x={x}
                    y={chartHeight - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx={2}
                    fill={colorFor(cat, s)}
                  />
                );
              });
            })}
          </Svg>
          {series.length === 1 &&
            categories.map((cat, catIndex) => {
              const groupX = groupGap + catIndex * (groupWidth + groupGap);
              const value = cat.values[series[0].key] ?? 0;
              return (
                <Text
                  key={`label-${cat.key}`}
                  numberOfLines={1}
                  style={{ position: 'absolute', left: groupX, top: 0, width: groupWidth, textAlign: 'center', fontSize: 10, color: '#374151', fontWeight: '700' }}
                >
                  {value > 0 ? valueFormatter(value) : ''}
                </Text>
              );
            })}
        </View>
      )}
      <View className="flex-row" style={{ paddingHorizontal: groupGap / 2 }}>
        {categories.map((cat) => (
          <Text key={`cat-${cat.key}`} numberOfLines={1} className="text-2xs text-neutral-400 text-center" style={{ flex: 1 }}>
            {cat.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function HorizontalRows({
  mode,
  series,
  categories,
  rowHeight,
  categoryValueLabel,
  valueFormatter,
}: {
  mode: 'grouped' | 'stacked';
  series: BarChartSeries[];
  categories: BarChartCategory[];
  rowHeight: number;
  categoryValueLabel?: (cat: BarChartCategory) => string;
  valueFormatter: (v: number) => string;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  // Shared scale across every row (not normalized-per-row) — matches
  // admin-web's own recharts numeric X-axis, which auto-scales once across
  // all bars rather than stretching each row's bar to its own 100%.
  const rowMax = (cat: BarChartCategory) => (mode === 'stacked' ? seriesTotal(cat, series) : Math.max(...series.map((s) => cat.values[s.key] ?? 0)));
  const maxValue = Math.max(1, ...categories.map(rowMax));
  const effectiveMax = maxValue * 1.15;

  const labelColumnWidth = 96;
  const valueColumnWidth = 56;

  return (
    <View>
      {categories.map((cat) => {
        const total = seriesTotal(cat, series);
        const label = categoryValueLabel ? categoryValueLabel(cat) : valueFormatter(mode === 'stacked' ? total : (cat.values[series[0]?.key ?? ''] ?? 0));
        return (
          <View key={cat.key} className="flex-row items-center" style={{ marginBottom: 10 }}>
            <Text numberOfLines={1} className="text-xs text-neutral-600" style={{ width: labelColumnWidth }}>
              {cat.label}
            </Text>
            <View style={{ flex: 1, height: rowHeight }} onLayout={trackWidth === 0 ? onLayout : undefined}>
              {trackWidth > 0 &&
                (total === 0 ? (
                  <View style={{ height: rowHeight, justifyContent: 'center' }}>
                    <Text className="text-2xs text-neutral-300">—</Text>
                  </View>
                ) : mode === 'stacked' ? (
                  <Svg width={trackWidth} height={rowHeight}>
                    <Rect x={0} y={0} width={trackWidth} height={rowHeight} rx={4} fill={TRACK_COLOR} opacity={0.4} />
                    {(() => {
                      let offset = 0;
                      return series.map((s) => {
                        const value = cat.values[s.key] ?? 0;
                        const segWidth = (value / effectiveMax) * trackWidth;
                        const rect = <Rect key={s.key} x={offset} y={0} width={segWidth} height={rowHeight} fill={colorFor(cat, s)} />;
                        offset += segWidth;
                        return rect;
                      });
                    })()}
                  </Svg>
                ) : (
                  <Svg width={trackWidth} height={rowHeight}>
                    <Rect x={0} y={0} width={trackWidth} height={rowHeight} rx={4} fill={TRACK_COLOR} opacity={0.4} />
                    {series.map((s, sIndex) => {
                      const value = cat.values[s.key] ?? 0;
                      const segWidth = Math.max(0, (value / effectiveMax) * trackWidth);
                      const subHeight = rowHeight / series.length;
                      return (
                        <Rect
                          key={s.key}
                          x={0}
                          y={sIndex * subHeight}
                          width={segWidth}
                          height={subHeight}
                          rx={3}
                          fill={colorFor(cat, s)}
                        />
                      );
                    })}
                  </Svg>
                ))}
            </View>
            <Text className="text-xs font-semibold text-neutral-700" style={{ width: valueColumnWidth, textAlign: 'right' }}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function BarChart({
  orientation,
  mode,
  series,
  categories,
  valueFormatter = (v) => String(v),
  categoryValueLabel,
  showLegend,
  chartHeight = 140,
  rowHeight = 22,
  emptyLabel = 'No data available',
}: BarChartProps) {
  const hasData = categories.length > 0 && categories.some((c) => seriesTotal(c, series) > 0);
  const legend = showLegend ?? series.length > 1;

  if (categories.length === 0) {
    return (
      <View className="items-center justify-center py-6">
        <Text className="text-xs text-neutral-400">{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <View>
      {orientation === 'vertical' ? (
        <VerticalGrouped series={series} categories={categories} chartHeight={chartHeight} valueFormatter={valueFormatter} />
      ) : (
        <HorizontalRows
          mode={mode}
          series={series}
          categories={categories}
          rowHeight={rowHeight}
          categoryValueLabel={categoryValueLabel}
          valueFormatter={valueFormatter}
        />
      )}
      {legend && hasData && <Legend series={series} />}
    </View>
  );
}
