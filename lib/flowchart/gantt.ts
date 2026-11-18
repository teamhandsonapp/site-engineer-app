// Gantt chart for Flowchart 2 (2026-11-17, client). Pure data + drawing maths:
// the screen (components/flowchart/GanttView.tsx) and the shared PDF
// (ganttPdf.ts) both draw from layoutGantt(), so they always match.
//
// Every task row has up to three pieces, like the client's reference Gantt:
//   plan  thin dark line under the bar: the original planned dates
//   done  dark part of the bar: actual dates (start → finish, or start → today while running)
//   left  light part of the bar: projected days still to go (links + today push it later)
// Group rows ("Structural Civil Works" …) get a grey bar, dark grey for the share done.
// Links are drawn like the flowchart's: amber, FS solid, SS double, FF dotted, SF dashed.
// Every day is counted (Sundays included), same as the rest of Flowchart 2.

import type { DependencyType, FlowchartSeriesEdge, FlowchartTask } from './types';
import { addDays, computeProjectedDates, daysBetween } from './projected';
import { FLOWCHART_2_GROUPS } from './boardGroups';
import { delaySplit, formatDelaySplit } from './delaySplit';
import { sheetStatus } from './sheetStatus';
import { EMPTY_CHECKLIST_NOTES, type ChecklistNotes } from './checklistNotes';
import { reasonEntries, type ReportStatus, type SheetReportRow } from './sheetReport';
import { LINK_COLOR } from './linkTypes';

export type GanttTask = Pick<
  FlowchartTask,
  'id' | 'taskId' | 'taskName' | 'workName' | 'plannedStartDate' | 'dueDate' | 'actualStartDate' | 'actualEndDate' | 'expectedStartDate'
>;

export interface DateSpan {
  start: string; // 'YYYY-MM-DD'
  end: string;
}

export interface GanttColor {
  dark: string;
  light: string;
}

// Same feel as the client's reference: salmon red, green, blue, purple.
export const GANTT_COLORS: GanttColor[] = [
  { dark: '#EF6A5A', light: '#F8B6AD' }, // red
  { dark: '#3E8BEF', light: '#ABCBF8' }, // blue
  { dark: '#47B83A', light: '#A9DEA1' }, // green
  { dark: '#8E62EE', light: '#CDB9F9' }, // purple
];
export const GROUP_BAR = { dark: '#9A9994', light: '#DAD9D5' };
export const PLAN_LINE = '#3A3A40';
export const SOFT_LINK = '#9CA3AF';

export interface GanttRow {
  id: string;
  code: string;
  name: string;
  department: string;
  status: ReportStatus;
  plan: DateSpan | null;
  done: DateSpan | null;
  left: DateSpan | null;
  /** The whole coloured bar (done + left); links attach to it. */
  bar: DateSpan | null;
  /** Projected dates (the blue chip on the board), for the detail card. */
  projected: DateSpan | null;
  /** Planned length, both ends counted. */
  durationDays: number | null;
  /** Finish vs plan: actual (or projected) finish − planned finish. + late, − early. */
  varianceDays: number | null;
  /** 0–100 by days: finished 100, running = days so far ÷ all its days, not started 0. */
  progress: number;
  /** Text after the bar, e.g. "Pre-con: 1d · Const: 5d · Total: 6d" or "13d delay · Architect". */
  label: string;
  /** Reasons written in Sheet View. */
  reasons: { who: string; text: string }[];
  task: GanttTask;
}

export interface GanttGroup {
  key: string;
  label: string;
  color: GanttColor;
  rows: GanttRow[];
  span: DateSpan | null;
  days: number;
  progress: number;
}

export interface GanttLink {
  id: string;
  from: string; // task that comes first (depends_on)
  to: string; // task that waits on it
  type: DependencyType;
  soft: boolean;
}

