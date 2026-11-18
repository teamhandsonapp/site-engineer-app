// App Progress flowchart (2026-11-18): every feature of the app as one box,
// in the order the work goes, joined by links, ending in Launch. Shown in
// PMC Portal → App Progress → Flowchart.
//
// Fixed here, in code: each box's name, position and what it waits on.
// Saved in Supabase (app_flow_features, see lib/appFlowStore.ts): each box's
// status and its points with ticks. DEFAULT_STATE below is the same starting
// data as the migration, used until the table answers.

export type FlowStatus = 'ready' | 'ongoing' | 'client' | 'todo';
// Each point is one of three kinds, shown under its own heading in the panel.
export type PointKind = 'client' | 'build' | 'test';
export type FlowPoint = { text: string; kind: PointKind; done: boolean };
export const POINT_KINDS: { kind: PointKind; label: string }[] = [
  { kind: 'client', label: 'Needed from client' },
  { kind: 'build', label: 'To build' },
  { kind: 'test', label: 'To test' },
];
export type FeatureState = { status: FlowStatus; points: FlowPoint[] };

export type FlowFeature = {
  id: string;
  code: string;
  category: string;
  title: string;
  subtitle: string;
  // Board position in grid cells (see boxPosition).
  col: number;
  row: number;
  // Everything this box waits on (shown in the panel and highlighted).
  waits: string[];
};

