// Right-angle link routing (2026-11-15): links run straight down/across and
// bend at 90° in the gaps between boxes, like a drawn flowchart, instead of
// cutting diagonally across the board. Boxes are never moved.

export interface Pt { x: number; y: number }
export interface Box { id: string; x: number; y: number; w: number; h: number }

const near = (a: number, b: number) => Math.abs(a - b) < 2;

// How many other boxes a route passes through (shrunk a little so a line
// running along a gap doesn't count).
function hits(route: Pt[], boxes: Box[], skip: Set<string>): number {
  let n = 0;
  for (const b of boxes) {
    if (skip.has(b.id)) continue;
    const l = b.x + 4, r = b.x + b.w - 4, t = b.y + 4, btm = b.y + b.h - 4;
    for (let i = 0; i < route.length - 1; i++) {
      const p = route[i], q = route[i + 1];
      const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x);
      const minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
      if (maxX >= l && minX <= r && maxY >= t && minY <= btm) { n++; break; }
    }
  }
  return n;
}

function clean(route: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of route) {
    const last = out[out.length - 1];
    if (last && near(last.x, p.x) && near(last.y, p.y)) continue;
    out.push(p);
  }
  // Drop middle points of straight runs.
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1], c = out[i + 1];
    return !((near(a.x, p.x) && near(p.x, c.x)) || (near(a.y, p.y) && near(p.y, c.y)));
  });
}

/**
 * Orthogonal route from box `a` to box `b`. `gapBelow` is where a horizontal
 * run sits under a box (clear of the next box's date chip); `gapAbove` is
 * where it sits over a box (above its chip); `colGap` is half the space
 * between columns.
 */
export function routeEdge(
  a: Box,
  b: Box,
  boxes: Box[],
  g: { gapBelow: number; gapAbove: number; colGap: number },
  // Group outlines (2026-11-16): a link not belonging to a group keeps clear
  // of its outline instead of running along / through it.
  zones: { box: Box; members: Set<string> }[] = []
): Pt[] {
  const skip = new Set([a.id, b.id]);
  for (const z of zones) if (z.members.has(a.id) || z.members.has(b.id)) skip.add(z.box.id);
  // Each outline counts a little wider than drawn, so a link can't hug its edge.
  const M = 10;
  boxes = zones.length ? [...boxes, ...zones.map((z) => ({ ...z.box, x: z.box.x - M, y: z.box.y - M, w: z.box.w + 2 * M, h: z.box.h + 2 * M }))] : boxes;
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };

  // Rows overlap: go across, bending once in the column gap if needed.
  if (b.y < a.y + a.h && a.y < b.y + b.h) {
    const right = bc.x > ac.x;
    const sx = right ? a.x + a.w : a.x;
    const tx = right ? b.x : b.x + b.w;
    if (near(ac.y, bc.y)) {
      const straight = [{ x: sx, y: ac.y }, { x: tx, y: bc.y }];
      if (hits(straight, boxes, skip) === 0) return straight;
      // A card in between on the same row: go over the row instead of through it.
      const yUp = Math.min(a.y, b.y) - g.gapAbove;
      return clean([{ x: ac.x, y: a.y }, { x: ac.x, y: yUp }, { x: bc.x, y: yUp }, { x: bc.x, y: b.y }]);
    }
    const mx = (sx + tx) / 2;
    return clean([{ x: sx, y: ac.y }, { x: mx, y: ac.y }, { x: mx, y: bc.y }, { x: tx, y: bc.y }]);
  }

  const down = bc.y > ac.y;
  const sy = down ? a.y + a.h : a.y;
  const ty = down ? b.y : b.y + b.h;
  // Same column: always a straight line (2026-11-16, by request), even when
  // another card sits in between — the line runs behind that card.
  if (near(ac.x, bc.x)) return [{ x: ac.x, y: sy }, { x: bc.x, y: ty }];
  // Horizontal run just past the source, or just before the target.
  const yNearA = down ? sy + g.gapBelow : sy - g.gapAbove;
  const yNearB = down ? ty - g.gapAbove : ty + g.gapBelow;
  // Or down a column gap beside the target, so it can't cross any box.
  const side = ac.x >= bc.x ? 1 : -1;
  const gx = side > 0 ? b.x + b.w + g.colGap : b.x - g.colGap;
  const gxOther = side > 0 ? b.x - g.colGap : b.x + b.w + g.colGap;
  const candidates: { route: Pt[]; cost: number }[] = [
    {
      route: clean([
        { x: ac.x, y: sy }, { x: ac.x, y: yNearA }, { x: gxOther, y: yNearA },
        { x: gxOther, y: yNearB }, { x: bc.x, y: yNearB }, { x: bc.x, y: ty },
      ]),
      cost: 0.6,
    },
    { route: clean([{ x: ac.x, y: sy }, { x: ac.x, y: yNearA }, { x: bc.x, y: yNearA }, { x: bc.x, y: ty }]), cost: 0 },
    { route: clean([{ x: ac.x, y: sy }, { x: ac.x, y: yNearB }, { x: bc.x, y: yNearB }, { x: bc.x, y: ty }]), cost: 0.1 },
    {
      route: clean([
        { x: ac.x, y: sy }, { x: ac.x, y: yNearA }, { x: gx, y: yNearA },
        { x: gx, y: yNearB }, { x: bc.x, y: yNearB }, { x: bc.x, y: ty },
      ]),
      cost: 0.5,
    },
  ];
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const score = hits(c.route, boxes, skip) + c.cost;
    if (score < bestScore) { best = c; bestScore = score; }
  }
  return best.route;
}

/** Middle of the route's longest run (where the type label goes). */
export function longestRun(route: Pt[]): { from: Pt; to: Pt } {
  let bi = 0, bl = -1;
  for (let i = 0; i < route.length - 1; i++) {
    const l = Math.abs(route[i + 1].x - route[i].x) + Math.abs(route[i + 1].y - route[i].y);
    if (l > bl) { bl = l; bi = i; }
  }
  return { from: route[bi], to: route[bi + 1] };
}

/** Same route shifted sideways by `d` (for SS's double line); corners stay square. */
export function offsetRoute(route: Pt[], d: number): Pt[] {
  const norm = (p: Pt, q: Pt) => {
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (-(q.y - p.y) / len) * d, y: ((q.x - p.x) / len) * d };
  };
  return route.map((p, i) => {
    const n1 = i > 0 ? norm(route[i - 1], p) : null;
    const n2 = i < route.length - 1 ? norm(p, route[i + 1]) : null;
    if (n1 && n2) return { x: p.x + n1.x + n2.x, y: p.y + n1.y + n2.y };
    const n = (n1 ?? n2)!;
    return { x: p.x + n.x, y: p.y + n.y };
  });
}
