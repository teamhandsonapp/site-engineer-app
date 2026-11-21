import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatActualDateRange, formatCardDateRange } from './delay';
import { CHECKLIST_NOTE_FIELDS, fetchChecklistNotesForTasks, type ChecklistNotes } from './checklistNotes';
import type { FlowchartSeriesEdge, FlowchartTask } from './types';
import { longestRun, routeEdge, type Box, type Pt } from './edgeRoute';
import { computeProjectedDates, shouldShowProjected } from './projected';
import { FLOWCHART_2_GROUPS } from './boardGroups';

// "Download A3 PDF" (Flowchart 2, ⋯ menu): the board drawn as cards + links
// on A3 PORTRAIT pages (2026-11-16, client). Nothing is shrunk to fit: the
// board is cut into column groups (about 6 columns a page) and, if needed,
// row groups, each cut where the fewest links cross, and every page's cards
// and gaps grow to fill the whole sheet — no white space. Links use the same
// right-angle routing as the app; a link to another page becomes "→ p.N".

// A3 portrait in PostScript points (expo-print) and in CSS px (96 dpi) for the layout.
const A3_PT = { width: 842, height: 1191 };
const PW = 1123;
const PH = 1587;
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

// `stacks`: the Past Tasks stacks (the part above the Current Status copy) —
// printed with normal-size cards, cut across pages when the stack is tall.
interface Block {
  items: Placed[];
  stacks: boolean;
}

function splitIntoBlocks(items: Placed[], splitAtRowGap = false): Block[] {
  // splitAtRowGap (Past Tasks): a stored vertical gap of 1500+ (the Current
  // Status copy below the stacks) also starts new pages.
  const parts = splitAtRowGap ? splitByGap(items, (p) => p.y, (gap) => gap < 1500) : [items];
  return parts.flatMap((part, i) =>
    splitByGap(part, (p) => p.x, (gap) => gap <= BLOCK_GAP_X).map((b) => ({ items: b, stacks: splitAtRowGap && i === 0 }))
  );
}

function splitByGap(items: Placed[], at: (p: Placed) => number, together: (gap: number) => boolean): Placed[][] {
  const vs = [...new Set(items.map(at))].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of vs) {
    const last = groups[groups.length - 1];
    if (last && together(v - last[last.length - 1])) last.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => items.filter((p) => g.includes(at(p))));
}

// Per A3 portrait page: up to MAX_COLS board columns and MAX_ROWS rows, cut
// where the fewest links cross. Fewer columns = bigger cards.
// Two A3 portrait sheets (2026-11-16, client): the board's columns split in two halves,
// all rows on each sheet, same card size on both.
const MAX_COLS = 6;
const MIN_COLS = 6;
const MAX_ROWS = 99;
const MIN_ROWS = 99;

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
  /** Past Tasks stacks: normal-size cards (as on a full 6-column page), not stretched. */
  normal: boolean;
}

// Normal card (2026-11-21): the size on a full 6-column page — width from 6
// columns, height 0.62 × width (see pageHtml). A Past Tasks stack page holds
// as many rows as fit at that size; a taller stack is cut across pages,
// split evenly (22 rows → 11 + 11).
const PAGE_TOP = M + HEAD + 16;
const NORMAL_COL_W = (PW - 2 * M) / MAX_COLS;
const NORMAL_CW = NORMAL_COL_W - Math.max(22, NORMAL_COL_W * 0.14);
const NORMAL_CH = NORMAL_CW * 0.62;
const STACK_ROWS = Math.floor((PH - PAGE_TOP - M - FOOT - 24) / (NORMAL_CH + 12));

