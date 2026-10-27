import type { FlowchartTask, PositionedTask } from './types';

// admin-web's flowchart runs a real chain/column auto-layout algorithm
// (layoutWithDagre in TaskDependencyGraph.tsx) but ONLY for a task that has
// no manual_position_x/y yet — and every real task in the live database
// already has one (confirmed live: 311/311). So the auto-layout path is a
// rare-new-task fallback there too, not the common case — this mirrors that
// same priority (manual position wins, always) without re-implementing the
// chain/column/section algorithm, since mobile reads the exact same stored
// coordinates admin-web itself positions its own cards at: a task dragged
// on either platform looks identical on the other, pixel for pixel.
// Real device feedback: the gap BETWEEN boxes (both within a chain and
// between the two parallel-track columns) reads as excessive, even though
// this app never runs its own auto-layout — every real task's position is
// admin-web's own dagre-computed (or since-manually-dragged) x/y, stored
// verbatim (see layoutTasks's own comment below). admin-web's dagre assumes
// a 260×130 card (its own NODE_WIDTH/HEIGHT); this app's card is smaller
// (220×88, tightened separately for internal padding) — rendering
// admin-web's grid at a smaller box size doesn't shrink the GAPS between
// those fixed coordinates at all, so the same absolute spacing reads as
// proportionally much roomier here than it does on admin-web's own canvas.
//
// A single global scale factor was tried first and rejected: it can only
// ever compress as far as the SINGLE tightest real gap anywhere in the
// whole graph allows, so most pairs (which have much more room than that
// one tightest pair) barely tighten at all — exactly the "still too big"
// gap real feedback flagged even after that pass shipped. This instead
// targets a fixed, absolute gap on each axis directly: every DISTINCT
// stored coordinate along an axis (rounded into "buckets" — AXIS_GROUP_EPSILON
// merges near-duplicate values from minor manual-drag jitter into the same
// bucket) gets remapped so consecutive buckets end up exactly
// boxSize + targetGapPx apart — UNLESS the two were already closer than
// that in the original data, in which case that pair is left completely
// untouched (never further compressed, so a naturally-tight spot can never
// become an overlap). The result is piecewise linear and strictly
// monotonic (order-preserving, so no reordering risk) and fully invertible
// (see inverseAxisMap — needed so a drag's on-screen/compressed position
// can be converted back to admin-web's real coordinate space before being
// persisted).
//
// Calibrated + verified against all 311 of this project's real positioned
// tasks (a disposable script, not guessed): HORIZONTAL_TARGET_GAP=26
// produces zero bounding-box overlaps and no new edge crossings, and real
// feedback confirmed the horizontal gap (a main task and its parallel
// partner) already reads correctly at this value — left untouched.
//
// VERTICAL_TARGET_GAP was tightened from 46 to 30 alongside TaskNode's own
// chip-offset unification (see that file's comment): the old value's real
// floor was set by the SOLO date chip's `top: -38` offset (46 - 38 = only
// 8px of actual clearance above the box before a collision) — now that
// both chip cases render at a single, closer `top: -20`, the same 8px
// clearance is achievable at a much smaller gap. Re-verified against all
// 311 real positioned tasks for box-to-box overlap and edge-crossing
// safety (see the disposable calibration script — same method as the
// previous pass). The date/delay chip vs. the FS/SS/FF/SF type badge
// (which floats at the connector's midpoint) is a separate, real
// constraint — see EdgeLayer.tsx's own comment on how that's kept clear.
const HORIZONTAL_TARGET_GAP = 26;
// 30 -> 36 -> 42. Each nudge was real feedback that the gap (specifically
// the room around the FS/SS/FF/SF badge floating at the connector's
// midpoint, not the boxes themselves) still read as cramped. Still well
// short of the original 46.
const VERTICAL_TARGET_GAP = 42;
// Two stored coordinates within this many px of each other are treated as
// "the same row/column" (minor manual-drag jitter, not a real distinct
// position). Was 10, then 45 — both still too small: the first real-data
// pass only sampled part of the graph and missed that the SAME column
// (confirmed via 2f→2g, an adjacent-row main/parallel pair that must
// align) has a genuine 326.89→391 jump of ~61px, not just the ~36px seen
// elsewhere. 70 clears that with a little margin, while the next real
// DIFFERENT column is still ~354px away — nowhere close to being
// accidentally merged. Shared with the Y axis too, but real row-to-row Y
// gaps are ~270px+ apart, so this is nowhere near tight enough to risk
// merging two distinct rows.
//
// One known, accepted residual gap with a flat global epsilon like this:
// a lone, otherwise-unrelated task elsewhere in the graph (task 12c, far
// below in Y) happens to sit only ~36px from column D's own x — it gets
// pulled into that bucket too. Harmless in practice (its own y is nowhere
// near column D's real rows, so nothing visually collides), but it's a
// real limitation of merging by x-distance alone with no y-locality check
// — a fully correct fix would only merge two x-values when their tasks'
// y-ranges are actually contiguous, not just "close in x."
const AXIS_GROUP_EPSILON = 70;

