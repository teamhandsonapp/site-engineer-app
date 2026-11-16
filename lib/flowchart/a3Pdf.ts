import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatActualDateRange, formatCardDateRange } from './delay';
import { CHECKLIST_NOTE_FIELDS, fetchChecklistNotesForTasks, type ChecklistNotes } from './checklistNotes';
import type { FlowchartSeriesEdge, FlowchartTask } from './types';
import { longestRun, routeEdge, type Box, type Pt } from './edgeRoute';

// "Download A3 PDF" (Flowchart 2, ⋯ menu): the board drawn as cards + links
// on A3 PORTRAIT pages (2026-11-16, client). Nothing is shrunk to fit: the
// board is cut into column groups (about 6 columns a page) and, if needed,
// row groups, each cut where the fewest links cross, and every page's cards
// and gaps grow to fill the whole sheet — no white space. Links use the same
// right-angle routing as the app; a link to another page becomes "→ p.N".

// A3 portrait in PostScript points (expo-print) and in CSS px (96 dpi) for the layout.
const A3_PT = { width: 1191, height: 842 };
const PW = 1587;
const PH = 1123;
const M = 24;
const HEAD = 54;
const FOOT = 18;
// The canvas's stored grid step (layout.ts: card 205 + gap 26, card 106 + gap 42).
const STEP_X = 231;
const STEP_Y = 148;
// Columns further apart than this start a new page.
const BLOCK_GAP_X = 1000;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Placed {
  task: FlowchartTask;
  x: number;
  y: number;
}

// Tasks never placed on the canvas go in a column to the right (same idea
// as the canvas's own fallback), so nothing is silently left out.
function placeAll(tasks: FlowchartTask[]): Placed[] {
  const placed = tasks.filter((t) => t.manualPositionX != null && t.manualPositionY != null);
  const maxX = placed.length ? Math.max(...placed.map((t) => t.manualPositionX!)) : 0;
  let i = 0;
  return tasks.map((t) =>
    t.manualPositionX != null && t.manualPositionY != null
      ? { task: t, x: t.manualPositionX, y: t.manualPositionY }
      : { task: t, x: maxX + STEP_X * 2, y: STEP_Y * i++ }
  );
}

function splitIntoBlocks(items: Placed[]): Placed[][] {
  const xs = [...new Set(items.map((p) => p.x))].sort((a, b) => a - b);
  const blocks: number[][] = [];
  for (const x of xs) {
    const last = blocks[blocks.length - 1];
    if (last && x - last[last.length - 1] <= BLOCK_GAP_X) last.push(x);
    else blocks.push([x]);
  }
  return blocks.map((bx) => items.filter((p) => bx.includes(p.x)));
}

// Per A3 portrait page: up to MAX_COLS board columns and MAX_ROWS rows, cut
// where the fewest links cross. Fewer columns = bigger cards.
const MAX_COLS = 6;
const MIN_COLS = 4;
const MAX_ROWS = 10;
const MIN_ROWS = 8;

// Grid index -> consecutive index, skipping indexes nobody uses (the empty
// rows/columns between groups on the board would otherwise print as blank space).
function squeeze(indexes: number[]): (i: number) => number {
  const order = new Map([...new Set(indexes)].sort((a, b) => a - b).map((v, i) => [v, i]));
  return (i) => order.get(i) ?? 0;
}

// Splits 0..total-1 into ranges of at most max, cutting after the index with
// the fewest crossing links (never shorter than min unless it's the end).
function chunk(total: number, max: number, min: number, cuts: (afterIndex: number) => number): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  while (start < total) {
    let end = total - 1;
    if (total - start > max) {
      end = start + max - 1;
      let best = cuts(end);
      for (let r = start + max - 2; r >= start + min - 1; r--) {
        const c = cuts(r);
        if (c < best) {
          best = c;
          end = r;
        }
      }
    }
    out.push([start, end]);
    start = end + 1;
  }
  return out;
}

interface PageSpec {
  items: Placed[];
  colOf: (x: number) => number;
  rowOf: (y: number) => number; // row within this page
  nCols: number;
  nRows: number;
}

