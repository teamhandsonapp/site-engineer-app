import { PixelRatio, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

export type CanvasTheme = 'light' | 'black';

// Originally shipped as light/dark/black (dark being an exact match of
// admin-web's own CANVAS_THEMES.dark, #0a0a0a) — real feedback on the actual
// picker was that the dark and black swatch circles read as "two black
// options" at that small size, indistinguishable from each other, so dark
// was dropped rather than kept as a redundant third choice. black is a
// genuinely pure #000000 canvas; light is admin-web's own CANVAS_THEMES.light
// values verbatim.
export const CANVAS_THEMES: Record<CanvasTheme, { bg: string; grid: string; gridMajor: string }> = {
  light: { bg: '#ffffff', grid: '#f5f5f6', gridMajor: '#ececee' },
  black: { bg: '#000000', grid: '#141414', gridMajor: '#242424' },
};

// Android's react-native-svg draws each <Svg> into ONE bitmap the size of
// the view (width x height x pixelRatio^2 x 4 bytes), and Android kills the
// app natively ("Canvas: trying to draw too large bitmap", ~100MB) if it is
// bigger — no JS error, no error boundary, the app just closes. This grid is
// (viewport / zoom) x 5 in size, so at zoom 1 on a typical phone it's
// already ~175MB, and ~4GB at the 0.2 pinch minimum. Keep the grid's own
// bitmap under this budget (EdgeLayer has its own 60MB budget via
// clampToSafeBitmapBudget), downsampling or skipping lines as needed.
const GRID_BITMAP_BUDGET_BYTES = 16 * 1024 * 1024;
// Above this downsample factor the lines get too blurry to be worth it — draw
// the plain background colour instead.
const MAX_GRID_DOWNSAMPLE = 6;

const MINOR_SPACING = 20;
const MAJOR_SPACING = 100;

// Positive-safe modulo (JS's own % can return negative results for a
// negative left-hand side, e.g. -137 % 20 === -17, not 3).
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

// Rendered as an SVG layer INSIDE the same transformed content Animated.View
// the task nodes/edges live in, so it pans/zooms together with the graph in
// perfect sync, exactly like React Flow's own Background does.
//
// offsetX/offsetY position this rect (which does NOT need to start at the
// content layer's own (0,0) — see FlowchartCanvas/TemplateCanvas's own
// recomputeGridArea, which recenters this rect on wherever the viewport
// currently is every time a pan/pinch gesture settles, so the grid always
// extends generously beyond the visible area in every direction instead of
// being sized to the task bounds and visibly cutting off once you pan far
// enough past them). Line positions are snapped to ONE fixed global grid
// (multiples of MINOR_SPACING/MAJOR_SPACING from true content-space 0,0),
// not to this rect's own local origin — without that, every recenter would
// visibly "jump" the pattern by (offset mod spacing) instead of looking
// perfectly continuous.
//
// Drawn as individually-positioned <Line> elements, NOT a tiled <Pattern>
// fill — a Pattern-based version was tried first (smaller SVG tree, matches
// how React Flow's own Background works internally) but rendered as a
// completely blank canvas on a real device with no error, a known rough
// edge in react-native-svg's Pattern support on some Android/Hermes
// combinations. Explicit lines have no such platform dependency; the
// element count here (a few hundred to low thousands depending on current
// zoom) is small enough not to matter.
export function GridBackground({
  offsetX = 0,
  offsetY = 0,
  width,
  height,
  theme = 'light',
  scale = 1,
}: {
  offsetX?: number;
  offsetY?: number;
  width: number;
  height: number;
  theme?: CanvasTheme;
  // Current canvas zoom — this content-space rect (see computeGridArea)
  // grows as (viewport / scale), so zooming OUT makes it cover far more
  // content-space area without the line SPACING changing on its own,
  // which is what let the element count reach 1,000+ at the lowest zoom
  // (0.2, the clamp in FlowchartCanvas/TemplateCanvas's pinch handler) —
  // exactly the workload most likely to strain a weaker device (see this
  // file's own comment on the Pattern-fill attempt that already broke
  // differently on a real device). Spacing is only ever widened, never
  // narrowed below the scale=1 baseline, so normal zoom levels render
  // identically to before this existed.
  scale?: number;
}) {
  const colors = CANVAS_THEMES[theme];

  // Bitmap budget (see GRID_BITMAP_BUDGET_BYTES). k = how much smaller the
  // Svg's real bitmap is drawn, then scaled back up to the same on-screen
  // size with a view transform. k = 1 (identical to before) whenever the
  // grid already fits the budget.
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const ratio = PixelRatio.get();
  const bitmapBytes = safeWidth * safeHeight * ratio * ratio * 4;
  const k = bitmapBytes > GRID_BITMAP_BUDGET_BYTES ? Math.sqrt(bitmapBytes / GRID_BITMAP_BUDGET_BYTES) : 1;

  // Zero / negative / NaN / Infinity size (e.g. zoom 0 during the first
  // layout) would make the line loops below run forever — draw nothing.
  if (safeWidth === 0 || safeHeight === 0) return null;

  if (k > MAX_GRID_DOWNSAMPLE) {
    return <View style={{ position: 'absolute', left: offsetX, top: offsetY, width: safeWidth, height: safeHeight, backgroundColor: colors.bg }} />;
  }

  const gridScale = Math.min(1, Math.max(scale, 0.05));
  const minorSpacing = MINOR_SPACING / gridScale;
  const majorSpacing = MAJOR_SPACING / gridScale;
  const minorLines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  const majorLines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];

  const minorPhaseX = mod(offsetX, minorSpacing);
  const minorPhaseY = mod(offsetY, minorSpacing);
  const majorPhaseX = mod(offsetX, majorSpacing);
  const majorPhaseY = mod(offsetY, majorSpacing);

  for (let x = -minorPhaseX; x <= safeWidth; x += minorSpacing) {
    minorLines.push({ key: `mv${x}`, x1: x, y1: 0, x2: x, y2: safeHeight });
  }
  for (let y = -minorPhaseY; y <= safeHeight; y += minorSpacing) {
    minorLines.push({ key: `mh${y}`, x1: 0, y1: y, x2: safeWidth, y2: y });
  }
  for (let x = -majorPhaseX; x <= safeWidth; x += majorSpacing) {
    majorLines.push({ key: `Mv${x}`, x1: x, y1: 0, x2: x, y2: safeHeight });
  }
  for (let y = -majorPhaseY; y <= safeHeight; y += majorSpacing) {
    majorLines.push({ key: `Mh${y}`, x1: 0, y1: y, x2: safeWidth, y2: y });
  }

  // Stroke in viewBox units so each line stays at least 1 real pixel in the
  // smaller bitmap (it's scaled back up by k on screen).
  const strokeWidth = Math.max(1, k / ratio);

  return (
    <Svg
      style={{
        position: 'absolute',
        left: offsetX,
        top: offsetY,
        transformOrigin: '0 0',
        transform: k > 1 ? [{ scale: k }] : undefined,
      }}
      width={safeWidth / k}
      height={safeHeight / k}
      viewBox={`0 0 ${safeWidth} ${safeHeight}`}
    >
      <Rect x={0} y={0} width={safeWidth} height={safeHeight} fill={colors.bg} />
      {minorLines.map((l) => (
        <Line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={colors.grid} strokeWidth={strokeWidth} />
      ))}
      {majorLines.map((l) => (
        <Line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={colors.gridMajor} strokeWidth={strokeWidth} />
      ))}
    </Svg>
  );
}
