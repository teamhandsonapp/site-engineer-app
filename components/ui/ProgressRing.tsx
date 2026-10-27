import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

// A compact circular progress indicator — built for App Home's project list
// (Part 5), where a thin linear bar read as too small/quiet to anchor an
// entire row's hierarchy. Rotated -90deg so progress starts at 12 o'clock
// (SVG's own 0deg is 3 o'clock) — the standard progress-ring convention.
export function ProgressRing({
  percent,
  size = 46,
  strokeWidth = 4,
  color = '#F0A227',
  trackColor = '#F1F1F2',
  label,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  // Overrides the default "{percent}%" text inside the ring — e.g. a real
  // "4/5" fraction where the count matters more than the rounded percentage.
  label?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const offset = circumference * (1 - clamped / 100);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        {clamped > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        )}
      </Svg>
      <Text className="text-xs font-extrabold text-neutral-800">{label ?? `${clamped}%`}</Text>
    </View>
  );
}