export const STATUS_STYLE: Record<FlowStatus, { label: string; bg: string; border: string; text: string; dot: string }> = {
  ready: { label: 'Ready', bg: '#DCFCE7', border: '#86EFAC', text: '#166534', dot: '#16A34A' },
  ongoing: { label: 'Ongoing', bg: '#FEF3C7', border: '#FCD34D', text: '#92400E', dot: '#D97706' },
  client: { label: 'Needs client input', bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B', dot: '#DC2626' },
  todo: { label: 'Pending', bg: '#F3F4F6', border: '#D1D5DB', text: '#4B5563', dot: '#9CA3AF' },
};
export const FLOW_STATUSES: FlowStatus[] = ['ready', 'ongoing', 'client', 'todo'];

// Last box of each line; they all feed F09 Client Portal, the last small step
// once everything else is done, and then Launch. (Removed 2026-11-19: F04
// Completed Tasks, F07 DPR Edit Requests — part of DPR. Codes are kept as
// they are, so F04 and F07 are unused. Also removed: F10 Home, F11 Attendance
// & Day Timeline, F12 Site Engineer Attendance & Leave.)
const LAST_FEATURES = ['alerts', 'gantt', 'reports', 'files', 'mom', 'devices', 'workers'];

export const FLOW_FEATURES: FlowFeature[] = [
  { id: 'roles', code: 'F01', category: 'Setup', title: 'Access & Roles', subtitle: 'Who can see and do what', col: 0, row: 3, waits: [] },
  { id: 'flow', code: 'F02', category: 'Site work', title: 'Flowchart', subtitle: 'Current Status, 56 Tasks, Copy, Main Flowchart', col: 1, row: 0, waits: ['roles'] },
  { id: 'alerts', code: 'F03', category: 'Alerts', title: 'Critical Alerts & Notifications', subtitle: 'Notifications, critical alerts with sound', col: 2, row: 0, waits: ['flow'] },
  { id: 'gantt', code: 'F05', category: 'Site work', title: 'Gantt Chart', subtitle: 'Timeline of the flowchart tasks', col: 2, row: 1, waits: ['flow'] },
  { id: 'dpr', code: 'F06', category: 'Site work', title: 'DPR', subtitle: 'Daily Progress Report', col: 2, row: 2, waits: ['flow'] },
  // PR split out of F06 on 2026-11-19; new code F17 so the others keep theirs.
  { id: 'pr', code: 'F17', category: 'Site work', title: 'PR', subtitle: 'Progress Report', col: 2, row: 3, waits: ['flow'] },
  { id: 'reports', code: 'F08', category: 'Reports', title: 'Reports', subtitle: 'Status by time, stakeholder, task based', col: 3, row: 3, waits: ['dpr', 'pr', 'flow'] },
  { id: 'files', code: 'F13', category: 'Documents', title: 'File Manager & Documents', subtitle: 'Drawings and project files', col: 1, row: 4, waits: ['roles'] },
  { id: 'contacts', code: 'F14', category: 'Contacts', title: 'Contact Book & Specific Book', subtitle: 'Contact Book, Specific Book', col: 1, row: 5, waits: ['roles'] },
  { id: 'mom', code: 'F15', category: 'Meetings', title: 'MoM', subtitle: 'Meeting, Reports, Custom Alerts, Email Reports', col: 2, row: 5, waits: ['contacts'] },
  { id: 'devices', code: 'F16', category: 'General', title: 'Devices & Settings', subtitle: 'Devices & Logins, Settings', col: 1, row: 6, waits: ['roles'] },
  // Added 2026-11-19.
  { id: 'workers', code: 'F18', category: 'People', title: 'Worker Attendance', subtitle: 'How the client fills in worker attendance', col: 1, row: 7, waits: ['roles'] },
  { id: 'portal', code: 'F09', category: 'Client', title: 'Client Portal', subtitle: 'What the client sees, set up last', col: 5, row: 3, waits: LAST_FEATURES },
  { id: 'beta', code: 'L1', category: 'Launch', title: 'Play Store closed test', subtitle: '12 testers · 14 days', col: 6, row: 3, waits: ['portal'] },
  { id: 'release', code: 'L2', category: 'Launch', title: 'Public release', subtitle: 'Google Play Store', col: 6, row: 4.3, waits: ['beta'] },
  // iPhone: added 2026-11-19, alongside the Play Store.
  { id: 'appstore', code: 'L3', category: 'Launch', title: 'App Store (iPhone)', subtitle: 'Apple App Store submission', col: 6, row: 5.6, waits: ['portal'] },
];

export const FEATURE_BY_ID: Record<string, FlowFeature> = Object.fromEntries(FLOW_FEATURES.map((f) => [f.id, f]));

// Reverse of `waits`: what comes next after each box.
export const NEXT_BY_ID: Record<string, string[]> = (() => {
  const next: Record<string, string[]> = Object.fromEntries(FLOW_FEATURES.map((f) => [f.id, [] as string[]]));
  for (const f of FLOW_FEATURES) for (const w of f.waits) next[w]?.push(f.id);
  return next;
})();

// Links drawn as lines. Every other `waits` entry is shown only when a box is
// selected (highlight + panel), so the board stays readable.
export type FlowLink = { from: string; to: string; launch?: boolean };
export const FLOW_LINKS: FlowLink[] = [
  ...['flow', 'files', 'contacts', 'devices', 'workers'].map((to) => ({ from: 'roles', to })),
  ...['alerts', 'gantt', 'dpr', 'pr'].map((to) => ({ from: 'flow', to })),
  { from: 'dpr', to: 'reports' },
  { from: 'pr', to: 'reports' },
  { from: 'contacts', to: 'mom' },
  ...LAST_FEATURES.map((from) => ({ from, to: 'portal', launch: true })),
  { from: 'portal', to: 'beta' },
  { from: 'portal', to: 'appstore' },
  { from: 'beta', to: 'release' },
];

// Board geometry (unscaled px).
export const BOX_W = 200;
export const BOX_H = 112;
export const COL_GAP = 96;
export const ROW_GAP = 48;
export const BOARD_PAD = 40;
export const BOARD_TOP = 24;

export function boxPosition(f: FlowFeature): { x: number; y: number } {
  return { x: BOARD_PAD + f.col * (BOX_W + COL_GAP), y: BOARD_TOP + f.row * (BOX_H + ROW_GAP) };
}

export const BOARD_W = Math.max(...FLOW_FEATURES.map((f) => boxPosition(f).x)) + BOX_W + BOARD_PAD;
export const BOARD_H = Math.max(...FLOW_FEATURES.map((f) => boxPosition(f).y)) + BOX_H + BOARD_PAD;

// Orthogonal route for a drawn link, as points. Side by side: out of the
// right edge, down/up in the middle of the gap, into the left edge (several
// links from one box share that middle line, like the client flowchart).
// Launch links meet on one line just left of the Launch column. A box
// straight below (L1 → L2) gets a straight line down.
export function linkRoute(link: FlowLink): { x: number; y: number }[] {
  const a = boxPosition(FEATURE_BY_ID[link.from]);
  const b = boxPosition(FEATURE_BY_ID[link.to]);
  if (a.x === b.x) return [{ x: a.x + BOX_W / 2, y: a.y + BOX_H }, { x: b.x + BOX_W / 2, y: b.y }];
  const startX = a.x + BOX_W;
  const startY = a.y + BOX_H / 2;
  const endX = b.x;
  const endY = b.y + BOX_H / 2;
  const midX = link.launch ? endX - ROW_GAP : startX + COL_GAP / 2;
  if (startY === endY && !link.launch) return [{ x: startX, y: startY }, { x: endX, y: endY }];
  return [{ x: startX, y: startY }, { x: midX, y: startY }, { x: midX, y: endY }, { x: endX, y: endY }];
}

// Starting data. F02 Flowchart, F03 Critical Alerts & Notifications, F05
// Gantt Chart, F06 DPR and F17 PR are the real lists (2026-11-19); the others are still from App Progress (10 Nov)
// until the real lists come in.
export const DEFAULT_STATE: Record<string, FeatureState> = {
  roles: { status: 'client', points: pts(['List of all people and their role', 'client'], ['What each role does', 'client'], ['What each role can see', 'client'], ['Set up roles in the app', 'build']) },
  flow: {
    status: 'ongoing',
    points: pts(['Create task boxes', 'test'], ['Link tasks', 'test'], ['Move and arrange task boxes', 'test'], ['Check the tasks and links in the flowchart', 'test']),
  },
  // DPR and PR: the client gives the format for each.
  dpr: { status: 'client', points: pts(['Give the DPR format', 'client']) },
  pr: { status: 'client', points: pts(['Give the PR format', 'client']) },
  // Gantt chart is ready; only the client's look and approval is left.
  gantt: { status: 'client', points: pts(['See and approve the Gantt chart', 'client']) },
  // Built and sending already; only the client's testing on site is left.
  alerts: {
    status: 'ongoing',
    points: pts(['Notifications arrive on their phones, on site', 'test'], ['Critical alerts arrive with sound on their phones, on site', 'test']),
  },
  // Kept pending: a small job done once every other feature is complete.
  portal: { status: 'todo', points: pts(['Set up what the client sees, once everything else is done', 'build']) },
  reports: { status: 'client', points: pts(['Give the report formats and what each report should show', 'client']) },
  // The drawings flow is built; it needs real drawings from the client to test.
  files: {
    status: 'client',
    points: pts(['Give the real drawings for one project (at least 10–15)', 'client'], ['Upload the drawings and check the flow', 'test'], ['Client tests the drawings flow', 'test']),
  },
  contacts: { status: 'client', points: pts(['Add-contact format: which details', 'client'], ['Check the format with the client', 'test']) },
  // All pending on our side (not the client's).
  mom: {
    status: 'ongoing',
    points: pts(
      ['Create a mail ID for the client', 'build'],
      ['Create a mailer and connect it with Gmail', 'build'],
      ['Sync all meeting events with Google Calendar', 'build'],
      ['Set up the Meta WhatsApp integration', 'build'],
      ['Do the Meta business verification', 'build'],
    ),
  },
  // 11 of 12 testers in (19 Nov); the 14-day test starts once the 12th joins.
  beta: {
    status: 'ongoing',
    points: [
      { text: '11 testers added', kind: 'client', done: true },
      ...pts(['Add the 12th tester', 'client'], ['14-day closed test (starts once all 12 are in)', 'test']),
    ],
  },
  appstore: { status: 'todo', points: pts(['Record a screen video on iPhone', 'build'], ['Submit the app to the App Store', 'build']) },
  workers: { status: 'client', points: pts(['Give the worker attendance format: how the client will fill it in', 'client']) },
  release: { status: 'todo', points: [] },
};

function pts(...items: [string, PointKind][]): FlowPoint[] {
  return items.map(([text, kind]) => ({ text, kind, done: false }));
}

// Older saved points carried who: 'Client' | 'Team' instead of a kind.
function kindOf(p: Record<string, unknown>): PointKind {
  if (p.kind === 'client' || p.kind === 'build' || p.kind === 'test') return p.kind;
  return p.who === 'Team' ? 'build' : 'client';
}

export function defaultStateFor(id: string): FeatureState {
  const d = DEFAULT_STATE[id];
  return d ? { status: d.status, points: d.points.map((p) => ({ ...p })) } : { status: 'ready', points: [] };
}

// Turns the table's raw rows into a full state map: every box present, bad
// values replaced by the defaults.
export function mergeFlowState(rows: { id: string; status: unknown; points: unknown }[]): Record<string, FeatureState> {
  const out: Record<string, FeatureState> = Object.fromEntries(FLOW_FEATURES.map((f) => [f.id, defaultStateFor(f.id)]));
  for (const r of rows) {
    if (!out[r.id]) continue;
    const status = FLOW_STATUSES.includes(r.status as FlowStatus) ? (r.status as FlowStatus) : out[r.id].status;
    const points = Array.isArray(r.points)
      ? r.points
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string')
          .map((p) => ({ text: String(p.text), kind: kindOf(p), done: p.done === true }))
      : out[r.id].points;
    out[r.id] = { status, points };
  }
  return out;
}

// Flips one point, found by its text (so a tick lands on the right point even
// if the list changed since this phone loaded it). Returns null if gone.
export function togglePoint(points: FlowPoint[], text: string, done: boolean): FlowPoint[] | null {
  const i = points.findIndex((p) => p.text === text);
  if (i < 0) return null;
  return points.map((p, k) => (k === i ? { ...p, done } : p));
}
