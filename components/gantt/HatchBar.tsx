import { View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

// Hatched Gantt bar (2026-11-14): diagonal lines in `color` over a light
// `fill`, with a `color` outline. Drawn as individual <Line>s rather than a
// tiled <Pattern> fill — Pattern is unreliable on some Android/Hermes builds
// (see components/flowchart/GridBackground.tsx), and a bar is short enough
// that a few dozen lines is cheap.

export const HATCH = {
  planned: { color: '#111827', fill: '#F3F4F6' }, // black
  actual: { color: '#DC2626', fill: '#FEF2F2' }, // red
  delay: { color: '#DC2626', fill: '#DC2626' }, // solid red: actual days past the planned finish
} as const;

const GAP = 5;

export function HatchBar({
  left,
  top,
  width,
  height,
  color,
  fill,
  solid = false,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  fill: string;
  /** Plain filled bar, no hatching (the delay part). */
  solid?: boolean;
}) {
  const w = Math.max(width, 2);
  const lines: number[] = [];
  if (!solid) for (let x = -height; x < w; x += GAP) lines.push(x);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left, top, width: w, height, overflow: 'hidden' }}>
      <Svg width={w} height={height}>
        <Rect x={0} y={0} width={w} height={height} fill={fill} />
        {lines.map((x) => (
          <Line key={x} x1={x} y1={height} x2={x + height} y2={0} stroke={color} strokeWidth={1.4} />
        ))}
        <Rect x={0.75} y={0.75} width={w - 1.5} height={height - 1.5} fill="none" stroke={color} strokeWidth={1.5} />
      </Svg>
    </View>
  );
}