export interface AxisBreakpoint {
  orig: number;
  compressed: number;
}

// Groups raw stored coordinates into clusters (a chain of consecutive
// sorted values each within `epsilon` of the previous one) and maps every
// observed value to its cluster's own canonical representative (the
// cluster's lowest value). This has to run BEFORE buildAxisMap: that
// function's own epsilon check only skips adding a REDUNDANT breakpoint
// for a near-duplicate value — applyAxisMap still linearly interpolates
// WITHIN a merged span, so two different (even if "merged") original
// values never actually land on the exact same compressed pixel, just a
// closer one. Confirmed live: 2f (x=326.89) and 2g (x=391) — both meant to
// be the same right-hand column — still rendered ~31px apart after
// interpolation even with an epsilon wide enough to span that gap.
// Canonicalizing first guarantees every task in a cluster feeds the
// IDENTICAL literal number into the axis map, which is what actually
// makes them render pixel-identical.
function canonicalizeValues(values: number[], epsilon: number): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const canonical = new Map<number, number>();
  let clusterStart = sorted[0];
  let prev = sorted[0];
  // Gap check against the PREVIOUS sorted value (chain-merge), not a fixed
  // cluster anchor — a cluster's total span can exceed epsilon as long as
  // each consecutive step within it doesn't (e.g. 326.89 -> 391 -> 407.88,
  // steps of ~64 and ~17, both ≤ 70, chain into one cluster even though
  // 407.88 - 326.89 = ~81 > 70 on its own).
  for (const v of sorted) {
    if (v - prev > epsilon) clusterStart = v;
    canonical.set(v, clusterStart);
    prev = v;
  }
  return canonical;
}

// Builds the piecewise map described above for one axis. `boxSize` is
// NODE_WIDTH or NODE_HEIGHT for that axis; `targetGapPx` is this axis's
// target (HORIZONTAL_TARGET_GAP / VERTICAL_TARGET_GAP).
export function buildAxisMap(values: number[], boxSize: number, targetGapPx: number): AxisBreakpoint[] {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const bucketOriginals: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > AXIS_GROUP_EPSILON) bucketOriginals.push(sorted[i]);
  }
  const compressedPos: number[] = [bucketOriginals[0]];
  for (let i = 1; i < bucketOriginals.length; i++) {
    const origGap = bucketOriginals[i] - bucketOriginals[i - 1];
    // Never grow a gap that was already tighter than the target — only
    // ever shrinks a roomier-than-needed one.
    const newGap = Math.min(origGap, boxSize + targetGapPx);
    compressedPos.push(compressedPos[i - 1] + newGap);
  }
  return bucketOriginals.map((orig, i) => ({ orig, compressed: compressedPos[i] }));
}

// Piecewise-linear forward lookup — value can fall exactly on a
// breakpoint, between two, or (rarely, e.g. a single-task graph) outside
// the range entirely, in which case it keeps its original 1:1 offset from
// the nearest end rather than extrapolating the last segment's slope.
export function applyAxisMap(breakpoints: AxisBreakpoint[], value: number): number {
  if (breakpoints.length === 0) return value;
  if (value <= breakpoints[0].orig) return breakpoints[0].compressed + (value - breakpoints[0].orig);
  for (let i = 0; i < breakpoints.length - 1; i++) {
    if (value <= breakpoints[i + 1].orig) {
      const t = (value - breakpoints[i].orig) / (breakpoints[i + 1].orig - breakpoints[i].orig);
      return breakpoints[i].compressed + t * (breakpoints[i + 1].compressed - breakpoints[i].compressed);
    }
  }
  const last = breakpoints[breakpoints.length - 1];
  return last.compressed + (value - last.orig);
}

