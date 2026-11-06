// Browser-only PDF helpers for the drawing viewer: render a page to a
// canvas, tint a consultant sheet into a coloured transparent layer, and
// compare two revisions pixel-by-pixel to find what changed.

// Web build only (this file is .web.ts). pdf.js 5.4.296 — the same version
// admin-web uses — is served from public/pdfjs/ and loaded at runtime, so it
// is not bundled by Metro and adds nothing to the native app.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PDFDocumentProxy = any;
type PdfJs = any;

let pdfjsPromise: Promise<PdfJs> | null = null;

// Plain dynamic import of a URL, hidden from Metro (which would otherwise
// try to resolve it as a module at build time).
const importUrl = new Function('u', 'return import(u)') as (u: string) => Promise<PdfJs>;

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = importUrl('/pdfjs/pdf.min.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return pdfjs;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

// Keyed by drawing-version id, not URL: signed URLs change on every page
// refresh but the file behind a version never does.
const docCache = new Map<string, Promise<PDFDocumentProxy>>();

export function loadPdf(versionId: string, url: string): Promise<PDFDocumentProxy> {
  let p = docCache.get(versionId);
  if (!p) {
    p = loadPdfJs().then((pdfjs) => pdfjs.getDocument({ url }).promise);
    p.catch(() => docCache.delete(versionId));
    docCache.set(versionId, p);
  }
  return p;
}

const pageCache = new Map<string, Promise<HTMLCanvasElement>>();

// Renders one page so its width is `width` device pixels. Cached per
// (version, page, width).
export function renderPage(versionId: string, url: string, pageNo: number, width: number): Promise<HTMLCanvasElement> {
  const key = `${versionId}:${pageNo}:${width}`;
  let p = pageCache.get(key);
  if (!p) {
    p = (async () => {
      const doc = await loadPdf(versionId, url);
      const page = await doc.getPage(Math.min(pageNo, doc.numPages));
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      return canvas;
    })();
    p.catch(() => pageCache.delete(key));
    pageCache.set(key, p);
  }
  return p;
}

export async function pageCount(versionId: string, url: string): Promise<number> {
  return (await loadPdf(versionId, url)).numPages;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lum = (d: Uint8ClampedArray, i: number) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

// Paper becomes transparent, ink becomes `color` — so a consultant's sheet
// can be laid over the architect's sheet and both stay readable.
export function tintCanvas(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const sctx = src.getContext('2d')!;
  const octx = out.getContext('2d')!;
  const img = sctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  const [r, g, b] = hexToRgb(color);
  for (let i = 0; i < d.length; i += 4) {
    const ink = 255 - lum(d, i);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = ink < 28 ? 0 : Math.min(255, ink * 1.25);
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/* ── Revision comparison ─────────────────────────────────────────── */

export interface ChangeRegion {
  // Fractions of the page, like tags.
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompareResult {
  canvas: HTMLCanvasElement;
  regions: ChangeRegion[];
  sameSize: boolean;
}

const INK = 110; // darkness threshold for "there is a line here"

function inkMask(d: Uint8ClampedArray, n: number): Uint8Array {
  const m = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) m[p] = 255 - lum(d, i) > INK ? 1 : 0;
  return m;
}

// 3x3 dilation, `passes` times — absorbs anti-aliasing and 1-2 px shifts
// so re-exported but unchanged lines don't light up as changes.
function dilate(m: Uint8Array, w: number, h: number, passes: number): Uint8Array {
  let cur = m;
  for (let k = 0; k < passes; k++) {
    const tmp = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const p = row + x;
        tmp[p] = cur[p] | (x > 0 ? cur[p - 1] : 0) | (x < w - 1 ? cur[p + 1] : 0);
      }
    }
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const p = row + x;
        next[p] = tmp[p] | (y > 0 ? tmp[p - w] : 0) | (y < h - 1 ? tmp[p + w] : 0);
      }
    }
    cur = next;
  }
  return cur;
}

// Green = only in the newer revision (added), red = only in the older one
// (removed), grey = unchanged. Also groups changed pixels into rectangular
// regions so they can be outlined like revision clouds.
export function compareRevisions(older: HTMLCanvasElement, newer: HTMLCanvasElement): CompareResult {
  const w = newer.width;
  const h = newer.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;

  if (older.width !== w || older.height !== h) {
    octx.drawImage(newer, 0, 0);
    return { canvas: out, regions: [], sameSize: false };
  }

  const n = w * h;
  const nd = newer.getContext('2d')!.getImageData(0, 0, w, h).data;
  const od = older.getContext('2d')!.getImageData(0, 0, w, h).data;
  const nm = inkMask(nd, n);
  const om = inkMask(od, n);
  const nmWide = dilate(nm, w, h, 2);
  const omWide = dilate(om, w, h, 2);

  const img = octx.createImageData(w, h);
  const d = img.data;
  const CELL = Math.max(16, Math.round(w / 120));
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  const cellHits = new Uint32Array(cols * rows);

  const addedMask = new Uint8Array(n);
  const removedMask = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    addedMask[p] = nm[p] && !omWide[p] ? 1 : 0;
    removedMask[p] = om[p] && !nmWide[p] ? 1 : 0;
    if (addedMask[p] || removedMask[p]) {
      const x = p % w;
      const y = (p - x) / w;
      cellHits[((y / CELL) | 0) * cols + ((x / CELL) | 0)]++;
    }
  }
  // Thicken changed strokes so a 1 px line edit is visible without zooming.
  const addedBold = dilate(addedMask, w, h, 1);
  const removedBold = dilate(removedMask, w, h, 1);

  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (addedBold[p]) {
      d[i] = 22; d[i + 1] = 163; d[i + 2] = 74; d[i + 3] = 255;
    } else if (removedBold[p]) {
      d[i] = 220; d[i + 1] = 38; d[i + 2] = 38; d[i + 3] = 255;
    } else if (nm[p]) {
      d[i] = 120; d[i + 1] = 128; d[i + 2] = 140; d[i + 3] = 110;
    } else {
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);

  // Cells with enough changed pixels, merged into connected groups.
  const minHits = Math.max(6, (CELL * CELL) / 200);
  const on = new Uint8Array(cols * rows);
  for (let c = 0; c < on.length; c++) on[c] = cellHits[c] >= minHits ? 1 : 0;
  const seen = new Uint8Array(cols * rows);
  const regions: ChangeRegion[] = [];
  for (let c = 0; c < on.length; c++) {
    if (!on[c] || seen[c]) continue;
    let minX = cols, minY = rows, maxX = 0, maxY = 0, count = 0;
    const stack = [c];
    seen[c] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      count++;
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
      // 2-cell reach so nearby edits merge into one cloud.
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nc = ny * cols + nx;
          if (on[nc] && !seen[nc]) {
            seen[nc] = 1;
            stack.push(nc);
          }
        }
      }
    }
    if (count < 2) continue; // a lone speck is noise, not a revision
    const pad = 0.5;
    regions.push({
      x: Math.max(0, ((minX - pad) * CELL) / w),
      y: Math.max(0, ((minY - pad) * CELL) / h),
      width: Math.min(1, ((maxX - minX + 1 + 2 * pad) * CELL) / w),
      height: Math.min(1, ((maxY - minY + 1 + 2 * pad) * CELL) / h),
    });
  }
  regions.sort((a, b) => b.width * b.height - a.width * a.height);
  return { canvas: out, regions: regions.slice(0, 40), sameSize: true };
}
