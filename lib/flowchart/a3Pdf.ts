import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatActualDateRange, formatCardDateRange } from './delay';
import type { FlowchartSeriesEdge, FlowchartTask } from './types';

// "Download A3 PDF" (Flowchart 2, ⋯ menu): the board drawn as cards + arrows
// on A3 portrait pages, the same picture as the canvas (stored x/y grid).
// Each separate block of the board (columns far apart, e.g. the West/East
// block on the right) gets its own page so every card stays readable.

// A3 in PostScript points (expo-print) and in CSS px (96 dpi) for the layout.
const A3_PT = { width: 842, height: 1191 };
const PW = 1123;
const PH = 1587;
const M = 22;
const HEAD = 50;
const FOOT = 16;
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

function pageHtml(block: Placed[], edges: FlowchartSeriesEdge[], header: string, pageNo: number, pageCount: number): string {
  const minX = Math.min(...block.map((p) => p.x));
  const minY = Math.min(...block.map((p) => p.y));
  const col = (x: number) => Math.round((x - minX) / STEP_X);
  const row = (y: number) => Math.round((y - minY) / STEP_Y);
  const nCols = Math.max(...block.map((p) => col(p.x))) + 1;
  const nRows = Math.max(...block.map((p) => row(p.y))) + 1;
  // Cards never grow huge on a small block.
  const colW = Math.min((PW - 2 * M) / nCols, 190);
  const rowH = Math.min((PH - 2 * M - HEAD - FOOT) / nRows, 90);
  const CW = colW - 10;
  const CH = Math.min(rowH - 8, 64);

  const pos = new Map(block.map((p) => [p.task.id, { x: M + col(p.x) * colW + 5, y: M + HEAD + row(p.y) * rowH + 4 }]));

  const cards = block
    .map(({ task: t }) => {
      const p = pos.get(t.id)!;
      const actual = formatActualDateRange(t.actualStartDate, t.actualEndDate);
      return `<div class="card" style="left:${p.x}px;top:${p.y}px;width:${CW}px;height:${CH}px">
  <div class="chips"><span class="chip plan">${esc(formatCardDateRange(t.plannedStartDate, t.dueDate))}</span>${actual ? `<span class="chip act">${esc(actual)}</span>` : ''}</div>
  <div class="name">${esc(t.taskName.trim())}</div>
  ${t.workName && t.workName !== 'Unassigned' ? `<div class="dept">${esc(t.workName)}</div>` : ''}
</div>${t.sectionTitle ? `<div class="title" style="left:${p.x}px;top:${p.y - 12}px">${esc(t.sectionTitle)}</div>` : ''}`;
    })
    .join('');

  // Straight centre-to-centre lines (same as the app); the arrow tip stops at
  // the target card's edge. Labels for non-FS links sit in the gap, on top.
  let lines = '';
  let labels = '';
  for (const e of edges) {
    const a = pos.get(e.dependsOnTaskId);
    const b = pos.get(e.taskId);
    if (!a || !b) continue;
    const ax = a.x + CW / 2, ay = a.y + CH / 2, bx = b.x + CW / 2, by = b.y + CH / 2;
    const dx = ax - bx, dy = ay - by;
    const t = Math.min(dx ? (CW / 2 + 1) / Math.abs(dx) : Infinity, dy ? (CH / 2 + 1) / Math.abs(dy) : Infinity);
    const tx = bx + dx * t, ty = by + dy * t;
    const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const backX = tx + ux * 7, backY = ty + uy * 7;
    lines += `<line x1="${ax}" y1="${ay}" x2="${backX}" y2="${backY}" stroke="#D97706" stroke-width="1.4"/>`;
    lines += `<polygon points="${tx},${ty} ${backX - uy * 3.2},${backY + ux * 3.2} ${backX + uy * 3.2},${backY - ux * 3.2}" fill="#D97706"/>`;
    if (e.type !== 'FS') {
      const lx = (ax - dx * t + tx) / 2, ly = (ay - dy * t + ty) / 2;
      labels += `<rect x="${lx - 9}" y="${ly - 6}" width="18" height="12" rx="3" fill="#fff" stroke="#C2410C" stroke-width="1"/><text x="${lx}" y="${ly + 3}" font-size="8" font-weight="700" text-anchor="middle" fill="#9A3412">${e.type}</text>`;
    }
  }

  const today = new Date();
  return `<div class="page">
  <div class="head">
    <div><h1>${esc(header)}</h1><div class="sub">${block.length} task${block.length === 1 ? '' : 's'}${pageCount > 1 ? ` · Page ${pageNo} of ${pageCount}` : ''}</div></div>
    <div class="legend"><span class="chip plan">Planned</span><span class="chip act">Actual</span><span>→ Finish-to-Start</span><span><b style="color:#9A3412">SS</b> Start-to-Start</span></div>
  </div>
  <svg width="${PW}" height="${PH}">${lines}</svg>
  ${cards}
  <svg class="top" width="${PW}" height="${PH}">${labels}</svg>
  <div class="foot"><span>PMC Portal · A3 portrait</span><span>Generated ${today.getDate()} ${MON[today.getMonth()]} ${today.getFullYear()}</span></div>
</div>`;
}