export interface GanttData {
  groups: GanttGroup[];
  links: GanttLink[];
  start: string;
  end: string;
  today: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "4 Nov" */
export const fmtDay = (k: string) => `${Number(k.slice(8, 10))} ${MONTHS[Number(k.slice(5, 7)) - 1]}`;
/** "4 Nov – 18 Nov" */
export const fmtSpan = (s: DateSpan | null) => (s ? (s.start === s.end ? fmtDay(s.start) : `${fmtDay(s.start)} – ${fmtDay(s.end)}`) : '—');
const spanDays = (s: DateSpan) => daysBetween(s.start, s.end) + 1;
const minKey = (a: string, b: string) => (a <= b ? a : b);
const maxKey = (a: string, b: string) => (a >= b ? a : b);

export function ganttRow(t: GanttTask, p: { start: string; end: string; delayDays: number } | undefined, notes: ChecklistNotes, today: string): GanttRow {
  const ps = t.plannedStartDate ?? t.dueDate;
  const pe = t.dueDate ?? t.plannedStartDate;
  const plan = ps && pe ? { start: ps, end: maxKey(ps, pe) } : null;

  let done: DateSpan | null = null;
  let left: DateSpan | null = null;
  if (t.actualEndDate) {
    // Finished: the whole bar is actual.
    done = { start: t.actualStartDate ? minKey(t.actualStartDate, t.actualEndDate) : t.actualEndDate, end: t.actualEndDate };
  } else if (t.actualStartDate) {
    // Running: actual start → today is done, the rest up to the projected finish is still to go.
    const doneEnd = maxKey(today, t.actualStartDate);
    done = { start: t.actualStartDate, end: doneEnd };
    const projEnd = p?.end ?? (plan ? addDays(t.actualStartDate, daysBetween(plan.start, plan.end)) : t.actualStartDate);
    if (projEnd > doneEnd) left = { start: addDays(doneEnd, 1), end: projEnd };
  } else if (p) {
    // Not started: all projected (light).
    left = { start: p.start, end: p.end };
  }
  const bar = done || left ? { start: (done ?? left)!.start, end: (left ?? done)!.end } : null;

  const open = t.actualEndDate ? null : sheetStatus(t, today).open;
  const status: ReportStatus = t.actualEndDate ? 'Completed' : t.actualStartDate ? 'In progress' : open?.delay ? 'Pending' : 'Upcoming';
  const department = t.workName && t.workName !== 'Unassigned' ? t.workName : '';
  const reportRow: SheetReportRow = {
    no: 0,
    taskCode: t.taskId,
    taskName: t.taskName,
    department,
    status,
    plannedDates: '',
    actualDates: '',
    delay: '',
    delayed: false,
    delayDays: 0,
    notes,
  };
  const reasons = reasonEntries(reportRow);

  let progress = 0;
  if (status === 'Completed') progress = 100;
  else if (done) {
    const d = spanDays(done);
    const l = left ? spanDays(left) : 0;
    progress = Math.min(99, Math.round((d / (d + l)) * 100));
  }

  let label: string;
  if (t.actualEndDate) {
    const split = delaySplit({ plannedStart: plan?.start, plannedEnd: plan?.end, actualStart: t.actualStartDate, actualEnd: t.actualEndDate });
    label = split ? formatDelaySplit(split)[0] : 'Completed';
  } else {
    const parts: string[] = [];
    if (open?.delay) parts.push(open.delay);
    else if (!t.actualStartDate && p && p.delayDays > 0) parts.push(`Projected +${p.delayDays}d`);
    const who = [...new Set(reasons.map((r) => r.who))];
    if (who.length) parts.push(who.length > 2 ? `${who.slice(0, 2).join(', ')} +${who.length - 2}` : who.join(', '));
    label = parts.join(' · ');
  }

  return {
    id: t.id,
    code: t.taskId,
    name: t.taskName.trim(),
    department,
    status,
    plan,
    done,
    left,
    bar,
    projected: !t.actualEndDate && bar ? { start: bar.start, end: bar.end } : null,
    durationDays: plan ? spanDays(plan) : null,
    varianceDays: plan && bar ? daysBetween(plan.end, bar.end) : null,
    progress,
    label,
    reasons,
    task: t,
  };
}

const OTHER_KEY = 'other';

/**
 * `shown` = the tasks on screen (the board's filter applies); `all` + `edges` =
 * the whole board, so projected dates are worked out exactly as on the flowchart.
 */
export function buildGantt(
  shown: GanttTask[],
  all: GanttTask[],
  edges: FlowchartSeriesEdge[],
  notes: Map<string, ChecklistNotes>,
  today: string
): GanttData {
  const projected = computeProjectedDates(all, edges, today);
  const rows = shown.map((t) => ganttRow(t, projected.get(t.id), notes.get(t.id) ?? EMPTY_CHECKLIST_NOTES, today));

  // Groups = the outlined boxes on Flowchart 2; everything else under "Other works".
  // Colours stay with the group, so filtering never recolours a group.
  const buckets = new Map<string, { label: string; color: GanttColor; rows: GanttRow[] }>();
  for (const r of rows) {
    const gi = FLOWCHART_2_GROUPS.findIndex((g) => g.taskCodes.includes(r.code));
    const key = gi >= 0 ? `g${gi}` : OTHER_KEY;
    if (!buckets.has(key)) {
      buckets.set(key, {
        label: gi >= 0 ? FLOWCHART_2_GROUPS[gi].label : 'Other works',
        color: GANTT_COLORS[gi >= 0 ? gi % (GANTT_COLORS.length - 1) : GANTT_COLORS.length - 1],
        rows: [],
      });
    }
    buckets.get(key)!.rows.push(r);
  }
  const startOf = (r: GanttRow) => r.plan?.start ?? r.bar?.start ?? '9999-12-31';
  const groups: GanttGroup[] = [...buckets.entries()].map(([key, b]) => {
    const sorted = [...b.rows].sort((x, y) => startOf(x).localeCompare(startOf(y)) || x.code.localeCompare(y.code, undefined, { numeric: true }));
    const keys = sorted.flatMap((r) => [r.plan?.start, r.plan?.end, r.bar?.start, r.bar?.end]).filter((k): k is string => !!k);
    const span = keys.length ? { start: keys.reduce(minKey), end: keys.reduce(maxKey) } : null;
    let doneDays = 0;
    let allDays = 0;
    for (const r of sorted) {
      const d = r.done ? spanDays(r.done) : 0;
      const l = r.left ? spanDays(r.left) : 0;
      doneDays += r.status === 'Completed' ? d : Math.min(d, Math.round(((d + l) * r.progress) / 100));
      allDays += d + l;
    }
    return { key, label: b.label, color: b.color, rows: sorted, span, days: span ? spanDays(span) : 0, progress: allDays ? Math.round((doneDays / allDays) * 100) : 0 };
  });
  groups.sort((a, b) => (a.span?.start ?? '9999').localeCompare(b.span?.start ?? '9999') || (a.key === OTHER_KEY ? 1 : b.key === OTHER_KEY ? -1 : 0));
  if (groups.length === 1 && groups[0].key === OTHER_KEY) groups[0].label = 'All tasks';

  const ids = new Set(rows.map((r) => r.id));
  const links: GanttLink[] = edges
    .filter((e) => ids.has(e.taskId) && ids.has(e.dependsOnTaskId))
    .map((e) => ({ id: e.id, from: e.dependsOnTaskId, to: e.taskId, type: e.type, soft: !!e.soft }));

  const keys = [today, ...groups.flatMap((g) => (g.span ? [g.span.start, g.span.end] : []))];
  return { groups, links, start: addDays(keys.reduce(minKey), -2), end: addDays(keys.reduce(maxKey), 3), today };
}

// ─── Layout: everything in pixels, for the screen and the PDF ────────────────

export interface GanttLayoutOptions {
  dayW: number;
  rowH: number;
  /** Room after the last day for the text after the bars. */
  labelPad: number;
  hideCompleted: boolean;
  collapsed: ReadonlySet<string>;
  showPlan: boolean;
  showLinks: boolean;
}

export type GanttLine = { kind: 'group'; group: GanttGroup; y: number } | { kind: 'task'; group: GanttGroup; row: GanttRow; y: number };

export interface GanttRect {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  r: number;
  rowId?: string;
}

export interface GanttLinkPath {
  id: string;
  d: string;
  arrow: string; // polygon points
  type: DependencyType;
  soft: boolean;
  color: string;
}

export interface GanttLabel {
  key: string;
  x: number;
  y: number; // text baseline
  text: string;
  muted?: boolean;
}

export interface GanttLayout {
  width: number;
  height: number;
  dayW: number;
  rowH: number;
  days: { key: string; x: number; day: number; weekday: string; sunday: boolean; monday: boolean }[];
  months: { x: number; label: string }[];
  todayX: number | null;
  lines: GanttLine[];
  rects: GanttRect[];
  links: GanttLinkPath[];
  labels: GanttLabel[];
}

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Which groups/rows are on screen, top to bottom. */
export function ganttLines(data: GanttData, hideCompleted: boolean, collapsed: ReadonlySet<string>, rowH: number): GanttLine[] {
  const out: GanttLine[] = [];
  for (const g of data.groups) {
    const rows = hideCompleted ? g.rows.filter((r) => r.status !== 'Completed') : g.rows;
    if (rows.length === 0) continue;
    out.push({ kind: 'group', group: g, y: out.length * rowH });
    if (collapsed.has(g.key)) continue;
    for (const row of rows) out.push({ kind: 'task', group: g, row, y: out.length * rowH });
  }
  return out;
}

/** An elbow line from one bar to the next, like a printed Gantt (MS Project style). */
export function linkGeometry(
  type: DependencyType,
  from: { x0: number; x1: number; y: number },
  to: { x0: number; x1: number; y: number; top: number; rowH: number },
  gap = 6
): { d: string; arrow: string } {
  const fromStart = type === 'SS' || type === 'SF';
  const toEnd = type === 'FF' || type === 'SF';
  const fx = fromStart ? from.x0 : from.x1;
  const a = fx + (fromStart ? -gap : gap);
  const tx = toEnd ? to.x1 : to.x0;
  const inDir = toEnd ? -1 : 1; // 1 = arrives moving right (into the bar's start)
  const pts: [number, number][] = [
    [fx, from.y],
    [a, from.y],
  ];
  if (inDir === 1 ? tx >= a + 3 : tx <= a - 3) {
    pts.push([a, to.y], [tx, to.y]);
  } else {
    // No room for a straight elbow: go round, between the rows.
    const yMid = to.y > from.y ? to.top + 2 : to.top + to.rowH - 2;
    const b = tx - inDir * gap;
    pts.push([a, yMid], [b, yMid], [b, to.y], [tx, to.y]);
  }
  const head = 5;
  const [ex, ey] = pts[pts.length - 1];
  pts[pts.length - 1] = [ex - inDir * head, ey];
  const r = (n: number) => Math.round(n * 10) / 10;
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r(x)} ${r(y)}`).join(' ');
  const arrow = `${r(ex)},${r(ey)} ${r(ex - inDir * head)},${r(ey - 3.5)} ${r(ex - inDir * head)},${r(ey + 3.5)}`;
  return { d, arrow };
}

export function layoutGantt(data: GanttData, o: GanttLayoutOptions): GanttLayout {
  const { dayW, rowH } = o;
  const nDays = daysBetween(data.start, data.end) + 1;
  const xOf = (k: string) => daysBetween(data.start, k) * dayW;
  const days = Array.from({ length: nDays }, (_, i) => {
    const key = addDays(data.start, i);
    const wd = new Date(`${key}T00:00:00Z`).getUTCDay();
    return { key, x: i * dayW, day: Number(key.slice(8, 10)), weekday: WEEKDAY[wd], sunday: wd === 0, monday: wd === 1 };
  });
  const months = days.filter((d, i) => i === 0 || d.day === 1).map((d) => ({ x: d.x, label: `${MONTHS[Number(d.key.slice(5, 7)) - 1]} ${d.key.slice(0, 4)}` }));
  const todayX = data.today >= data.start && data.today <= data.end ? xOf(data.today) : null;

  const lines = ganttLines(data, o.hideCompleted, o.collapsed, rowH);
  const barY = Math.round(rowH * 0.24);
  const barH = Math.round(rowH * 0.41);
  const planY = Math.round(rowH * 0.7);
  const planH = Math.max(3, Math.round(rowH * 0.12));
  const midY = barY + barH / 2;
  const spanX = (s: DateSpan) => ({ x: xOf(s.start), w: (daysBetween(s.start, s.end) + 1) * dayW });

  const rects: GanttRect[] = [];
  const labels: GanttLabel[] = [];
  const barAt = new Map<string, { x0: number; x1: number; y: number; top: number }>();
  for (const line of lines) {
    if (line.kind === 'group') {
      const g = line.group;
      if (!g.span) continue;
      const { x, w } = spanX(g.span);
      const gy = line.y + Math.round(rowH * 0.33);
      const gh = Math.round(rowH * 0.34);
      rects.push({ key: `g-${g.key}`, x, y: gy, w, h: gh, fill: GROUP_BAR.light, r: gh / 2 });
      if (g.progress > 0) rects.push({ key: `gp-${g.key}`, x, y: gy, w: Math.max(gh, (w * g.progress) / 100), h: gh, fill: GROUP_BAR.dark, r: gh / 2 });
      continue;
    }
    const { row, group } = line;
    if (o.showPlan && row.plan) {
      const { x, w } = spanX(row.plan);
      rects.push({ key: `p-${row.id}`, x, y: line.y + planY, w, h: planH, fill: PLAN_LINE, r: planH / 2, rowId: row.id });
    }
    if (row.left) {
      const { x, w } = spanX(row.left);
      rects.push({ key: `l-${row.id}`, x, y: line.y + barY, w, h: barH, fill: group.color.light, r: 3, rowId: row.id });
    }
    if (row.done) {
      const { x, w } = spanX(row.done);
      rects.push({ key: `d-${row.id}`, x, y: line.y + barY, w, h: barH, fill: group.color.dark, r: 3, rowId: row.id });
    }
    if (row.bar) {
      const { x, w } = spanX(row.bar);
      barAt.set(row.id, { x0: x, x1: x + w, y: line.y + midY, top: line.y });
      const endX = Math.max(x + w, o.showPlan && row.plan ? spanX(row.plan).x + spanX(row.plan).w : 0);
      // +10: clear of a link leaving the bar's end (links turn at +6).
      if (row.label) labels.push({ key: `t-${row.id}`, x: endX + 10, y: line.y + midY + 4, text: row.label });
    } else {
      labels.push({ key: `t-${row.id}`, x: (todayX ?? 0) + 6, y: line.y + midY + 4, text: 'No planned dates yet', muted: true });
    }
  }

  const links: GanttLinkPath[] = [];
  if (o.showLinks) {
    for (const l of data.links) {
      const a = barAt.get(l.from);
      const b = barAt.get(l.to);
      if (!a || !b) continue;
      const { d, arrow } = linkGeometry(l.type, a, { ...b, rowH });
      links.push({ id: l.id, d, arrow, type: l.type, soft: l.soft, color: l.soft ? SOFT_LINK : LINK_COLOR });
    }
  }

  return {
    width: nDays * dayW + o.labelPad,
    height: lines.length * rowH,
    dayW,
    rowH,
    days,
    months,
    todayX,
    lines,
    rects,
    links,
    labels,
  };
}

/** "+13d" / "-2d" / "0d" / "—" */
export const fmtVariance = (v: number | null) => (v === null ? '—' : v > 0 ? `+${v}d` : `${v}d`);