function paginate(blocks: Placed[][], edges: FlowchartSeriesEdge[]): PageSpec[] {
  const pages: PageSpec[] = [];
  for (const block of blocks) {
    const minX = Math.min(...block.map((p) => p.x));
    const minY = Math.min(...block.map((p) => p.y));
    const colSq = squeeze(block.map((p) => Math.round((p.x - minX) / STEP_X)));
    const rowSq = squeeze(block.map((p) => Math.round((p.y - minY) / STEP_Y)));
    const colAbs = (x: number) => colSq(Math.round((x - minX) / STEP_X));
    const rowAbs = (y: number) => rowSq(Math.round((y - minY) / STEP_Y));
    const colOfTask = new Map(block.map((p) => [p.task.id, colAbs(p.x)]));
    const rowOfTask = new Map(block.map((p) => [p.task.id, rowAbs(p.y)]));
    const crossing = (of: Map<string, number>) => (r: number) =>
      edges.filter((e) => {
        const a = of.get(e.dependsOnTaskId);
        const b = of.get(e.taskId);
        return a != null && b != null && Math.min(a, b) <= r && Math.max(a, b) > r;
      }).length;
    const nColsAll = Math.max(...block.map((p) => colAbs(p.x))) + 1;
    const nRowsAll = Math.max(...block.map((p) => rowAbs(p.y))) + 1;
    for (const [c0, c1] of chunk(nColsAll, MAX_COLS, MIN_COLS, crossing(colOfTask))) {
      const inCols = block.filter((p) => colAbs(p.x) >= c0 && colAbs(p.x) <= c1);
      if (!inCols.length) continue;
      for (const [r0, r1] of chunk(nRowsAll, MAX_ROWS, MIN_ROWS, crossing(rowOfTask))) {
        const items = inCols.filter((p) => rowAbs(p.y) >= r0 && rowAbs(p.y) <= r1);
        if (!items.length) continue;
        // Only the rows/columns this page actually uses, so the page has no empty bands.
        const pc = squeeze(items.map((p) => colAbs(p.x)));
        const pr = squeeze(items.map((p) => rowAbs(p.y)));
        const colOf = (x: number) => pc(colAbs(x));
        const rowOf = (y: number) => pr(rowAbs(y));
        pages.push({
          items,
          colOf,
          rowOf,
          nCols: Math.max(...items.map((p) => colOf(p.x))) + 1,
          nRows: Math.max(...items.map((p) => rowOf(p.y))) + 1,
        });
      }
    }
  }
  return pages;
}

// Same wheel as the board's card icon (components/flowchart/ChecklistWheel.tsx):
// 6 dots for the 6 client-checklist points, filled in each point's colour when
// it has something written. '' when the task has no checklist data at all.
function checklistWheelSvg(notes: ChecklistNotes | undefined, size: number): string {
  if (!notes) return '';
  const on = CHECKLIST_NOTE_FIELDS.map((f) => !!notes[f.key]?.trim());
  if (!on.some(Boolean)) return '';
  const c = 12, R = 9, ink = '#111827';
  let spokes = '';
  let dots = '';
  CHECKLIST_NOTE_FIELDS.forEach((f, i) => {
    const a = (-90 + (i * 360) / CHECKLIST_NOTE_FIELDS.length) * (Math.PI / 180);
    const x = (c + R * Math.cos(a)).toFixed(2), y = (c + R * Math.sin(a)).toFixed(2);
    spokes += `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="${ink}" stroke-width="1.3"/>`;
    dots += on[i]
      ? `<circle cx="${x}" cy="${y}" r="2.9" fill="${f.color}" stroke="#fff" stroke-width="0.8"/>`
      : `<circle cx="${x}" cy="${y}" r="1.9" fill="#fff" stroke="${ink}" stroke-width="1.3"/>`;
  });
  return `<svg class="wheel" width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${ink}" stroke-width="1.3"/>${spokes}<circle cx="${c}" cy="${c}" r="3" fill="#fff" stroke="${ink}" stroke-width="1.3"/>${dots}</svg>`;
}

