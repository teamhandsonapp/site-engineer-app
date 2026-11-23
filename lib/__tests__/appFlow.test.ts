import {
  BOX_H,
  BOX_W,
  FEATURE_BY_ID,
  FLOW_FEATURES,
  FLOW_LINKS,
  NEXT_BY_ID,
  boxPosition,
  linkRoute,
  mergeFlowState,
  togglePoint,
} from '../appFlow';

describe('App Progress flowchart', () => {
  it('every link and wait points at a real box, and codes are unique', () => {
    for (const f of FLOW_FEATURES) for (const w of f.waits) expect(FEATURE_BY_ID[w]).toBeDefined();
    for (const l of FLOW_LINKS) {
      expect(FEATURE_BY_ID[l.from]).toBeDefined();
      expect(FEATURE_BY_ID[l.to]).toBeDefined();
      // A drawn line is always also a real dependency.
      expect(FEATURE_BY_ID[l.to].waits).toContain(l.from);
    }
    expect(new Set(FLOW_FEATURES.map((f) => f.code)).size).toBe(FLOW_FEATURES.length);
  });

  it('boxes never overlap', () => {
    const boxes = FLOW_FEATURES.map(boxPosition);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.x < b.x + BOX_W && b.x < a.x + BOX_W && a.y < b.y + BOX_H && b.y < a.y + BOX_H;
        expect(overlap).toBe(false);
      }
  });

  it('links run only horizontally or vertically, from one box edge to the other', () => {
    for (const l of FLOW_LINKS) {
      const pts = linkRoute(l);
      for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
      const to = boxPosition(FEATURE_BY_ID[l.to]);
      const end = pts[pts.length - 1];
      expect(end.x === to.x || end.y === to.y).toBe(true);
    }
  });

  it('works out what comes next from what each box waits on', () => {
    expect(NEXT_BY_ID.roles).toEqual(expect.arrayContaining(['flow', 'files', 'devices']));
    expect(NEXT_BY_ID.beta).toEqual(['release']);
    expect(NEXT_BY_ID.release).toEqual([]);
  });

  it('fills missing rows from the defaults and ignores bad data', () => {
    const state = mergeFlowState([
      { id: 'flow', status: 'ready', points: [{ text: 'Link tasks', kind: 'test', done: true }, { nope: 1 }] },
      // Older rows said who: 'Client' | 'Team' instead of a kind.
      { id: 'mom', status: 'client', points: [{ text: 'Email', who: 'Client' }, { text: 'Sync', who: 'Team' }] },
      { id: 'roles', status: 'weird', points: 'x' },
      { id: 'unknown', status: 'ready', points: [] },
    ]);
    expect(Object.keys(state)).toHaveLength(FLOW_FEATURES.length);
    expect(state.flow).toEqual({ status: 'ready', points: [{ text: 'Link tasks', kind: 'test', done: true }] });
    expect(state.mom.points.map((p) => p.kind)).toEqual(['client', 'build']);
    expect(state.roles.status).toBe('client');
    expect(state.roles.points).toHaveLength(4);
    expect(state.release.status).toBe('todo');
    expect(state.unknown).toBeUndefined();
  });

  it('ticks a point by its text', () => {
    const pts = [
      { text: 'A', kind: 'client' as const, done: false },
      { text: 'B', kind: 'test' as const, done: false },
    ];
    expect(togglePoint(pts, 'B', true)).toEqual([pts[0], { ...pts[1], done: true }]);
    expect(togglePoint(pts, 'C', true)).toBeNull();
    expect(pts[1].done).toBe(false);
  });

  it('the Flowchart box has only client testing points, no client inputs', () => {
    const flow = mergeFlowState([]).flow;
    expect(flow.status).toBe('ongoing');
    expect(flow.points.map((p) => p.kind)).toEqual(['test', 'test', 'test', 'test']);
  });

  it('F03 is Critical Alerts & Notifications, with only client testing left', () => {
    expect(FEATURE_BY_ID.alerts.code).toBe('F03');
    expect(FEATURE_BY_ID.alerts.title).toBe('Critical Alerts & Notifications');
    const alerts = mergeFlowState([]).alerts;
    expect(alerts.status).toBe('ongoing');
    expect(alerts.points.every((p) => p.kind === 'test')).toBe(true);
  });

  it('has no Completed Tasks box, and F03 is the end of its line', () => {
    expect(FEATURE_BY_ID.completed).toBeUndefined();
    expect(FLOW_FEATURES.some((f) => f.title === 'Completed Tasks')).toBe(false);
    expect(FEATURE_BY_ID.portal.waits).toContain('alerts');
    expect(FLOW_LINKS).toContainEqual({ from: 'alerts', to: 'portal', launch: true });
  });

  it('F05 Gantt Chart only waits for the client to see and approve it', () => {
    const gantt = mergeFlowState([]).gantt;
    expect(gantt.status).toBe('client');
    expect(gantt.points).toEqual([{ text: 'See and approve the Gantt chart', kind: 'client', done: false }]);
  });

  it('DPR and PR are separate boxes, each waiting for its format from the client', () => {
    expect(FEATURE_BY_ID.dpr.title).toBe('DPR');
    expect(FEATURE_BY_ID.pr.title).toBe('PR');
    const state = mergeFlowState([]);
    expect(state.dpr.points).toEqual([{ text: 'Give the DPR format', kind: 'client', done: false }]);
    expect(state.pr.points).toEqual([{ text: 'Give the PR format', kind: 'client', done: false }]);
    expect(state.dpr.status).toBe('client');
    expect(state.pr.status).toBe('client');
  });

  it('DPR Edit Requests is gone; Reports waits on the client; Client Portal is last before Launch', () => {
    expect(FEATURE_BY_ID.dpredit).toBeUndefined();
    const state = mergeFlowState([]);
    expect(state.reports.status).toBe('client');
    expect(state.reports.points.every((p) => p.kind === 'client')).toBe(true);
    expect(state.portal.status).toBe('todo');
    // Every other line ends in Client Portal; only Launch comes after it.
    expect(FEATURE_BY_ID.portal.waits).toEqual(expect.arrayContaining(['reports', 'alerts', 'gantt', 'devices']));
    expect(NEXT_BY_ID.portal).toEqual(['beta', 'appstore']);
    expect(FEATURE_BY_ID.beta.waits).toEqual(['portal']);
  });

  it('Home, Attendance & Day Timeline and Site Engineer Attendance & Leave are removed', () => {
    for (const id of ['home', 'att', 'seatt']) expect(FEATURE_BY_ID[id]).toBeUndefined();
    for (const f of FLOW_FEATURES) for (const w of f.waits) expect(['home', 'att', 'seatt']).not.toContain(w);
  });

  it('F13 needs real drawings from the client, then the flow is tested', () => {
    const files = mergeFlowState([]).files;
    expect(files.status).toBe('client');
    expect(files.points.map((p) => p.kind)).toEqual(['client', 'test', 'test']);
  });

  it('F15 MoM: five build points, all on our side', () => {
    const mom = mergeFlowState([]).mom;
    expect(mom.status).toBe('ongoing');
    expect(mom.points).toHaveLength(5);
    expect(mom.points.every((p) => p.kind === 'build')).toBe(true);
  });

  it('Worker Attendance (F18) and App Store (L3) are on the board; Play Store shows 11 testers in', () => {
    const state = mergeFlowState([]);
    expect(FEATURE_BY_ID.workers.code).toBe('F18');
    expect(state.workers.points).toEqual([{ text: 'Give the worker attendance format: how the client will fill it in', kind: 'client', done: false }]);
    expect(FEATURE_BY_ID.appstore.waits).toEqual(['portal']);
    expect(state.appstore.points.map((p) => p.text)).toEqual(['Record a screen video on iPhone', 'Submit the app to the App Store']);
    expect(state.beta.points.filter((p) => p.done).map((p) => p.text)).toEqual(['11 testers added']);
    expect(FEATURE_BY_ID.portal.waits).toContain('workers');
  });
});