function paginate(blocks: Block[], edges: FlowchartSeriesEdge[]): PageSpec[] {
  const pages: PageSpec[] = [];
  for (const { items: block, stacks } of blocks) {
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
    const perPage = stacks ? Math.ceil(nRowsAll / Math.ceil(nRowsAll / STACK_ROWS)) : 0;
    const rowChunks = stacks ? chunk(nRowsAll, perPage, perPage, crossing(rowOfTask)) : chunk(nRowsAll, MAX_ROWS, MIN_ROWS, crossing(rowOfTask));
    for (const [c0, c1] of chunk(nColsAll, MAX_COLS, MIN_COLS, crossing(colOfTask))) {
      const inCols = block.filter((p) => colAbs(p.x) >= c0 && colAbs(p.x) <= c1);
      if (!inCols.length) continue;
      for (const [r0, r1] of rowChunks) {
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
          normal: stacks,
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
  notesOf: Map<string, ChecklistNotes>,
  estOf: Map<string, string> = new Map(),
  fillWidth = false,
  codeOf: Map<string, string> = new Map(),
  taskOf: Map<string, FlowchartTask> = new Map()
): string {
  const { items, colOf, rowOf, nCols, nRows, normal } = spec;
  if (normal) fillWidth = false;
  const TOP = PAGE_TOP;
  // Columns and rows always share out the WHOLE page (no white space); cards
  // keep a sensible shape and the extra goes into the gaps between them.
  // A page with only a few columns keeps normal-size cards, centred.
  // fillWidth (Past Tasks stacks): a page of only a few columns uses the
  // whole width instead, so long task names fit on short cards.
  const colW = (PW - 2 * M) / (fillWidth ? Math.max(nCols, 1) : Math.max(nCols, MAX_COLS));
  const offX = 0;
  // Room above every row (but the first) that starts a section, so its dark
  // heading never covers the card above (e.g. Past Tasks "No planned dates").
  const TITLE_ROOM = 24;
  // Page-cut links on the Past Tasks stack pages (2026-11-21, client): the
  // task on the other page is drawn as a normal (faded, dashed) card right
  // below / above its neighbour, joined by the normal arrow and FS/SS label.
  const onPage = new Set(items.map((p) => p.task.id));
  const ghosts: { task: FlowchartTask; col: number; row: number }[] = [];
  if (normal) {
    const rowsInCol = (c: number) => items.filter((p) => colOf(p.x) === c).map((p) => rowOf(p.y));
    const taken = new Set<string>();
    for (const e of edges) {
      const out = onPage.has(e.dependsOnTaskId) && !onPage.has(e.taskId);
      const inc = onPage.has(e.taskId) && !onPage.has(e.dependsOnTaskId);
      const otherId = out ? e.taskId : inc ? e.dependsOnTaskId : null;
      const other = otherId ? taskOf.get(otherId) : undefined;
      if (!other || !pageOf.has(other.id) || ghosts.some((g) => g.task.id === other.id)) continue;
      const here = items.find((p) => p.task.id === (out ? e.dependsOnTaskId : e.taskId))!;
      const col = colOf(here.x);
      const row = out ? Math.max(...rowsInCol(col)) + 1 : Math.min(...rowsInCol(col)) - 1;
      // Only where that spot is free (one per column and side); else it stays a note.
      if (row !== (out ? rowOf(here.y) + 1 : rowOf(here.y) - 1) || taken.has(`${col}:${row}`)) continue;
      taken.add(`${col}:${row}`);
      ghosts.push({ task: other, col, row });
    }
  }
  const rowShift = ghosts.some((g) => g.row < 0) ? 1 : 0;
  const totalRows = Math.max(nRows, ...ghosts.map((g) => g.row + 1)) + rowShift;
  const rowAt = (y: number) => rowOf(y) + rowShift;
  const titledRows = [...new Set(items.filter((p) => p.task.sectionTitle).map((p) => rowAt(p.y)))].filter((r) => r > 0);
  const roomBefore = (r: number) => titledRows.filter((tr) => tr <= r).length * TITLE_ROOM;
  let rowH = (PH - TOP - M - FOOT - titledRows.length * TITLE_ROOM) / Math.max(totalRows, 1);
  const GAP_X = Math.max(22, colW * 0.14);
  const CW = colW - GAP_X;
  const CH = Math.max(36, Math.min(rowH - 12, CW * 0.62, 170));
  // Stack pages: rows stay at the normal spacing (top-aligned), not spread to fill a short last page.
  if (normal) rowH = Math.min(rowH, CH + 12 + 40);
  const padY = (rowH - CH) / 2;
  // Text grows with the card, limited by the card width.
  const nameFs = Math.max(9, Math.min(CH * 0.14, CW * 0.075, 15));
  const chipFs = Math.max(7.5, Math.min(nameFs * 0.8, 11));
  const deptFs = Math.max(7, nameFs * 0.78);
  // Task ID (e.g. "CIV-05"), top-left inside the card like the board (2026-11-19).
  const idFs = Math.max(7.5, Math.min(nameFs * 0.8, 11));

  const at = (col: number, row: number) => ({ x: M + offX + col * colW + GAP_X / 2, y: TOP + row * rowH + roomBefore(row) + padY });
  const pos = new Map(items.map((p) => [p.task.id, at(colOf(p.x), rowAt(p.y))]));
  for (const g of ghosts) pos.set(g.task.id, at(g.col, g.row + rowShift));
  const ghostIds = new Set(ghosts.map((g) => g.task.id));
  const boxes: Box[] = [...pos].map(([id, q]) => ({ id, x: q.x, y: q.y, w: CW, h: CH }));
  const boxOf = new Map(boxes.map((b) => [b.id, b]));
  const gaps = { gapBelow: Math.min(padY, 14), gapAbove: Math.min(padY + 8, 34), colGap: GAP_X / 2 };

  const cardHtml = (t: FlowchartTask, ghost: boolean) => {
      const p = pos.get(t.id)!;
      const actual = formatActualDateRange(t.actualStartDate, t.actualEndDate);
      const wheel = checklistWheelSvg(notesOf.get(t.id), Math.max(12, Math.min(CH * 0.2, 18)));
      const tid = t.taskId?.trim()
        ? `<div class="tid" style="font-size:${idFs}px;line-height:${idFs * 1.2}px;max-width:${CW * 0.6}px">${esc(t.taskId.trim())}</div>`
        : '';
      const onOther = ghost ? `<div class="pg" style="font-size:${idFs}px">on page ${pageOf.get(t.id)}</div>` : '';
      return `<div class="card${ghost ? ' ghost' : ''}" style="left:${p.x}px;top:${p.y}px;width:${CW}px;height:${CH}px;padding-top:${tid ? idFs * 1.2 + 4 : 2}px">${ghost ? '' : wheel}${tid}${onOther}
  <div class="chips" style="font-size:${chipFs}px"><span class="chip plan">${esc(formatCardDateRange(t.plannedStartDate, t.dueDate))}</span>${actual ? `<span class="chip act">${esc(actual)}</span>` : ''}${estOf.get(t.id) ? `<span class="chip est">${esc(estOf.get(t.id)!)}</span>` : ''}</div>
  <div class="name" style="font-size:${nameFs}px;line-height:${nameFs * 1.17}px">${esc(t.taskName.trim())}</div>
  ${t.workName && t.workName !== 'Unassigned' ? `<div class="dept" style="font-size:${deptFs}px;line-height:${deptFs * 1.2}px">${esc(t.workName)}</div>` : ''}
</div>${t.sectionTitle && !ghost ? `<div class="title" style="left:${p.x}px;top:${p.y - 20}px">${esc(t.sectionTitle)}</div>` : ''}`;
  };
  const cards = items.map(({ task: t }) => cardHtml(t, false)).join('') + ghosts.map((g) => cardHtml(g.task, true)).join('');

  // Straight centre-to-centre lines (same as the app); the arrow tip stops at
  // the target card's edge. Labels for non-FS links sit in the gap, on top.
  // A link to a card on another page becomes a small "→ name · p.N" note.
  let lines = '';
  let labels = '';
  // Links to/from cards on another page: ONE note per card and direction
  // ("→ p.2: A, B"), so several notes never pile on top of each other.
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const fromOtherPages: string[] = [];
  const add = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const e of edges) {
    const a = pos.get(e.dependsOnTaskId);
    const b = pos.get(e.taskId);
    // A ghost card only carries the one link it was drawn for.
    if (ghostIds.has(e.dependsOnTaskId) ? !onPage.has(e.taskId) : ghostIds.has(e.taskId) && !onPage.has(e.dependsOnTaskId)) continue;
    // Page-cut links (2026-11-21): link type, task code and page, so the link
    // still reads clearly across the cut, e.g. "FS → CIV-07 Wall No. 5 … (p.3)".
    if (a && !b && pageOf.has(e.taskId)) {
      add(outgoing, e.dependsOnTaskId, `${e.type} → ${[codeOf.get(e.taskId), nameOf.get(e.taskId)].filter(Boolean).join(' ')} (p.${pageOf.get(e.taskId)})`);
      continue;
    }
    if (b && !a && pageOf.has(e.dependsOnTaskId)) {
      const fromCode = codeOf.get(e.dependsOnTaskId) || nameOf.get(e.dependsOnTaskId);
      add(incoming, e.taskId, `${e.type} ← ${fromCode} p.${pageOf.get(e.dependsOnTaskId)}`);
      // Also in the page header, in full: "PT-30 (p.2) → CIV-07, FS".
      fromOtherPages.push(`${fromCode} (p.${pageOf.get(e.dependsOnTaskId)}) → ${codeOf.get(e.taskId) || nameOf.get(e.taskId)}, ${e.type}`);
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
    // Soft links (Past Tasks date order) print like the board: dashed, in their own colour.
    const looksSoft = e.soft && !e.drawAsLink;
    const dash = looksSoft || e.type === 'SF' ? ' stroke-dasharray="6,4"' : e.type === 'FF' ? ' stroke-dasharray="1.5,3.5" stroke-linecap="round"' : '';
    const ink = looksSoft ? (e.color ?? '#9CA3AF') : '#D97706';
    lines += `<polyline points="${pts}" fill="none" stroke="${ink}" stroke-width="${looksSoft ? 2 : e.type === 'SS' ? 2.6 : 1.7}"${dash} stroke-linejoin="miter"/>`;
    lines += `<polygon points="${tip.x},${tip.y} ${backX - uy * 3.8},${backY + ux * 3.8} ${backX + uy * 3.8},${backY - ux * 3.8}" fill="${ink}"/>`;
    if (e.type !== 'FS' && !e.hideLabel) {
      const run = longestRun(route);
      const lx = (run.from.x + run.to.x) / 2, ly = (run.from.y + run.to.y) / 2;
      labels += `<rect x="${lx - 11}" y="${ly - 7.5}" width="22" height="15" rx="3" fill="#fff" stroke="#C2410C" stroke-width="1"/><text x="${lx}" y="${ly + 3.5}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#9A3412">${e.type}</text>`;
    }
  }

  const notes: string[] = [];
  for (const [id, list] of outgoing) {
    const a = pos.get(id)!;
    notes.push(`<div class="xref" style="left:${a.x}px;top:${a.y + CH + 1}px;width:${CW}px">${esc(list.join(' · '))}</div>`);
  }
  for (const [id, list] of incoming) {
    const b = pos.get(id)!;
    // Beside the stack heading when the card has one, so the two don't overlap.
    const title = items.find((it) => it.task.id === id)?.task.sectionTitle;
    // The heading is ~4.9px a letter + padding; the note may run on into the column gap.
    const shift = title ? title.length * 5.3 + 24 : 0;
    const room = title ? CW - shift + GAP_X - 4 : CW;
    notes.push(
      `<div class="xref" style="left:${b.x + shift}px;top:${b.y - (title ? 18 : 13)}px;${title ? `max-width:${room}px;text-align:left` : `width:${CW}px`}">${esc(list.join(' · '))}</div>`
    );
  }

  // Board group outlines (Structural Civil Works, Parallel works …) when the whole group is on this page.
  const groupsHtml = FLOWCHART_2_GROUPS.map((g) => {
    const mine = items.filter((p) => g.taskCodes.includes(p.task.taskId));
    if (mine.length === 0 || mine.length < g.taskCodes.length) return '';
    const ps = mine.map((p) => pos.get(p.task.id)!);
    const l = Math.min(...ps.map((q) => q.x)) - 8, t0 = Math.min(...ps.map((q) => q.y)) - 34;
    const rgt = Math.max(...ps.map((q) => q.x)) + CW + 8, b = Math.max(...ps.map((q) => q.y)) + CH + 8;
    return `<div class="grp" style="left:${l}px;top:${t0}px;width:${rgt - l}px;height:${b - t0}px"><span>${esc(g.label)}</span></div>`;
  }).join('');

  const today = new Date();
  return `<div class="page">
  <div class="head">
    <div><h1>${esc(header)}</h1><div class="sub">${items.length} task${items.length === 1 ? '' : 's'} on this page${pageCount > 1 ? ` · Page ${pageNo} of ${pageCount}` : ''}${
      fromOtherPages.length ? ` · <b style="color:#9A3412">Linked from other pages: ${esc(fromOtherPages.join(' · '))}</b>` : ''
    }</div></div>
    <div class="legend"><span class="chip plan">Planned</span><span class="chip act">Actual</span><span class="chip est">Estimated</span><span>→ Finish-to-Start</span><span><b style="color:#9A3412">SS</b> Start-to-Start</span></div>
  </div>
  <svg width="${PW}" height="${PH}">${lines}</svg>
  ${groupsHtml}
  ${cards}
  ${notes.join('')}
  <svg class="top" width="${PW}" height="${PH}">${labels}</svg>
  <div class="foot"><span>PMC Portal · A3 portrait</span><span>Generated ${today.getDate()} ${MON[today.getMonth()]} ${today.getFullYear()}</span></div>
</div>`;
}

export function buildFlowchartA3Html(
  tasks: FlowchartTask[],
  edges: FlowchartSeriesEdge[],
  title: string,
  notesOf: Map<string, ChecklistNotes> = new Map(),
  opts: { fillWidth?: boolean; splitAtRowGap?: boolean } = {}
): string {
  const specs = paginate(splitIntoBlocks(placeAll(tasks), !!opts.splitAtRowGap).filter((b) => b.items.length > 0), edges);
  const pageOf = new Map<string, number>();
  specs.forEach((s, i) => s.items.forEach((p) => pageOf.set(p.task.id, i + 1)));
  const nameOf = new Map(tasks.map((t) => [t.id, t.taskName.trim()]));
  const codeOf = new Map(tasks.map((t) => [t.id, (t.taskId ?? '').trim()]));
  const taskOf = new Map(tasks.map((t) => [t.id, t]));
  // Estimated (blue) dates, same rule as the board's cards.
  const proj = computeProjectedDates(tasks, edges);
  const linked = new Set(edges.flatMap((e) => [e.taskId, e.dependsOnTaskId]));
  const estOf = new Map<string, string>();
  for (const t of tasks) {
    const p = proj.get(t.id);
    if (shouldShowProjected(t, p, linked.has(t.id))) estOf.set(t.id, formatCardDateRange(p.start, p.end));
  }
  const pages = specs.map((s, i) => pageHtml(s, edges, title, i + 1, specs.length, pageOf, nameOf, notesOf, estOf, !!opts.fillWidth, codeOf, taskOf)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: A3 portrait; margin: 0; }
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
  .tid { position: absolute; top: 4px; left: 8px; font-weight: 800; color: #1F2937; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
  .card { position: absolute; background: #FFFFFF; border: 1.3px solid #1F2937; border-radius: 8px; padding: 2px 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; text-align: center; }
  .chips { display: flex; gap: 2px 3px; justify-content: center; flex-wrap: wrap; margin-bottom: 2px; }
  .chip { border-radius: 8px; padding: 0 6px; font-size: inherit; line-height: 1.3; font-weight: 700; white-space: nowrap; }
  .chip.plan { background: #FEF08A; color: #713F12; }
  .chip.act { background: #FCA5A5; color: #7F1D1D; }
  .grp { position: absolute; border: 2px dashed #0F1F33; border-radius: 12px; z-index: 0; }
  .grp span { position: absolute; top: -11px; left: 12px; background: #F0A227; color: #0F1F33; font-size: 11px; font-weight: 800; padding: 1px 8px; border-radius: 5px; }
  .chip.est { background: #BFDBFE; color: #1E3A8A; }
  .name { font-size: 8.3px; line-height: 9.7px; font-weight: 700; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .dept { font-size: 6.6px; line-height: 7.6px; font-style: italic; color: #4B5563; }
  .title { position: absolute; background: #0F1F33; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px; line-height: 13px; z-index: 2; }
  .xref { position: absolute; font-size: 7.5px; line-height: 11px; color: #9A3412; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 2; }
  .card.ghost { border: 1.3px dashed #6B7280; opacity: 0.7; }
  .card.ghost .pg { position: absolute; top: 4px; right: 8px; font-weight: 700; color: #6B7280; white-space: nowrap; }
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
export async function downloadFlowchartA3Pdf(
  tasks: FlowchartTask[],
  edges: FlowchartSeriesEdge[],
  title: string,
  opts: { fillWidth?: boolean; splitAtRowGap?: boolean } = {}
): Promise<string> {
  if (tasks.length === 0) throw new Error('No tasks to put in the PDF.');
  // Client-checklist notes for the wheel icon; the PDF still prints without them.
  const notes = await fetchChecklistNotesForTasks(tasks.map((t) => t.id)).catch(() => new Map<string, ChecklistNotes>());
  const html = buildFlowchartA3Html(tasks, edges, title, notes, opts);
  const fileName = title.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/_+$/, '') + '_A3';

  if (Platform.OS === 'web') {
    // Web has no PDF writer: open the A3 pages and the print dialog ("Save as PDF").
    const w = window.open('', '_blank');
    if (!w) throw new Error('Allow pop-ups for this site to open the PDF.');
    w.document.open();
    w.document.write(html.replace('</body>', '<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script></body>'));
    w.document.close();
    return 'Choose "Save as PDF", paper size A3 and Portrait in the print window.';
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
