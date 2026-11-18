import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '../ui/AppText';
import { useAuth } from '../../lib/AuthContext';
import { useSafeBottomOffset } from '../../lib/useSafeBottomOffset';
import {
  BOARD_H,
  BOARD_W,
  BOX_H,
  BOX_W,
  FEATURE_BY_ID,
  FLOW_FEATURES,
  FLOW_LINKS,
  FLOW_STATUSES,
  NEXT_BY_ID,
  POINT_KINDS,
  STATUS_STYLE,
  boxPosition,
  defaultStateFor,
  linkRoute,
  mergeFlowState,
  togglePoint,
  type FeatureState,
  type FlowFeature,
  type FlowLink,
  type FlowStatus,
  type PointKind,
} from '../../lib/appFlow';
import { AppFlowNotSetUpError, fetchAppFlow, setFeatureStatus, setPointDone } from '../../lib/appFlowStore';

// App Progress → Flowchart (2026-11-18): every app feature as a box, in
// order, joined by links, ending in Launch — the same look as a project's
// flowchart. The link icon on a box (or the box itself) selects it: the
// boxes it waits on light up blue, the ones that come next get a dashed
// outline, the rest fade, and a panel lists them with the box's points to
// tick. Admin can also change a box's status there.

const LINE = '#374151';
const LINE_LAUNCH = '#9CA3AF';
const WAIT_COLOR = '#2563EB';
const NEXT_COLOR = '#B45309';
const SELECT_COLOR = '#F0A227';
const KIND_STYLE: Record<PointKind, { bg: string; text: string }> = {
  client: { bg: '#FEE2E2', text: '#991B1B' },
  build: { bg: '#DBEAFE', text: '#1E40AF' },
  test: { bg: '#EDE9FE', text: '#5B21B6' },
};
const ZOOMS = [0.5, 0.65, 0.8, 1, 1.2];

type Mark = 'selected' | 'wait' | 'next' | 'dim' | 'none';

function markFor(id: string, selId: string | null): Mark {
  if (!selId) return 'none';
  if (id === selId) return 'selected';
  const sel = FEATURE_BY_ID[selId];
  if (!sel) return 'none';
  if (sel.waits.includes(id)) return 'wait';
  if (NEXT_BY_ID[selId].includes(id)) return 'next';
  return 'dim';
}

// A box's saved state, or its starting data if the map has no entry for it
// (e.g. a box renamed in code while this screen still holds the old map).
function stateOf(flow: Record<string, FeatureState>, id: string): FeatureState {
  return flow[id] ?? defaultStateFor(id);
}

function pointsLabel(st: FeatureState): string {
  return `${st.points.filter((p) => p.done).length}/${st.points.length}`;
}