function pageHtml(
  spec: PageSpec,
  edges: FlowchartSeriesEdge[],
  header: string,
  pageNo: number,
  pageCount: number,
  pageOf: Map<string, number>,
  nameOf: Map<string, string>,
  notesOf: Map<string, ChecklistNotes>
): string {
  const { items, colOf, rowOf, nCols, nRows } = spec;
  const TOP = M + HEAD + 16;
  // Columns and rows always share out the WHOLE page (no white space); cards
  // keep a sensible shape and the extra goes into the gaps between them.
  // A page with only a few columns keeps normal-size cards, centred.
  const colW = (PW - 2 * M) / Math.max(nCols, MAX_COLS);
  const offX = 0;
  const rowH = (PH - TOP - M - FOOT) / Math.max(nRows, 6);
  const GAP_X = Math.max(22, colW * 0.14);
  const CW = colW - GAP_X;
  const CH = Math.max(70, Math.min(rowH - 30, CW * 0.62, 170));
  const padY = (rowH - CH) / 2;
  // Text grows with the card, limited by the card width.
  const nameFs = Math.max(9, Math.min(CH * 0.14, CW * 0.075, 15));
  const chipFs = Math.max(7.5, Math.min(nameFs * 0.8, 11));
  const deptFs = Math.max(7, nameFs * 0.78);

  const pos = new Map(items.map((p) => [p.task.id, { x: M + offX + colOf(p.x) * colW + GAP_X / 2, y: TOP + rowOf(p.y) * rowH + padY }]));
  const boxes: Box[] = items.map((p) => ({ id: p.task.id, x: pos.get(p.task.id)!.x, y: pos.get(p.task.id)!.y, w: CW, h: CH }));
  const boxOf = new Map(boxes.map((b) => [b.id, b]));
  const gaps = { gapBelow: Math.min(padY, 14), gapAbove: Math.min(padY + 8, 34), colGap: GAP_X / 2 };

  const cards = items
    .map(({ task: t }) => {
      const p = pos.get(t.id)!;
      const actual = formatActualDateRange(t.actualStartDate, t.actualEndDate);
      const wheel = checklistWheelSvg(notesOf.get(t.id), Math.max(12, Math.min(CH * 0.2, 18)));
      return `<div class="card" style="left:${p.x}px;top:${p.y}px;width:${CW}px;height:${CH}px">${wheel}
  <div class="chips" style="font-size:${chipFs}px"><span class="chip plan">${esc(formatCardDateRange(t.plannedStartDate, t.dueDate))}</span>${actual ? `<span class="chip act">${esc(actual)}</span>` : ''}</div>
  <div class="name" style="font-size:${nameFs}px;line-height:${nameFs * 1.17}px">${esc(t.taskName.trim())}</div>
  ${t.workName && t.workName !== 'Unassigned' ? `<div class="dept" style="font-size:${deptFs}px;line-height:${deptFs * 1.2}px">${esc(t.workName)}</div>` : ''}
</div>${t.sectionTitle ? `<div class="title" style="left:${p.x}px;top:${p.y - 20}px">${esc(t.sectionTitle)}</div>` : ''}`;
    })
    .join('');

  // Straight centre-to-centre lines (same as the app); the arrow tip stops at
  // the target card's edge. Labels for non-FS links sit in the gap, on top.
  // A link to a card on another page becomes a small "→ name · p.N" note.
  let lines = '';
  let labels = '';
  // Links to/from cards on another page: ONE note per card and direction
  // ("→ p.2: A, B"), so several notes never pile on top of each other.
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const e of edges) {
    const a = pos.get(e.dependsOnTaskId);
    const b = pos.get(e.taskId);
    if (a && !b && pageOf.has(e.taskId)) {
      add(outgoing, e.dependsOnTaskId, `p.${pageOf.get(e.taskId)}: ${nameOf.get(e.taskId)}`);
      continue;
    }
    if (b && !a && pageOf.has(e.dependsOnTaskId)) {
      add(incoming, e.taskId, `p.${pageOf.get(e.dependsOnTaskId)}: ${nameOf.get(e.dependsOnTaskId)}`);
      continue;
    }
    if (!a || !b) continue;
    const route: Pt[] = routeEdge(boxOf.get(e.dependsOnTaskId)!, boxOf.get(e.taskId)!, boxes, gaps);
    const tip = route[route.length - 1];
    const prev = route[route.length - 2];
    const len = Math.hypot(prev.x - tip.x, prev.y - tip.y) || 1;
    const ux = (prev.x - tip.x) / len, uy = (prev.y - tip.y) / len;
    const backX = tip.x + ux * 8, backY = tip.y + uy * 8;
    const pts = [...route.slice(0, -1), { x: backX, y: backY }].map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
    const dash = e.type === 'SF' ? ' stroke-dasharray="6,4"' : e.type === 'FF' ? ' stroke-dasharray="1.5,3.5" stroke-linecap="round"' : '';
    lines += `<polyline points="${pts}" fill="none" stroke="#D97706" stroke-width="${e.type === 'SS' ? 2.6 : 1.7}"${dash} stroke-linejoin="miter"/>`;
    lines += `<polygon points="${tip.x},${tip.y} ${backX - uy * 3.8},${backY + ux * 3.8} ${backX + uy * 3.8},${backY - ux * 3.8}" fill="#D97706"/>`;
    if (e.type !== 'FS') {
      const run = longestRun(route);
      const lx = (run.from.x + run.to.x) / 2, ly = (run.from.y + run.to.y) / 2;
      labels += `<rect x="${lx - 11}" y="${ly - 7.5}" width="22" height="15" rx="3" fill="#fff" stroke="#C2410C" stroke-width="1"/><text x="${lx}" y="${ly + 3.5}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#9A3412">${e.type}</text>`;
    }
  }

  const notes: string[] = [];
  for (const [id, list] of outgoing) {
    const a = pos.get(id)!;
    notes.push(`<div class="xref" style="left:${a.x}px;top:${a.y + CH + 1}px;width:${CW}px">→ ${esc(list.join(', '))}</div>`);
  }
  for (const [id, list] of incoming) {
    const b = pos.get(id)!;
    // Beside the stack heading when the card has one, so the two don't overlap.
    const title = items.find((it) => it.task.id === id)?.task.sectionTitle;
    const shift = title ? Math.min(CW * 0.6, title.length * 6.6 + 24) : 0;
    notes.push(`<div class="xref" style="left:${b.x + shift}px;top:${b.y - (title ? 18 : 13)}px;width:${CW - shift}px;text-align:${title ? 'left' : 'center'}">← ${esc(list.join(', '))}</div>`);
  }

  const today = new Date();
  return `<div class="page">
  <div class="head">
    <div><h1>${esc(header)}</h1><div class="sub">${items.length} task${items.length === 1 ? '' : 's'} on this page${pageCount > 1 ? ` · Page ${pageNo} of ${pageCount}` : ''}</div></div>
    <div class="legend"><span class="chip plan">Planned</span><span class="chip act">Actual</span><span>→ Finish-to-Start</span><span><b style="color:#9A3412">SS</b> Start-to-Start</span></div>
  </div>
  <svg width="${PW}" height="${PH}">${lines}</svg>
  ${cards}
  ${notes.join('')}
  <svg class="top" width="${PW}" height="${PH}">${labels}</svg>
  <div class="foot"><span>PMC Portal · A3 landscape</span><span>Generated ${today.getDate()} ${MON[today.getMonth()]} ${today.getFullYear()}</span></div>
</div>`;
}