// The exact inverse of applyAxisMap — same piecewise segments, walked in
// compressed-space instead of original-space. Used only when persisting a
// drag (see FlowchartCanvas's commitDrag): the gesture's final position is
// known in compressed/on-screen space, but manual_position_x/y must always
// be written in admin-web's real, uncompressed space, or every drag would
// slowly corrupt the shared coordinate grid admin-web also reads.
export function inverseAxisMap(breakpoints: AxisBreakpoint[], compressedValue: number): number {
  if (breakpoints.length === 0) return compressedValue;
  if (compressedValue <= breakpoints[0].compressed) return breakpoints[0].orig + (compressedValue - breakpoints[0].compressed);
  for (let i = 0; i < breakpoints.length - 1; i++) {
    if (compressedValue <= breakpoints[i + 1].compressed) {
      const t = (compressedValue - breakpoints[i].compressed) / (breakpoints[i + 1].compressed - breakpoints[i].compressed);
      return breakpoints[i].orig + t * (breakpoints[i + 1].orig - breakpoints[i].orig);
    }
  }
  const last = breakpoints[breakpoints.length - 1];
  return last.orig + (compressedValue - last.compressed);
}

export interface FlowchartAxisMaps {
  x: AxisBreakpoint[];
  y: AxisBreakpoint[];
}

interface Positionable {
  id: string;
  manualPositionX: number | null;
  manualPositionY: number | null;
}

interface AxisMapsWithCanon extends FlowchartAxisMaps {
  xCanon: Map<number, number>;
  yCanon: Map<number, number>;
}

function buildAxisMapsWithCanon<T extends Positionable>(items: T[]): AxisMapsWithCanon {
  const positioned = items.filter((t) => t.manualPositionX != null && t.manualPositionY != null);
  const xCanon = canonicalizeValues(positioned.map((t) => t.manualPositionX!), AXIS_GROUP_EPSILON);
  const yCanon = canonicalizeValues(positioned.map((t) => t.manualPositionY!), AXIS_GROUP_EPSILON);
  return {
    x: buildAxisMap(positioned.map((t) => xCanon.get(t.manualPositionX!)!), NODE_WIDTH, HORIZONTAL_TARGET_GAP),
    y: buildAxisMap(positioned.map((t) => yCanon.get(t.manualPositionY!)!), NODE_HEIGHT, VERTICAL_TARGET_GAP),
    xCanon,
    yCanon,
  };
}

// The generic core of the position pipeline — extracted so the Flowchart
// Template canvas (template_tasks: same "null means still auto-laid-out,
// set once dragged, always wins from then on" position convention, ported
// verbatim from admin-web's own TemplateTask.positionX/Y) can reuse the
// EXACT same math instead of a second, drifting copy. Anything with an id
// + manualPositionX/Y satisfies this — a real FlowchartTask does today, and
// nothing about the algorithm below is task-specific.
export function buildAxisMapsGeneric<T extends Positionable>(items: T[]): FlowchartAxisMaps {
  const { x, y } = buildAxisMapsWithCanon(items);
  return { x, y };
}

export function layoutGeneric<T extends Positionable>(items: T[]): (T & { x: number; y: number })[] {
  const unpositioned = items.filter((t) => t.manualPositionX == null || t.manualPositionY == null);
  // Simple deterministic fallback for an item that hasn't been positioned
  // yet — stacked in a column to the right of everything else, so it never
  // overlaps a real positioned card. Deliberately NOT run through the axis
  // maps below — there's no "real" grid to compress relative to for
  // something that's never been positioned, so it keeps its own
  // already-comfortable fallback spacing untouched.
  const maxX = Math.max(0, ...items.filter((t) => t.manualPositionX != null).map((t) => t.manualPositionX!));
  const fallbackX = maxX + NODE_WIDTH + 130;

  const { x: xMap, y: yMap, xCanon, yCanon } = buildAxisMapsWithCanon(items);

  return items.map((t) => {
    if (t.manualPositionX != null && t.manualPositionY != null) {
      const x = applyAxisMap(xMap, xCanon.get(t.manualPositionX)!);
      const y = applyAxisMap(yMap, yCanon.get(t.manualPositionY)!);
      return { ...t, x, y };
    }
    const idx = unpositioned.findIndex((u) => u.id === t.id);
    return { ...t, x: fallbackX, y: idx * (NODE_HEIGHT + 140) };
  });
}