export function AppFlowView() {
  const { state: auth } = useAuth();
  const userId = auth.status === 'signed-in' ? auth.profile.id : null;
  const isAdmin = auth.status === 'signed-in' && auth.profile.role === 'admin';
  const { width, height } = useWindowDimensions();
  const wide = width >= 900;
  const bottomInset = useSafeBottomOffset(0);

  const [flow, setFlow] = useState<Record<string, FeatureState>>(() => mergeFlowState([]));
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(() => (width >= 900 ? 3 : 2));
  const scale = ZOOMS[zoom];

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setFlow(await fetchAppFlow());
      setNotSetUp(false);
    } catch (e) {
      if (e instanceof AppFlowNotSetUpError) setNotSetUp(true);
      else setLoadError(e instanceof Error ? e.message : 'Could not load App Progress.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Picking another box (or closing) clears the last "Not saved" message.
  const select = useCallback((id: string | null) => {
    setSaveError(null);
    setSelId(id);
  }, []);

  async function tick(id: string, text: string, done: boolean) {
    if (!userId || busyKey) return;
    if (notSetUp) {
      setSaveError('Ticks can’t be saved until the App Progress table is set up in Supabase.');
      return;
    }
    setSaveError(null);
    setBusyKey(`${id}#${text}`);
    setFlow((prev) => {
      const cur = stateOf(prev, id);
      return { ...prev, [id]: { ...cur, points: togglePoint(cur.points, text, done) ?? cur.points } };
    });
    try {
      const saved = await setPointDone(id, text, done, userId);
      setFlow((prev) => ({ ...prev, [id]: saved }));
    } catch (e) {
      setSaveError(e instanceof Error ? `Not saved: ${e.message}` : 'Not saved. Try again.');
      load();
    } finally {
      setBusyKey(null);
    }
  }

  async function changeStatus(id: string, status: FlowStatus) {
    if (!userId || busyKey || stateOf(flow, id).status === status) return;
    if (notSetUp) {
      setSaveError('The status can’t be saved until the App Progress table is set up in Supabase.');
      return;
    }
    setSaveError(null);
    setBusyKey(`${id}:status`);
    const before = stateOf(flow, id);
    setFlow((prev) => ({ ...prev, [id]: { ...stateOf(prev, id), status } }));
    try {
      const saved = await setFeatureStatus(id, status, userId);
      setFlow((prev) => ({ ...prev, [id]: saved }));
    } catch (e) {
      setFlow((prev) => ({ ...prev, [id]: before }));
      setSaveError(e instanceof Error ? `Not saved: ${e.message}` : 'Not saved. Try again.');
    } finally {
      setBusyKey(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<FlowStatus, number> = { ready: 0, ongoing: 0, client: 0, todo: 0 };
    for (const f of FLOW_FEATURES) if (f.code.startsWith('F')) c[stateOf(flow, f.id).status] += 1;
    return c;
  }, [flow]);

  const sel = (selId && FEATURE_BY_ID[selId]) || null;
  const panelHeight = Math.min(Math.round(height * 0.5), 440);

  const panel = sel ? (
    <FlowPanel
      f={sel}
      st={stateOf(flow, sel.id)}
      isAdmin={isAdmin}
      busyKey={busyKey}
      saveError={saveError}
      onClose={() => select(null)}
      onTick={tick}
      onStatus={changeStatus}
    />
  ) : null;

  return (
    <View className="flex-1 bg-neutral-50">
      {/* Summary + zoom */}
      <View className="flex-row items-center px-4 py-2 bg-white border-b border-neutral-200" style={{ gap: 10 }}>
        <View className="flex-1 flex-row flex-wrap items-center" style={{ gap: 10 }}>
          {(['ready', 'ongoing', 'client'] as FlowStatus[]).map((s) => (
            <View key={s} className="flex-row items-center" style={{ gap: 5 }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: STATUS_STYLE[s].bg, borderWidth: 1, borderColor: '#111827' }} />
              <Text className="text-xs text-neutral-700">
                {STATUS_STYLE[s].label} <Text className="font-bold">{counts[s]}</Text>
              </Text>
            </View>
          ))}
        </View>
        {loading ? <ActivityIndicator size="small" color="#0F1F33" /> : null}
        <ToolButton icon="refresh" label="Refresh" onPress={load} />
        <ToolButton icon="remove" label="Zoom out" onPress={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} />
        <ToolButton icon="add" label="Zoom in" onPress={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} />
      </View>

      {/* No strip when the table isn't set up yet (removed on request): the
          starting list shows, and a tick explains in the panel why it didn't save. */}
      {loadError ? (
        <Pressable onPress={load} className="px-4 py-2" style={{ backgroundColor: '#FEE2E2' }}>
          <Text className="text-xs" style={{ color: '#991B1B' }}>
            {loadError} Tap to try again.
          </Text>
        </Pressable>
      ) : null}

      <View className="flex-1 flex-row">
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: !wide && sel ? panelHeight : 0 }}>
          <ScrollView horizontal>
            <Board flow={flow} selId={sel ? sel.id : null} scale={scale} onSelect={select} />
          </ScrollView>
        </ScrollView>

        {wide && panel ? (
          <View style={{ width: 360, borderLeftWidth: 1, borderLeftColor: '#E5E7EB', backgroundColor: '#fff' }}>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>{panel}</ScrollView>
          </View>
        ) : null}
      </View>

      {!wide && panel ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: panelHeight,
            backgroundColor: '#fff',
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            shadowColor: '#0F1F33',
            shadowOpacity: 0.18,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: -4 },
            elevation: 12,
          }}
        >
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottomInset }}>{panel}</ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function ToolButton({ icon, label, onPress, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={{ width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      <Ionicons name={icon} size={18} color="#0F1F33" />
    </Pressable>
  );
}

// ---------------------------------------------------------------- board

function Board({ flow, selId, scale, onSelect }: { flow: Record<string, FeatureState>; selId: string | null; scale: number; onSelect: (id: string) => void }) {
  return (
    <View style={{ width: BOARD_W * scale, height: BOARD_H * scale }}>
      <Svg width={BOARD_W * scale} height={BOARD_H * scale} style={{ position: 'absolute', left: 0, top: 0 }}>
        {FLOW_LINKS.map((l) => (
          <LinkLine key={`${l.from}-${l.to}`} link={l} selId={selId} scale={scale} />
        ))}
      </Svg>
      {FLOW_FEATURES.map((f) => (
        <FlowBox key={f.id} f={f} st={stateOf(flow, f.id)} mark={markFor(f.id, selId)} scale={scale} onPress={() => onSelect(f.id)} />
      ))}
    </View>
  );
}

function LinkLine({ link, selId, scale }: { link: FlowLink; selId: string | null; scale: number }) {
  const pts = linkRoute(link).map((p) => ({ x: p.x * scale, y: p.y * scale }));
  // Tip stops 1px short of the box; the head is drawn on the last segment.
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const down = prev.x === last.x;
  const tip = down ? { x: last.x, y: last.y - 1 } : { x: last.x - 1, y: last.y };
  const head = 7 * Math.max(scale, 0.7);
  const headPts = down
    ? `${tip.x},${tip.y} ${tip.x - head * 0.65},${tip.y - head} ${tip.x + head * 0.65},${tip.y - head}`
    : `${tip.x},${tip.y} ${tip.x - head},${tip.y - head * 0.65} ${tip.x - head},${tip.y + head * 0.65}`;
  const lineEnd = down ? { x: tip.x, y: tip.y - head + 1 } : { x: tip.x - head + 1, y: tip.y };
  const linePts = [...pts.slice(0, -1), lineEnd].map((p) => `${p.x},${p.y}`).join(' ');

  // While a box is selected, its own links are coloured and the rest fade.
  let color = link.launch ? LINE_LAUNCH : LINE;
  let opacity = 1;
  if (selId) {
    if (link.to === selId && FEATURE_BY_ID[selId]?.waits.includes(link.from)) color = WAIT_COLOR;
    else if (link.from === selId) color = NEXT_COLOR;
    else opacity = 0.2;
  }
  return (
    <>
      <Polyline
        points={linePts}
        fill="none"
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth={2}
        strokeDasharray={link.launch ? '6,6' : undefined}
        strokeLinejoin="miter"
      />
      <Polygon points={headPts} fill={color} fillOpacity={opacity} />
    </>
  );
}

function FlowBox({ f, st, mark, scale, onPress }: { f: FlowFeature; st: FeatureState; mark: Mark; scale: number; onPress: () => void }) {
  const { x, y } = boxPosition(f);
  const s = STATUS_STYLE[st.status];
  const ring =
    mark === 'selected'
      ? { borderWidth: 3, borderColor: SELECT_COLOR }
      : mark === 'wait'
        ? { borderWidth: 3, borderColor: WAIT_COLOR }
        : mark === 'next'
          ? { borderWidth: 2, borderColor: NEXT_COLOR, borderStyle: 'dashed' as const }
          : { borderWidth: 1, borderColor: '#111827' };
  const fs = (n: number) => ({ fontSize: n * scale, lineHeight: n * scale * 1.3 });
  // The box is a plain View with two SIBLING buttons — one filling the box,
  // one for the link icon — never a button inside a button (the web renders
  // Pressable as <button>, and a nested <button> is invalid HTML).
  return (
    <View
      style={{
        position: 'absolute',
        left: x * scale,
        top: y * scale,
        width: BOX_W * scale,
        height: BOX_H * scale,
        borderRadius: 14 * scale,
        backgroundColor: s.bg,
        opacity: mark === 'dim' ? 0.3 : 1,
        paddingTop: 26 * scale,
        paddingHorizontal: 10 * scale,
        paddingBottom: 8 * scale,
        alignItems: 'center',
        justifyContent: 'center',
        ...ring,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${f.code} ${f.title}, ${s.label}`}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 14 * scale }}
      />
      <Text style={{ position: 'absolute', top: 8 * scale, left: 12 * scale, fontWeight: '800', color: '#111827', opacity: 0.8, pointerEvents: 'none', ...fs(10) }}>{f.code}</Text>
      {mark === 'wait' || mark === 'next' ? (
        <View
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            top: -11 * scale,
            left: 44 * scale,
            paddingHorizontal: 6 * scale,
            borderRadius: 6,
            backgroundColor: mark === 'wait' ? WAIT_COLOR : NEXT_COLOR,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', ...fs(10) }}>{mark === 'wait' ? 'Waits on' : 'Next'}</Text>
        </View>
      ) : null}
      {/* Link icon: shows what this box waits on and what comes next. */}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Show links for ${f.title}`}
        hitSlop={8}
        style={{
          position: 'absolute',
          top: 5 * scale,
          right: 6 * scale,
          width: 28 * scale,
          height: 28 * scale,
          borderRadius: 7 * scale,
          borderWidth: 1,
          borderColor: '#94A3B8',
          backgroundColor: '#fff',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="git-network-outline" size={15 * scale} color="#0F1F33" />
      </Pressable>
      <Text numberOfLines={1} style={{ color: '#374151', pointerEvents: 'none', ...fs(10) }}>
        {f.category}
      </Text>
      <Text numberOfLines={2} style={{ color: '#111827', fontWeight: '600', textAlign: 'center', marginTop: 2 * scale, pointerEvents: 'none', ...fs(13) }}>
        {f.title}
      </Text>
      <View
        style={{
          pointerEvents: 'none',
          marginTop: 4 * scale,
          paddingHorizontal: 7 * scale,
          paddingVertical: 1 * scale,
          borderRadius: 999,
          backgroundColor: '#fff',
          borderWidth: 1,
          borderColor: s.border,
        }}
      >
        <Text numberOfLines={1} style={{ color: s.text, fontWeight: '700', ...fs(10) }}>
          {s.label}
          {st.points.length ? ` · ${pointsLabel(st)}` : ''}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- panel

function FlowPanel({
  f,
  st,
  isAdmin,
  busyKey,
  saveError,
  onClose,
  onTick,
  onStatus,
}: {
  f: FlowFeature;
  st: FeatureState;
  isAdmin: boolean;
  busyKey: string | null;
  saveError: string | null;
  onClose: () => void;
  onTick: (id: string, text: string, done: boolean) => void;
  onStatus: (id: string, status: FlowStatus) => void;
}) {
  const s = STATUS_STYLE[st.status];
  return (
    <View style={{ gap: 14 }}>
      <View className="flex-row items-start" style={{ gap: 10 }}>
        <View className="flex-1">
          <Text className="text-xs font-bold text-neutral-500">
            {f.code} · {f.category}
          </Text>
          <Text className="text-lg font-bold text-neutral-900 mt-0.5">{f.title}</Text>
          <Text className="text-xs text-neutral-500 mt-0.5">{f.subtitle}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} className="rounded-lg items-center justify-center" style={{ width: 36, height: 36, backgroundColor: '#F1F5F9' }}>
          <Ionicons name="close" size={18} color="#334155" />
        </Pressable>
      </View>

      {isAdmin ? (
        <View style={{ gap: 6 }}>
          <Text className="text-2xs font-bold text-neutral-500">STATUS (ADMIN)</Text>
          <View className="flex-row flex-wrap" style={{ gap: 6 }}>
            {FLOW_STATUSES.map((k) => {
              const active = st.status === k;
              const ks = STATUS_STYLE[k];
              return (
                <Pressable
                  key={k}
                  onPress={() => onStatus(f.id, k)}
                  disabled={!!busyKey}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className="rounded-full px-3 py-1.5"
                  style={{ borderWidth: 1, borderColor: active ? ks.text : '#E5E7EB', backgroundColor: active ? ks.bg : '#fff' }}
                >
                  <Text className="text-xs font-semibold" style={{ color: active ? ks.text : '#6B7280' }}>
                    {ks.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <View className="self-start flex-row items-center rounded-full px-3 py-1" style={{ gap: 6, backgroundColor: s.bg, borderWidth: 1, borderColor: s.border }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.dot }} />
          <Text className="text-xs font-bold" style={{ color: s.text }}>
            {s.label}
          </Text>
        </View>
      )}

      <View style={{ gap: 2, borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 12 }}>
        <Text className="text-xs font-bold text-neutral-900 mb-1">
          POINTS{st.points.length ? ` (${pointsLabel(st)} ticked)` : ''}
        </Text>
        {st.points.length === 0 ? <Text className="text-sm text-neutral-500">Nothing pending.</Text> : null}
        {/* Grouped: Needed from client / To build / To test (empty groups hidden). */}
        {POINT_KINDS.map(({ kind, label }) => {
          const group = st.points.filter((p) => p.kind === kind);
          if (group.length === 0) return null;
          const k = KIND_STYLE[kind];
          return (
            <View key={kind} style={{ marginTop: 6 }}>
              <View className="self-start rounded-md px-2 py-0.5 mb-0.5" style={{ backgroundColor: k.bg }}>
                <Text className="text-2xs font-bold" style={{ color: k.text }}>
                  {label.toUpperCase()} · {group.filter((p) => p.done).length}/{group.length}
                </Text>
              </View>
              {group.map((p) => {
                const busy = busyKey === `${f.id}#${p.text}`;
                return (
                  <Pressable
                    key={p.text}
                    onPress={() => onTick(f.id, p.text, !p.done)}
                    disabled={!!busyKey}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: p.done, busy }}
                    className="flex-row items-center"
                    style={{ gap: 10, minHeight: 44 }}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#15803D" style={{ width: 22 }} />
                    ) : (
                      <Ionicons name={p.done ? 'checkbox' : 'square-outline'} size={22} color={p.done ? '#15803D' : '#6B7280'} />
                    )}
                    <Text className="flex-1 text-sm" style={{ color: p.done ? '#6B7280' : '#111827', textDecorationLine: p.done ? 'line-through' : 'none' }}>
                      {p.text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
        {saveError ? (
          <Text className="text-xs mt-1" style={{ color: '#B91C1C' }}>
            {saveError}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
