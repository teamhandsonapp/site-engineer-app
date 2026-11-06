import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TAG_STATUS_COLOR, type TagDTO } from '../../lib/drawings/types';
import { compareRevisions, renderPage, tintCanvas, type ChangeRegion, type CompareResult } from './pdfRender.web';

export interface PdfRef {
  versionId: string;
  url: string;
}

export interface OverlayLayer extends PdfRef {
  key: string; // overlay drawing id
  color: string;
}

export interface CompareInfo {
  olderVersionId: string;
  newerVersionId: string;
  regions: number;
  sameSize: boolean;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 10;
// Two render resolutions: normal, and a sharper one once zoomed in.
// Lower than the web's 2400 / 4200 so a phone browser never holds a
// 50 MB canvas per layer (Flowchart crash lesson). Same behaviour otherwise.
const RES_NORMAL = 1600;
const RES_SHARP = 3000;

// Puts an already-rendered canvas element into the page.
function CanvasHost({ canvas, style }: { canvas: HTMLCanvasElement | null; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !canvas) return;
    host.replaceChildren(canvas);
    return () => {
      if (canvas.parentNode === host) host.removeChild(canvas);
    };
  }, [canvas]);
  return <div ref={ref} className="absolute inset-0 pointer-events-none [&>canvas]:block [&>canvas]:w-full [&>canvas]:h-full" style={style} />;
}

const tintCache = new Map<string, Promise<HTMLCanvasElement>>();
const compareCache = new Map<string, Promise<CompareResult>>();

