import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

// Native equivalent of admin-web's CSS `repeating-linear-gradient(45deg,
// #DC2626, #DC2626 4px, #FCA5A5 4px, #FCA5A5 8px)` (GanttTaskBars.tsx's
// DELAY_STRIPE_BG) — a plain View's `backgroundImage` only works on
// react-native-web, not on a real iOS/Android build, so the "behind plan"
// hatch has to be real SVG here: an 8x8 tile pattern (4px dark, 4px light),
// rotated 45deg, tiled to fill the segment. Same colors/widths as the real
// bar constant (not the visually-mismatched 2px/4px swatch admin-web's own
// legend happens to use) so this component doubles as both the legend
// swatch and the real bar segment.
export function HatchStripe({ width, height, borderRadius = 2 }: { width: number; height: number; borderRadius?: number }) {
  return (
    <Svg width={width} height={height} style={{ borderRadius, overflow: 'hidden' }}>
      <Defs>
        <Pattern id="delayHatch" patternUnits="userSpaceOnUse" width={8} height={8} patternTransform="rotate(45)">
          <Rect x={0} y={0} width={8} height={8} fill="#FCA5A5" />
          <Rect x={0} y={0} width={4} height={8} fill="#DC2626" />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#delayHatch)" />
    </Svg>
  );
}