export function buildFlowchartA3Html(tasks: FlowchartTask[], edges: FlowchartSeriesEdge[], title: string): string {
  const blocks = splitIntoBlocks(placeAll(tasks)).filter((b) => b.length > 0);
  const pages = blocks.map((b, i) => pageHtml(b, edges, title, i + 1, blocks.length)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: A3 portrait; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #1F2937; }
  .page { width: ${PW}px; height: ${PH}px; position: relative; overflow: hidden; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .head { position: absolute; left: ${M}px; right: ${M}px; top: ${M - 6}px; height: ${HEAD - 10}px; border-bottom: 1.5px solid #0F1F33; display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 6px; }
  .head h1 { margin: 0; font-size: 17px; color: #0F1F33; }
  .head .sub { font-size: 9.5px; color: #4B5563; margin-top: 2px; }
  .legend { font-size: 9px; color: #374151; display: flex; gap: 12px; align-items: center; }
  .legend .chip { font-size: 8px; }
  svg { position: absolute; left: 0; top: 0; }
  svg.top { z-index: 3; }
  .card { position: absolute; background: #D9C6A5; border: 1px solid #111; border-radius: 7px; padding: 1px 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; text-align: center; }
  .chips { display: flex; gap: 3px; justify-content: center; flex-wrap: nowrap; margin-bottom: 1px; }
  .chip { border-radius: 8px; padding: 0 5px; font-size: 7px; line-height: 9px; font-weight: 700; white-space: nowrap; }
  .chip.plan { background: #FEF08A; color: #713F12; }
  .chip.act { background: #FCA5A5; color: #7F1D1D; }
  .name { font-size: 8.3px; line-height: 9.7px; font-weight: 700; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .dept { font-size: 6.6px; line-height: 7.6px; font-style: italic; color: #4B5563; }
  .title { position: absolute; background: #0F1F33; color: #fff; font-size: 7.5px; font-weight: 800; padding: 1px 6px; border-radius: 4px; line-height: 10px; z-index: 2; }
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
  const html = buildFlowchartA3Html(tasks, edges, title);
  const fileName = title.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/_+$/, '') + '_A3';

  if (Platform.OS === 'web') {
    // Web has no PDF writer: open the A3 pages and the print dialog ("Save as PDF").
    const w = window.open('', '_blank');
    if (!w) throw new Error('Allow pop-ups for this site to open the PDF.');
    w.document.open();
    w.document.write(html.replace('</body>', '<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script></body>'));
    w.document.close();
    return 'Choose "Save as PDF" and paper size A3 in the print window.';
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