export function buildFlowchartA3Html(
  tasks: FlowchartTask[],
  edges: FlowchartSeriesEdge[],
  title: string,
  notesOf: Map<string, ChecklistNotes> = new Map()
): string {
  const specs = paginate(splitIntoBlocks(placeAll(tasks)).filter((b) => b.length > 0), edges);
  const pageOf = new Map<string, number>();
  specs.forEach((s, i) => s.items.forEach((p) => pageOf.set(p.task.id, i + 1)));
  const nameOf = new Map(tasks.map((t) => [t.id, t.taskName.trim()]));
  const pages = specs.map((s, i) => pageHtml(s, edges, title, i + 1, specs.length, pageOf, nameOf, notesOf)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: A3 landscape; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #1F2937; }
  .page { width: ${PW}px; height: ${PH}px; position: relative; overflow: hidden; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .head { position: absolute; left: ${M}px; right: ${M}px; top: ${M - 6}px; height: ${HEAD - 10}px; border-bottom: 1.5px solid #0F1F33; display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 6px; }
  .head h1 { margin: 0; font-size: 18px; color: #0F1F33; }
  .head .sub { font-size: 9.5px; color: #4B5563; margin-top: 2px; }
  .legend { font-size: 9px; color: #374151; display: flex; gap: 12px; align-items: center; }
  .legend .chip { font-size: 9px; }
  svg { position: absolute; left: 0; top: 0; }
  svg.top { z-index: 3; }
  svg.wheel { left: auto; top: 3px; right: 3px; }
  .card { position: absolute; background: #FFFFFF; border: 1.3px solid #1F2937; border-radius: 8px; padding: 2px 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; text-align: center; }
  .chips { display: flex; gap: 2px 3px; justify-content: center; flex-wrap: wrap; margin-bottom: 2px; }
  .chip { border-radius: 8px; padding: 0 6px; font-size: inherit; line-height: 1.3; font-weight: 700; white-space: nowrap; }
  .chip.plan { background: #FEF08A; color: #713F12; }
  .chip.act { background: #FCA5A5; color: #7F1D1D; }
  .name { font-size: 8.3px; line-height: 9.7px; font-weight: 700; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .dept { font-size: 6.6px; line-height: 7.6px; font-style: italic; color: #4B5563; }
  .title { position: absolute; background: #0F1F33; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px; line-height: 13px; z-index: 2; }
  .xref { position: absolute; font-size: 7.5px; line-height: 11px; color: #9A3412; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 2; }
  .foot { position: absolute; left: ${M}px; right: ${M}px; bottom: ${M - 14}px; font-size: 8px; color: #6B7280; display: flex; justify-content: space-between; }
</style></head><body>${pages}</body></html>`;
}

const SAVE_DIR_KEY = 'flowchartA3:pdfSaveDirectoryUri';

async function pickSaveDirectory(): Promise<string> {
  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) throw new Error('Pick a folder to save the PDF into.');
  await AsyncStorage.setItem(SAVE_DIR_KEY, permissions.directoryUri);
  return permissions.directoryUri;
}

function friendlyDirLabel(treeUri: string): string {
  const encoded = treeUri.split('/tree/')[1];
  if (!encoded) return 'the folder you selected';
  return decodeURIComponent(encoded).replace(/^primary:/, 'Internal storage/').replace(/:/g, '/');
}

// Returns a short note for the screen ('' when the share sheet handled it).
export async function downloadFlowchartA3Pdf(tasks: FlowchartTask[], edges: FlowchartSeriesEdge[], title: string): Promise<string> {
  if (tasks.length === 0) throw new Error('No tasks to put in the PDF.');
  // Client-checklist notes for the wheel icon; the PDF still prints without them.
  const notes = await fetchChecklistNotesForTasks(tasks.map((t) => t.id)).catch(() => new Map<string, ChecklistNotes>());
  const html = buildFlowchartA3Html(tasks, edges, title, notes);
  const fileName = title.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/_+$/, '') + '_A3';

  if (Platform.OS === 'web') {
    // Web has no PDF writer: open the A3 pages and the print dialog ("Save as PDF").
    const w = window.open('', '_blank');
    if (!w) throw new Error('Allow pop-ups for this site to open the PDF.');
    w.document.open();
    w.document.write(html.replace('</body>', '<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script></body>'));
    w.document.close();
    return 'Choose "Save as PDF", paper size A3 and Landscape in the print window.';
  }
  if (Platform.OS === 'android') {
    const { base64 } = await Print.printToFileAsync({ html, base64: true, ...A3_PT });
    if (!base64) throw new Error('Could not create the PDF.');
    let directoryUri = (await AsyncStorage.getItem(SAVE_DIR_KEY)) ?? (await pickSaveDirectory());
    let destUri: string;
    try {
      destUri = await FileSystem.StorageAccessFramework.createFileAsync(directoryUri, fileName, 'application/pdf');
    } catch {
      directoryUri = await pickSaveDirectory();
      destUri = await FileSystem.StorageAccessFramework.createFileAsync(directoryUri, fileName, 'application/pdf');
    }
    await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return `A3 PDF saved to ${friendlyDirLabel(directoryUri)}`;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false, ...A3_PT });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  return '';
}