export function DrawingCanvas({
  base,
  showBase,
  compareWith,
  overlays,
  page,
  tags,
  selectedTagId,
  onSelectTag,
  tagMode,
  onBoxDrawn,
  onCompareInfo,
  draftBox,
}: {
  base: PdfRef | null;
  showBase: boolean;
  compareWith: PdfRef | null; // older revision to diff against
  overlays: OverlayLayer[]; // only the visible ones
  page: number;
  tags: TagDTO[];
  selectedTagId: string | null;
  onSelectTag: (id: string | null) => void;
  tagMode: boolean;
  onBoxDrawn: (box: Box) => void;
  onCompareInfo: (info: CompareInfo) => void;
  draftBox: Box | null; // box waiting in the tag dialog
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 900, h: 600 });
  // Zoom and pan live together so one update can change both atomically.
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const zoom = view.zoom;
  const [res, setRes] = useState(RES_NORMAL);
  // Render results are stored with the inputs they were made for, so
  // "loading" and "stale" are derived instead of reset inside effects. A
  // result for the same sheet/page at another resolution keeps showing
  // while the sharper one renders, so zooming never blanks the sheet.
  const baseKey = base ? `${base.versionId}:${page}` : null;
  const [baseResult, setBaseResult] = useState<{ key: string; res: number; canvas: HTMLCanvasElement } | null>(null);
  const compareKey = base && compareWith ? `${compareWith.versionId}>${base.versionId}:${page}` : null;
  const [compareResult, setCompareResult] = useState<{ key: string; res: number; result: CompareResult } | null>(null);
  const [overlayCanvases, setOverlayCanvases] = useState<Record<string, HTMLCanvasElement>>({});
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [drawing, setDrawing] = useState<Box | null>(null);
  const fittedFor = useRef<string | null>(null);

  const baseCanvas = baseResult && baseResult.key === baseKey ? baseResult.canvas : null;
  const compare = compareResult && compareResult.key === compareKey ? compareResult.result : null;
  const wantKey = compareKey ?? baseKey;
  const error = failure && failure.key === wantKey ? failure.message : null;
  const loading =
    !error &&
    ((!!baseKey && (!baseResult || baseResult.key !== baseKey || baseResult.res !== res)) ||
      (!!compareKey && (!compareResult || compareResult.key !== compareKey || compareResult.res !== res)));

  const aspect = baseCanvas ? baseCanvas.height / baseCanvas.width : 0.7;
  const stageW = vp.w;
  const stageH = vp.w * aspect;

  // Track viewport size.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setVp({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Switch to the sharper render once zoomed in (debounced).
  useEffect(() => {
    const want = zoom * (typeof window !== 'undefined' ? window.devicePixelRatio : 1) * vp.w > RES_NORMAL * 1.15 ? RES_SHARP : RES_NORMAL;
    if (want === res) return;
    const t = setTimeout(() => setRes(want), 250);
    return () => clearTimeout(t);
  }, [zoom, vp.w, res]);

  const baseVersionId = base?.versionId;
  const baseUrl = base?.url;
  const olderVersionId = compareWith?.versionId;
  const olderUrl = compareWith?.url;

  // Base sheet.
  useEffect(() => {
    if (!baseKey || !baseVersionId || !baseUrl) return;
    let live = true;
    renderPage(baseVersionId, baseUrl, page, res)
      .then((canvas) => live && setBaseResult({ key: baseKey, res, canvas }))
      .catch(() => live && setFailure({ key: baseKey, message: 'Could not open this PDF. The link may have expired — reload the page.' }));
    return () => {
      live = false;
    };
  }, [baseKey, baseVersionId, baseUrl, page, res]);

  // Revision comparison.
  useEffect(() => {
    if (!compareKey || !baseVersionId || !baseUrl || !olderVersionId || !olderUrl) return;
    let live = true;
    const cacheKey = `${compareKey}:${res}`;
    let p = compareCache.get(cacheKey);
    if (!p) {
      p = Promise.all([renderPage(olderVersionId, olderUrl, page, res), renderPage(baseVersionId, baseUrl, page, res)]).then(
        ([older, newer]) => compareRevisions(older, newer)
      );
      p.catch(() => compareCache.delete(cacheKey));
      compareCache.set(cacheKey, p);
    }
    p.then((result) => {
      if (!live) return;
      setCompareResult({ key: compareKey, res, result });
      onCompareInfo({ olderVersionId, newerVersionId: baseVersionId, regions: result.regions.length, sameSize: result.sameSize });
    }).catch(() => live && setFailure({ key: compareKey, message: 'Could not compare these revisions.' }));
    return () => {
      live = false;
    };
  }, [compareKey, baseVersionId, baseUrl, olderVersionId, olderUrl, page, res, onCompareInfo]);


  // Consultant layers, tinted.
  const overlayKey = overlays.map((o) => `${o.key}:${o.versionId}:${o.color}`).join('|');
  useEffect(() => {
    let live = true;
    Promise.all(
      overlays.map(async (o) => {
        const key = `${o.versionId}:${page}:${res}:${o.color}`;
        let p = tintCache.get(key);
        if (!p) {
          p = renderPage(o.versionId, o.url, page, res).then((c) => tintCanvas(c, o.color));
          p.catch(() => tintCache.delete(key));
          tintCache.set(key, p);
        }
        return [o.key, await p.catch(() => null)] as const;
      })
    ).then((entries) => {
      if (!live) return;
      const next: Record<string, HTMLCanvasElement> = {};
      for (const [k, c] of entries) if (c) next[k] = c;
      setOverlayCanvases(next);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey, page, res]);

  const fit = useCallback(() => {
    const z = Math.min(1, (vp.h - 16) / stageH);
    setView({ zoom: z, x: (vp.w - stageW * z) / 2, y: Math.max(8, (vp.h - stageH * z) / 2) });
  }, [vp.w, vp.h, stageW, stageH]);

  // Fit once per sheet/page when it first appears.
  useEffect(() => {
    if (!baseCanvas || !base) return;
    const k = `${base.versionId}:${page}:${vp.w > 0}`;
    if (fittedFor.current === k) return;
    fittedFor.current = k;
    fit();
  }, [baseCanvas, base, page, fit, vp.w]);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      setView((v) => {
        const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
        return { zoom: nz, x: cx - ((cx - v.x) / v.zoom) * nz, y: cy - ((cy - v.y) / v.zoom) * nz };
      });
    },
    []
  );

  // Wheel / trackpad: zoom around the cursor.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  function toFraction(clientX: number, clientY: number) {
    const r = stageRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if (tagMode && baseCanvas) {
      e.preventDefault();
      const start = toFraction(e.clientX, e.clientY);
      let box: Box = { ...start, width: 0, height: 0 };
      setDrawing(box);
      const move = (ev: PointerEvent) => {
        const p = toFraction(ev.clientX, ev.clientY);
        box = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) };
        setDrawing(box);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDrawing(null);
        // Ignore accidental taps: needs to be at least ~12 screen px each way.
        const r = stageRef.current!.getBoundingClientRect();
        if (box.width * r.width >= 12 && box.height * r.height >= 12) onBoxDrawn(box);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    // Pan. Window listeners (not pointer capture) so a click on a tag
    // still reaches the tag when the pointer didn't move.
    const sx = e.clientX;
    const sy = e.clientY;
    const start = view;
    let moved = false;
    const onTag = (e.target as HTMLElement).closest('[data-tag]');
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      setView({ ...start, x: start.x + dx, y: start.y + dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved && !onTag) onSelectTag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const inv = 1 / zoom;
  const regions: ChangeRegion[] = compare?.regions ?? [];
  const pct = (n: number) => `${n * 100}%`;

  return (
    <div
      ref={viewportRef}
      onPointerDown={onPointerDown}
      className={`relative w-full h-full overflow-hidden select-none touch-none bg-[#EEF1F5] ${tagMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
    >
      {!base && (
        <div className="absolute inset-0 grid place-items-center text-[13px] text-gray-500">No PDF uploaded for this sheet yet.</div>
      )}

      {base && (
        <div
          ref={stageRef}
          className="absolute left-0 top-0 bg-white shadow-[0_1px_4px_rgba(15,23,42,.18)]"
          style={{ width: stageW, height: stageH, transform: `translate(${view.x}px, ${view.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
        >
          {compare ? (
            <CanvasHost canvas={compare.canvas} />
          ) : (
            <CanvasHost canvas={baseCanvas} style={{ opacity: showBase ? 1 : 0.08 }} />
          )}
          {!compare &&
            overlays.map((o) => <CanvasHost key={o.key} canvas={overlayCanvases[o.key] ?? null} style={{ mixBlendMode: 'multiply' }} />)}

          {regions.map((r, i) => (
            <div
              key={i}
              className="absolute pointer-events-none"
              style={{
                left: pct(r.x),
                top: pct(r.y),
                width: pct(r.width),
                height: pct(r.height),
                border: `${2 * inv}px dashed #DC2626`,
                borderRadius: 10 * inv,
              }}
            >
              <span
                className="absolute font-mono font-semibold text-white bg-red-600 rounded whitespace-nowrap"
                style={{ fontSize: 11 * inv, padding: `${1 * inv}px ${5 * inv}px`, top: -18 * inv, left: 0 }}
              >
                △ {i + 1}
              </span>
            </div>
          ))}

          {tags.map((t) => {
            const color = TAG_STATUS_COLOR[t.statusKind];
            const sel = t.id === selectedTagId;
            return (
              <button
                key={t.id}
                type="button"
                data-tag
                aria-label={`${t.name}`}
                onClick={(e) => {
                  if (tagMode) return;
                  e.stopPropagation();
                  onSelectTag(t.id);
                }}
                className="absolute text-left focus-visible:outline-none"
                style={{
                  left: pct(t.x),
                  top: pct(t.y),
                  width: pct(t.width),
                  height: pct(t.height),
                  border: `${(sel ? 3.5 : 2.5) * inv}px ${sel ? 'solid' : 'dashed'} ${color}`,
                  borderRadius: 5 * inv,
                  background: sel ? `${color}22` : `${color}0D`,
                  pointerEvents: tagMode ? 'none' : 'auto',
                }}
              >
                <span
                  className="absolute left-0 font-mono font-semibold text-white rounded whitespace-nowrap max-w-none"
                  style={{
                    background: color,
                    fontSize: 11 * inv,
                    padding: `${2 * inv}px ${6 * inv}px`,
                    bottom: '100%',
                    marginBottom: 3 * inv,
                  }}
                >
                  {t.name.length > 28 ? `${t.name.slice(0, 27)}…` : t.name}
                </span>
              </button>
            );
          })}

          {(drawing ?? draftBox) && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: pct((drawing ?? draftBox)!.x),
                top: pct((drawing ?? draftBox)!.y),
                width: pct((drawing ?? draftBox)!.width),
                height: pct((drawing ?? draftBox)!.height),
                border: `${2 * inv}px dashed #F0A227`,
                background: 'rgba(240,162,39,.18)',
              }}
            />
          )}
        </div>
      )}

      {(loading || error) && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg text-[12px] font-medium shadow bg-white border border-gray-200">
          {error ? <span className="text-red-600">{error}</span> : <span className="text-gray-600">Rendering drawing…</span>}
        </div>
      )}

      {base && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-sm p-1" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="w-8 h-8 rounded-md hover:bg-gray-100 text-[16px] font-semibold" onClick={() => zoomAt(1 / 1.3, vp.w / 2, vp.h / 2)} aria-label="Zoom out">−</button>
          <span className="w-12 text-center text-[12px] font-mono text-gray-600 tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" className="w-8 h-8 rounded-md hover:bg-gray-100 text-[16px] font-semibold" onClick={() => zoomAt(1.3, vp.w / 2, vp.h / 2)} aria-label="Zoom in">+</button>
          <button type="button" className="h-8 px-2 rounded-md hover:bg-gray-100 text-[12px] font-medium" onClick={fit}>Fit</button>
        </div>
      )}
    </div>
  );
}