// Built once per render pass from whatever the CURRENT full task list's
// real positions are — shared by layoutTasks (forward, for rendering) and
// FlowchartCanvas's commitDrag (inverse, for persisting a drag) so both
// always agree on the exact same mapping. Thin wrapper over the generic
// core above, kept so every existing call site's type stays exactly as-is.
export function buildFlowchartAxisMaps(tasks: FlowchartTask[]): FlowchartAxisMaps {
  return buildAxisMapsGeneric(tasks);
}

export function layoutTasks(tasks: FlowchartTask[]): PositionedTask[] {
  return layoutGeneric(tasks);
}

// Was 220 — shrunk further on real feedback that the box still read as too
// big. 195 was checked against real task-name lengths (not guessed): at
// this width, TaskNode's action text (now capped at 3 wrapped lines
// instead of 2) comfortably fits even the single longest real task name in
// the live data (74 characters) with zero truncation.
// 195 -> 205: bumped alongside TaskNode's padding going from a thin/
// asymmetric 3/3/3/1 to a real uniform padding, by explicit request. Not
// re-verified against all 311 real tasks the way the original 195 was
// (no device/simulator available from this environment to re-run that
// measurement) — HORIZONTAL_TARGET_GAP's own box-to-box spacing formula
// (boxSize + targetGapPx) absorbs this automatically so nothing overlaps,
// but the "does text still fit without ellipsizing more than before"
// question needs a real-device check.
export const NODE_WIDTH = 205;
// Was 120, then 88, then 82, then 74 — that last trim assumed a wrapped
// 2-line category AND the full 3-line action cap essentially never
// happened together in practice; real feedback (and real overflow past
// the box border, visible on actual data) proved that assumption wrong.
// Re-measured directly instead of re-guessing: temporarily let every real
// box auto-size to its own content (no fixed height) and read back the
// actual rendered height of all 311 real tasks — 292 need 80px, 13 need
// 91px, and the tallest 6 (the longest category+action combinations in
// the live data, e.g. "Grade slab reinforcement for indoor & outdoor
// flooring...") need exactly 108px. 110 covers the real measured max with
// 2px to spare, so NO box's content can ever spill past its own border
// again — every box renders at this same fixed height now, not sized
// per-box, even though most need far less of it.
// 74 -> 110 -> 92. 110 was sized to fit action's OLD 3-line cap (rare
// 108px-tall real cases) — real feedback after seeing it live was that the
// resulting empty gap on the common ~65-76px case was worse than the
// overflow it fixed. Instead of shrinking the box alone (which would just
// reintroduce overflow for the tallest real content), action's own cap
// dropped from 3 lines to 2 (see TaskNode's own comment) — re-measured the
// same way as before (auto-height across all 311 real tasks): 201 need
// 65px, 91 need 75-76px, and the tallest 19 (2-line category + full
// 2-line action) need exactly 91px. 92 covers that real measured max with
// 1px to spare — the rare longest task names ellipsize at 2 lines instead
// of the box growing to fit a 3rd, but nothing overflows past its border.
// 92 -> 106: the AC/AV badge moved from sharing the taskId's in-box row to
// its own chip above the box (see TaskNode), and padding went from a thin
// 3/3/3/1 to a uniform ~10px, by explicit request — +14px gives that real
// headroom back. Estimated, not re-measured against all 311 real tasks the
// way 92 itself was (no device/simulator available here) — TaskNode also
// sets `overflow: 'hidden'` now as a backstop so content clips cleanly at
// the border in the worst case instead of visibly spilling past it, but a
// real-device check is still worth doing to confirm nothing needs 3 lines.
export const NODE_HEIGHT = 106;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Generic over anything with x/y (a PositionedTask or a PositionedTemplateTask
// both satisfy this structurally) — nothing in here is task-specific either.
export function computeBounds(tasks: { x: number; y: number }[]): Bounds {
  if (tasks.length === 0) return { minX: 0, minY: 0, maxX: NODE_WIDTH, maxY: NODE_HEIGHT };
  return {
    minX: Math.min(...tasks.map((t) => t.x)),
    minY: Math.min(...tasks.map((t) => t.y)),
    maxX: Math.max(...tasks.map((t) => t.x + NODE_WIDTH)),
    maxY: Math.max(...tasks.map((t) => t.y + NODE_HEIGHT)),
  };
}

// Both canvases size their pannable container to bounds.maxX/maxY plus this
// same margin — pulled out so the safety net below projects the exact same
// container size its callers are about to render, not an approximation.
export const CONTAINER_PADDING = 400;

// Android's HWUI RecordingCanvas hard-rejects a single View's own backing
// bitmap once its PHYSICAL-pixel byte size crosses a device-dependent
// ceiling — confirmed live via Sentry on a real device: this app's largest
// real project (311 tasks, one long single-column chain) crashed with
// "Canvas: trying to draw too large(826813312 bytes) bitmap" purely from
// being laid out at a logical size that was safe on lower-density phones
// but not this one. The piecewise per-axis compression above already keeps
// a normal project comfortably under this on most devices, but nothing
// stopped an unusually large/dense project — or the same project on an
// unusually high-density device — from silently growing past it again as
// more tasks get added over time. This is the last-resort net: given the
// device's OWN PixelRatio (the thing that actually converts these logical
// dp values into the physical pixels Android's bitmap ceiling is measured
// in), uniformly shrink every task position around the origin by whatever
// single factor brings the projected container back under a safe budget —
// losing some of the deliberately-tuned per-axis gap targets above in this
// rare case is a strictly better trade than a hard, unrecoverable crash.
const SAFE_BITMAP_BYTES = 60 * 1024 * 1024; // comfortable margin under Android's real (device-variable) ceiling — confirmed exceeded at 826MB on a real device
const BYTES_PER_PIXEL = 4; // ARGB_8888, HWUI's own default format

export interface SafeLayoutResult<T> {
  tasks: T[];
  // How much SMALLER than NODE_WIDTH/NODE_HEIGHT this graph is actually
  // rendering at (1 = unchanged, the overwhelmingly common case for every
  // project short of this app's largest). Positions alone were shrunk here
  // by this exact same factor — a caller that renders box/chip dimensions
  // at their normal fixed size while positions shrink underneath them gets
  // boxes with nothing between them: the compression above already tightens
  // every gap to the minimum non-overlapping distance for the FULL-size box,
  // so any further position-only shrink guarantees overlap unless the boxes
  // themselves shrink by this identical factor too. Every caller MUST apply
  // this to whatever it renders at task-dependent size (TaskNode's own box
  // + its chip offsets, EdgeLayer's center() math) or this net reintroduces
  // exactly the visual bug it was written to prevent.
  nodeScale: number;
}

export function clampToSafeBitmapBudget<T extends { x: number; y: number }>(tasks: T[], pixelRatio: number): SafeLayoutResult<T> {
  if (tasks.length === 0) return { tasks, nodeScale: 1 };
  const bounds = computeBounds(tasks);
  const width = bounds.maxX + CONTAINER_PADDING;
  const height = bounds.maxY + CONTAINER_PADDING;
  const physicalPixels = width * height * pixelRatio * pixelRatio;
  const maxPhysicalPixels = SAFE_BITMAP_BYTES / BYTES_PER_PIXEL;
  if (physicalPixels <= maxPhysicalPixels) return { tasks, nodeScale: 1 };
  const shrink = Math.sqrt(maxPhysicalPixels / physicalPixels);
  return { tasks: tasks.map((t) => ({ ...t, x: t.x * shrink, y: t.y * shrink })), nodeScale: shrink };
}

// A real project's task graph (as laid out on admin-web's much larger desktop
// canvas) can span tens of thousands of px tall for 300+ tasks — naively
// shrinking that to fit an ~800px phone screen would need a scale near 0.02,
// which renders every node as an illegible sub-pixel dot (confirmed live:
// nodes/edges existed in the DOM but were visually imperceptible). So this
// clamps to a legible minimum zoom instead of always fitting the whole
// graph, and — since the content then doesn't fit the viewport — anchors to
// its top-left (where the earliest tasks are) rather than centering, so the
// first thing shown is real, readable tasks instead of empty space in the
// middle of a chart much bigger than the screen. Pinch-zoom-out/pan handles
// exploring the rest.
const MIN_SCALE = 0.4;
const MAX_SCALE = 1.25;

export function fitViewTransform(bounds: Bounds, viewportWidth: number, viewportHeight: number, padding = 60) {
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const fitScale = Math.min(
    (viewportWidth - padding * 2) / contentWidth,
    (viewportHeight - padding * 2) / contentHeight
  );
  const scale = Math.min(Math.max(fitScale, MIN_SCALE), MAX_SCALE);

  const translateX = contentWidth * scale <= viewportWidth
    ? viewportWidth / 2 - (bounds.minX + contentWidth / 2) * scale
    : padding - bounds.minX * scale;
  const translateY = contentHeight * scale <= viewportHeight
    ? viewportHeight / 2 - (bounds.minY + contentHeight / 2) * scale
    : padding - bounds.minY * scale;
  return { scale, translateX, translateY };
}

// Fitting the WHOLE graph (above) is still correct as a general-purpose
// utility, but as the canvas's own DEFAULT view on tab-open it read as
// "everything shrunk down small" for any real multi-row project — MIN_SCALE
// (0.4) is legible but still cramped, and a 300+ task graph's true fit-scale
// is usually far below even that floor already, so top-left anchoring just
// means "start staring at a tiny corner of a huge chart." This instead
// fits only the TOPMOST row group (the first main task + its parallel/SS
// partner column — exactly the pair the graph's own layout puts first) at
// a much more generous, centered scale, and lets pinch/pan reach the rest.
//
// No MIN_SCALE floor here (unlike fitViewTransform above) — a floor was
// tried and confirmed live to actively BREAK the "both boxes visible"
// requirement: a two-column row's true width-fit scale can legitimately be
// well under 1 (two 220px-wide boxes plus the real gap admin-web positioned
// them at routinely exceeds a phone's viewport width at scale 1), and
// forcing scale UP to a floor pushed the right-hand column off the right
// edge of the screen entirely. Fitting the row's real width takes priority
// over a minimum-legibility floor; MAX_SCALE alone still stops a
// single-lonely-box top row from zooming in absurdly large.
const INITIAL_FOCUS_MAX_SCALE = 1.3;
const INITIAL_FOCUS_PADDING = 24;
// Extra headroom above the focused row so its date/delay chips (rendered
// ABOVE each box, see TaskNode's `top: -18`/`top: -38` chip offsets) aren't
// clipped by the very top edge of the viewport.
const INITIAL_FOCUS_TOP_HEADROOM = 48;

export function fitInitialViewTransform(tasks: { x: number; y: number }[], viewportWidth: number, viewportHeight: number) {
  if (tasks.length === 0) {
    return fitViewTransform(computeBounds(tasks), viewportWidth, viewportHeight);
  }

  const minY = Math.min(...tasks.map((t) => t.y));
  const rowTasks = tasks.filter((t) => t.y < minY + NODE_HEIGHT * 1.5);
  const region = computeBounds(rowTasks);
  const contentWidth = Math.max(1, region.maxX - region.minX);
  const contentHeight = Math.max(1, region.maxY - region.minY);

  const fitScale = Math.min(
    (viewportWidth - INITIAL_FOCUS_PADDING * 2) / contentWidth,
    (viewportHeight - INITIAL_FOCUS_PADDING * 2 - INITIAL_FOCUS_TOP_HEADROOM) / contentHeight
  );
  const scale = Math.min(fitScale, INITIAL_FOCUS_MAX_SCALE);

  const translateX = viewportWidth / 2 - (region.minX + contentWidth / 2) * scale;
  const translateY = INITIAL_FOCUS_PADDING + INITIAL_FOCUS_TOP_HEADROOM - region.minY * scale;
  return { scale, translateX, translateY };
}

export interface GridArea {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

// How far beyond the current viewport the grid extends in every direction —
// a multiple of the CURRENT viewport size in content-space (so it scales
// correctly with zoom: more raw content-space area is visible when zoomed
// out, and the margin grows with it). Regenerated (see FlowchartCanvas/
// TemplateCanvas's own recomputeGridArea) every time a pan/pinch gesture
// SETTLES, not on every frame of an active drag — a truly per-frame-reactive
// infinite grid would need react-native-svg's <Pattern>, already tried and
// confirmed broken on real Android/Hermes devices (see GridBackground's own
// comment). A margin this generous means any single realistic pan gesture
// (a swipe, not a marathon multi-screen drag) never actually reaches the
// edge before the next settle re-centers it again — confirmed live by
// panning repeatedly in every direction on both an empty and a populated
// canvas with no visible cutoff.
const GRID_MARGIN_MULTIPLIER = 5;

export function computeGridArea(
  scale: number,
  translateX: number,
  translateY: number,
  viewportWidth: number,
  viewportHeight: number
): GridArea {
  const centerX = (viewportWidth / 2 - translateX) / scale;
  const centerY = (viewportHeight / 2 - translateY) / scale;
  const width = (viewportWidth / scale) * GRID_MARGIN_MULTIPLIER;
  const height = (viewportHeight / scale) * GRID_MARGIN_MULTIPLIER;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height, scale };
}
