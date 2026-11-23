import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Svg, { Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '../ui/AppText';
import { FormModal } from '../ui/FormModal';
import { fetchChecklistNotesForTasks, type ChecklistNotes } from '../../lib/flowchart/checklistNotes';
import {
  buildGantt,
  fmtDay,
  fmtSpan,
  fmtVariance,
  GANTT_COLORS,
  GROUP_BAR,
  layoutGantt,
  PLAN_LINE,
  type GanttLinkPath,
  type GanttRow,
} from '../../lib/flowchart/gantt';
import { LINK_COLOR, LINK_STYLE } from '../../lib/flowchart/linkTypes';
import { todayKey } from '../../lib/flowchart/projected';
import { STATUS_COLORS } from '../../lib/flowchart/sheetReport';
import { DEPENDENCY_TYPE_FULL_LABEL, type FlowchartSeriesEdge, type FlowchartTask } from '../../lib/flowchart/types';

// Flowchart 2 "Gantt View" (2026-11-17, client), modelled on the client's
// reference Gantt: a table on the left (task, reason for delay, delay, days,
// progress), the day-by-day chart on the right with
//   • a thin dark line = planned dates
//   • the coloured bar  = actual dates (dark) + projected days left (light)
//   • amber link lines between linked tasks, drawn like the flowchart's
// Grouped by the outlined boxes on the board. Tap a row for its details.
// The board's Filter applies. All maths lives in lib/flowchart/gantt.ts.

const INK = '#0b0b0b';
const INK_2 = '#52514e';
const MUTED = '#898781';
const BORDER = '#E7E5E0';
const ROW_H = 34;
const HEAD_H = 50;
const LABEL_PAD = 260;
const ZOOMS = [10, 16, 24, 34]; // px per day
const COLS_WIDE = [
  { key: 'task', title: 'Task', w: 250 },
  { key: 'reason', title: 'Reason for delay', w: 210 },
  { key: 'delay', title: 'Delay', w: 56 },
  { key: 'days', title: 'Days', w: 48 },
  { key: 'progress', title: 'Progress', w: 66 },
] as const;
const NARROW_W = 172;

function ToolBtn({ icon, label, active, disabled, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label?: string; active?: boolean; disabled?: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center rounded-lg border"
      style={{
        gap: 5,
        minHeight: 32,
        paddingHorizontal: label ? 10 : 8,
        backgroundColor: active ? '#0F1F33' : '#fff',
        borderColor: active ? '#0F1F33' : '#E5E5E5',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Ionicons name={icon} size={15} color={active ? '#fff' : '#374151'} />
      {label ? <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#fff' : '#374151' }}>{label}</Text> : null}
    </Pressable>
  );
}

function LegendItem({ color, w = 16, h = 8, label }: { color: string; w?: number; h?: number; label: string }) {
  return (
    <View className="flex-row items-center" style={{ gap: 5 }}>
      <View style={{ width: w, height: h, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: INK_2 }}>{label}</Text>
    </View>
  );
}

function LinkLine({ l }: { l: GanttLinkPath }) {
  if (l.soft) {
    return (
      <>
        <Path d={l.d} fill="none" stroke={l.color} strokeWidth={1.2} strokeDasharray="4,3" />
        <Polygon points={l.arrow} fill={l.color} />
      </>
    );
  }
  const st = LINK_STYLE[l.type];
  const dotted = st.dash === '0.1,5';
  return (
    <>
      {st.double ? (
        <>
          <Path d={l.d} fill="none" stroke={l.color} strokeWidth={3.4} strokeLinejoin="round" />
          <Path d={l.d} fill="none" stroke="#fff" strokeWidth={1.2} strokeLinejoin="round" />
        </>
      ) : (
        <Path
          d={l.d}
          fill="none"
          stroke={l.color}
          strokeWidth={dotted ? 2.2 : 1.4}
          strokeLinejoin="round"
          strokeLinecap={st.cap ?? 'butt'}
          strokeDasharray={st.dash ? (dotted ? '0.1,4' : '6,4') : undefined}
        />
      )}
      <Polygon points={l.arrow} fill={l.color} />
    </>
  );
}

function VarianceText({ v, size = 12 }: { v: number | null; size?: number }) {
  const color = v !== null && v > 0 ? '#C0392B' : v !== null && v < 0 ? '#1E8E3E' : MUTED;
  return <Text style={{ fontSize: size, color, fontWeight: v !== null && v > 0 ? '700' : '500' }}>{fmtVariance(v)}</Text>;
}

export function GanttView({
  tasks,
  allTasks,
  seriesEdges,
  projectName,
  filterText,
}: {
  /** The tasks to show (the board's filter applies). */
  tasks: FlowchartTask[];
  /** Every task on the board, so projected dates match the flowchart. */
  allTasks: FlowchartTask[];
  seriesEdges: FlowchartSeriesEdge[];
  projectName: string;
  filterText: string;
}) {
  const screenW = useWindowDimensions().width;
  const phone = screenW < 700;
  const today = todayKey();

  // Reasons for delay (Sheet View). The chart draws straight away; reasons fill in when loaded.
  const [notes, setNotes] = useState<Map<string, ChecklistNotes>>(new Map());
  const idsKey = tasks.map((t) => t.id).join(',');
  useEffect(() => {
    let alive = true;
    fetchChecklistNotesForTasks(tasks.map((t) => t.id))
      .then((n) => alive && setNotes(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const [zoom, setZoom] = useState(phone ? 1 : 2);
  const [showPlan, setShowPlan] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [wideTable, setWideTable] = useState(!phone);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [detail, setDetail] = useState<GanttRow | null>(null);
  const [areaH, setAreaH] = useState(0);

  const data = useMemo(() => buildGantt(tasks, allTasks, seriesEdges, notes, today), [tasks, allTasks, seriesEdges, notes, today]);
  const L = useMemo(
    () => layoutGantt(data, { dayW: ZOOMS[zoom], rowH: ROW_H, labelPad: LABEL_PAD, hideCompleted, collapsed, showPlan, showLinks }),
    [data, zoom, hideCompleted, collapsed, showPlan, showLinks]
  );
  const rowById = useMemo(() => new Map(data.groups.flatMap((g) => g.rows).map((r) => [r.id, r])), [data]);
  const taskCount = data.groups.reduce((s, g) => s + g.rows.length, 0);
  const allCollapsed = data.groups.length > 0 && data.groups.every((g) => collapsed.has(g.key));
  const tableW = wideTable ? COLS_WIDE.reduce((s, c) => s + c.w, 0) : NARROW_W;
  const bodyH = Math.max(0, areaH - HEAD_H);

  // ── Scrolling: the chart scrolls sideways; the table and chart scroll up/down together.
  const hRef = useRef<ScrollView>(null);
  const leftRef = useRef<ScrollView>(null);
  const bodyRef = useRef<ScrollView>(null);
  const lock = useRef<'left' | 'body' | null>(null);
  const unlock = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whichever side the user scrolls leads; the other follows (the lock stops them echoing each other).
  function syncScroll(from: 'left' | 'body', y: number) {
    if (lock.current && lock.current !== from) return;
    lock.current = from;
    if (from === 'left') bodyRef.current?.scrollTo({ y, animated: false });
    else leftRef.current?.scrollTo({ y, animated: false });
    if (unlock.current) clearTimeout(unlock.current);
    unlock.current = setTimeout(() => (lock.current = null), 120);
  }
  const onLeftScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => syncScroll('left', e.nativeEvent.contentOffset.y);
  const onBodyScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => syncScroll('body', e.nativeEvent.contentOffset.y);
  const scrollToToday = (animated = true) => {
    if (L.todayX === null) return;
    hRef.current?.scrollTo({ x: Math.max(0, L.todayX - 7 * L.dayW), animated });
  };
  const ready = areaH > 0;
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => scrollToToday(false), 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, zoom]);

  const toggleGroup = (key: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const showDayLetters = L.dayW >= 16;

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Toolbar + legend */}
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, gap: 8, borderBottomWidth: 1, borderColor: BORDER, backgroundColor: '#FAFAF9' }}>
        <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
          <View style={{ flexGrow: 1, minWidth: 170, marginRight: 4 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: INK }}>Gantt Chart</Text>
            <Text style={{ fontSize: 11, color: INK_2 }} numberOfLines={1}>
              {projectName} · {taskCount} tasks{filterText ? ` · ${filterText}` : ''}
            </Text>
          </View>
          <ToolBtn testID="gantt-today" icon="today-outline" label="Today" onPress={() => scrollToToday()} />
          <ToolBtn testID="gantt-zoom-out" icon="remove" label={phone ? undefined : 'Zoom out'} disabled={zoom === 0} onPress={() => setZoom((z) => Math.max(0, z - 1))} />
          <ToolBtn testID="gantt-zoom-in" icon="add" label={phone ? undefined : 'Zoom in'} disabled={zoom === ZOOMS.length - 1} onPress={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} />
          <ToolBtn testID="gantt-baselines" icon="remove-outline" label="Planned line" active={showPlan} onPress={() => setShowPlan((v) => !v)} />
          <ToolBtn testID="gantt-links" icon="git-network-outline" label="Links" active={showLinks} onPress={() => setShowLinks((v) => !v)} />
          <ToolBtn testID="gantt-hide-completed" icon="eye-off-outline" label="Hide completed" active={hideCompleted} onPress={() => setHideCompleted((v) => !v)} />
          <ToolBtn
            testID="gantt-columns"
            icon={wideTable ? 'chevron-back' : 'chevron-forward'}
            label={wideTable ? 'Fewer columns' : 'All columns'}
            onPress={() => setWideTable((v) => !v)}
          />
          <ToolBtn
            testID="gantt-collapse"
            icon={allCollapsed ? 'chevron-down' : 'chevron-up'}
            label={allCollapsed ? 'Expand all' : 'Collapse all'}
            onPress={() => setCollapsed(allCollapsed ? new Set() : new Set(data.groups.map((g) => g.key)))}
          />
        </View>
        <View className="flex-row flex-wrap items-center" style={{ columnGap: 14, rowGap: 4 }}>
          <LegendItem color={GANTT_COLORS[0].dark} label="Actual (done)" />
          <LegendItem color={GANTT_COLORS[0].light} label="Projected (days left)" />
          <LegendItem color={PLAN_LINE} h={3} label="Planned" />
          <LegendItem color={GROUP_BAR.dark} h={6} label="Group progress" />
          <LegendItem color={LINK_COLOR} h={2} label="Link: FS solid · SS double · FF dotted · SF dashed" />
        </View>
      </View>

      {/* Table + chart */}
      <View style={{ flex: 1, flexDirection: 'row' }} onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}>
        {ready ? (
          <>
            {/* Left: table */}
            <View style={{ width: tableW, borderRightWidth: 1, borderColor: '#D6D5D0', backgroundColor: '#fff' }}>
              <View className="flex-row items-end" style={{ height: HEAD_H, borderBottomWidth: 1, borderColor: '#C9C8C3', paddingBottom: 6 }}>
                {(wideTable ? COLS_WIDE : [{ key: 'task', title: 'Task', w: NARROW_W }]).map((c) => (
                  <Text key={c.key} style={{ width: c.w, paddingHorizontal: 8, fontSize: 11, fontWeight: '700', color: '#6B6A66', textTransform: 'uppercase' }}>
                    {c.title}
                  </Text>
                ))}
              </View>
              <ScrollView ref={leftRef} style={{ height: bodyH }} onScroll={onLeftScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
                {L.lines.map((line) => {
                  if (line.kind === 'group') {
                    const g = line.group;
                    const shut = collapsed.has(g.key);
                    return (
                      <Pressable
                        key={`g-${g.key}`}
                        onPress={() => toggleGroup(g.key)}
                        className="flex-row items-center"
                        style={{ height: ROW_H, backgroundColor: '#F2F1EE', borderBottomWidth: 1, borderColor: '#E9E8E4' }}
                      >
                        <View className="flex-row items-center" style={{ width: wideTable ? COLS_WIDE[0].w + COLS_WIDE[1].w + COLS_WIDE[2].w : NARROW_W, paddingLeft: 6, gap: 4 }}>
                          <Ionicons name={shut ? 'chevron-forward' : 'chevron-down'} size={14} color={INK_2} />
                          <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: INK }} numberOfLines={1}>
                            {g.label}
                          </Text>
                          {!wideTable ? (
                            <Text style={{ fontSize: 10, color: INK_2, paddingRight: 8 }}>
                              {g.days}d · {g.progress}%
                            </Text>
                          ) : null}
                        </View>
                        {wideTable ? (
                          <>
                            <Text style={{ width: COLS_WIDE[3].w, paddingHorizontal: 8, fontSize: 12, fontWeight: '700', color: INK }}>{g.days}d</Text>
                            <Text style={{ width: COLS_WIDE[4].w, paddingHorizontal: 8, fontSize: 12, fontWeight: '700', color: INK }}>{g.progress}%</Text>
                          </>
                        ) : null}
                      </Pressable>
                    );
                  }
                  const r = line.row;
                  const reason = r.reasons.map((x) => `${x.who}: ${x.text}`).join(' · ');
                  return (
                    <Pressable
                      key={r.id}
                      testID={`gantt-row-${r.code}`}
                      onPress={() => setDetail(r)}
                      className="flex-row items-center"
                      style={{ height: ROW_H, borderBottomWidth: 1, borderColor: '#F1F0ED' }}
                    >
                      <View className="flex-row items-center" style={{ width: wideTable ? COLS_WIDE[0].w : NARROW_W, paddingLeft: 10, paddingRight: 6, gap: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: line.group.color.dark }} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, color: INK }} numberOfLines={1}>
                            <Text style={{ fontWeight: '700' }}>{r.code}</Text> {r.name}
                          </Text>
                          {!wideTable && (reason || r.varianceDays) ? (
                            <View className="flex-row items-center" style={{ gap: 4 }}>
                              {r.varianceDays ? <VarianceText v={r.varianceDays} size={10} /> : null}
                              {reason ? (
                                <Text style={{ flex: 1, fontSize: 10, color: INK_2 }} numberOfLines={1}>
                                  {reason}
                                </Text>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      </View>
                      {wideTable ? (
                        <>
                          <Text style={{ width: COLS_WIDE[1].w, paddingHorizontal: 8, fontSize: 11, color: reason ? INK_2 : '#C4C3BF' }} numberOfLines={2}>
                            {reason || '—'}
                          </Text>
                          <View style={{ width: COLS_WIDE[2].w, paddingHorizontal: 8 }}>
                            <VarianceText v={r.varianceDays} />
                          </View>
                          <Text style={{ width: COLS_WIDE[3].w, paddingHorizontal: 8, fontSize: 12, color: INK }}>{r.durationDays === null ? '—' : `${r.durationDays}d`}</Text>
                          <Text style={{ width: COLS_WIDE[4].w, paddingHorizontal: 8, fontSize: 12, color: r.progress === 100 ? '#1E8E3E' : INK }}>{r.progress}%</Text>
                        </>
                      ) : null}
                    </Pressable>
                  );
                })}
                <View style={{ height: 40 }} />
              </ScrollView>
            </View>

            {/* Right: chart (sideways scroll), date header on top */}
            <ScrollView ref={hRef} horizontal style={{ flex: 1 }} showsHorizontalScrollIndicator>
              <View style={{ width: L.width }}>
                <Svg width={L.width} height={HEAD_H}>
                  <Rect x={0} y={0} width={L.width} height={HEAD_H} fill="#fff" />
                  {L.days.map((d) => {
                    const isToday = d.key === today;
                    return (
                      <Rect
                        key={`hb-${d.key}`}
                        x={d.x}
                        y={20}
                        width={L.dayW}
                        height={HEAD_H - 20}
                        fill={isToday ? '#2563EB' : d.sunday ? '#F3F3F1' : '#fff'}
                      />
                    );
                  })}
                  {L.days.map((d) => {
                    const isToday = d.key === today;
                    if (!showDayLetters && !d.monday && !isToday) return null;
                    return (
                      <SvgText
                        key={`hn-${d.key}`}
                        x={d.x + L.dayW / 2}
                        y={showDayLetters ? 34 : 39}
                        fontSize={showDayLetters ? 11 : 9}
                        fontWeight={isToday ? '700' : '400'}
                        fill={isToday ? '#fff' : INK_2}
                        textAnchor="middle"
                      >
                        {d.day}
                      </SvgText>
                    );
                  })}
                  {showDayLetters
                    ? L.days.map((d) => (
                        <SvgText key={`hw-${d.key}`} x={d.x + L.dayW / 2} y={46} fontSize={9} fill={d.key === today ? '#fff' : '#9A9994'} textAnchor="middle">
                          {d.weekday}
                        </SvgText>
                      ))
                    : null}
                  {L.months.map((m) => (
                    <SvgText key={`hm-${m.x}`} x={m.x + 4} y={14} fontSize={11} fontWeight="700" fill="#3A3A40">
                      {m.label}
                    </SvgText>
                  ))}
                  {L.months.map((m) => (
                    <Line key={`hl-${m.x}`} x1={m.x} y1={0} x2={m.x} y2={HEAD_H} stroke="#D6D5D0" strokeWidth={1} />
                  ))}
                  <Line x1={0} y1={HEAD_H - 0.5} x2={L.width} y2={HEAD_H - 0.5} stroke="#C9C8C3" strokeWidth={1} />
                </Svg>

                <ScrollView ref={bodyRef} style={{ height: bodyH }} onScroll={onBodyScroll} scrollEventThrottle={16}>
                  <View style={{ width: L.width, height: L.height + 40 }}>
                    <Svg width={L.width} height={L.height + 40}>
                      {/* Backdrop: Sundays, group rows, today, row lines */}
                      {L.days.filter((d) => d.sunday).map((d) => (
                        <Rect key={`bs-${d.key}`} x={d.x} y={0} width={L.dayW} height={L.height} fill="#F7F7F5" />
                      ))}
                      {L.lines.map((line) =>
                        line.kind === 'group' ? <Rect key={`bg-${line.group.key}`} x={0} y={line.y} width={L.width} height={ROW_H} fill="#F2F1EE" /> : null
                      )}
                      {L.todayX !== null ? <Rect x={L.todayX} y={0} width={L.dayW} height={L.height} fill="#DBEAFE" opacity={0.6} /> : null}
                      {L.lines.map((line, i) => (
                        <Line key={`bl-${i}`} x1={0} y1={line.y + ROW_H - 0.5} x2={L.width} y2={line.y + ROW_H - 0.5} stroke="#EFEEEB" strokeWidth={1} />
                      ))}
                      {/* Links behind the bars */}
                      {L.links.map((l) => (
                        <LinkLine key={`k-${l.id}`} l={l} />
                      ))}
                      {L.rects.map((b) => (
                        <Rect key={b.key} x={b.x} y={b.y} width={b.w} height={b.h} rx={b.r} ry={b.r} fill={b.fill} />
                      ))}
                      {/* Text after the bars, on a thin white outline so link lines never strike through it. */}
                      {L.labels.map((t) => (
                        <SvgText key={`h${t.key}`} x={t.x} y={t.y} fontSize={11} fill="#fff" stroke="#fff" strokeWidth={3} strokeLinejoin="round" fontStyle={t.muted ? 'italic' : 'normal'}>
                          {t.text}
                        </SvgText>
                      ))}
                      {L.labels.map((t) => (
                        <SvgText key={t.key} x={t.x} y={t.y} fontSize={11} fill={t.muted ? '#9A9994' : '#3A3A40'} fontStyle={t.muted ? 'italic' : 'normal'}>
                          {t.text}
                        </SvgText>
                      ))}
                    </Svg>
                    {/* Tap targets: a group row opens/closes it, a task row opens its details. */}
                    {L.lines.map((line) => (
                      <Pressable
                        key={`tap-${line.kind === 'group' ? line.group.key : line.row.id}`}
                        onPress={() => (line.kind === 'group' ? toggleGroup(line.group.key) : setDetail(line.row))}
                        style={{ position: 'absolute', left: 0, top: line.y, width: L.width, height: ROW_H }}
                      />
                    ))}
                  </View>
                </ScrollView>
              </View>
            </ScrollView>
          </>
        ) : null}
      </View>

      {/* Task details */}
      <FormModal visible={!!detail} onRequestClose={() => setDetail(null)} position="bottom" animationType="slide">
        {detail ? <TaskDetail row={detail} links={data.links} rowById={rowById} onClose={() => setDetail(null)} /> : <View />}
      </FormModal>
    </View>
  );
}

function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row" style={{ gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderColor: '#F1F0ED' }}>
      <Text style={{ width: 92, fontSize: 12, color: MUTED }}>{label}</Text>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

function TaskDetail({
  row: r,
  links,
  rowById,
  onClose,
}: {
  row: GanttRow;
  links: { id: string; from: string; to: string; type: keyof typeof DEPENDENCY_TYPE_FULL_LABEL; soft: boolean }[];
  rowById: Map<string, GanttRow>;
  onClose: () => void;
}) {
  const before = links.filter((l) => l.to === r.id).map((l) => ({ l, other: rowById.get(l.from) }));
  const after = links.filter((l) => l.from === r.id).map((l) => ({ l, other: rowById.get(l.to) }));
  const t = r.task;
  const actual = t.actualEndDate
    ? fmtSpan(r.done)
    : t.actualStartDate
      ? `${fmtDay(t.actualStartDate)} → still running`
      : 'Not started';
  const value = (s: string, color = INK) => <Text style={{ fontSize: 13, color }}>{s}</Text>;
  return (
    <View className="bg-white rounded-t-2xl px-4 pt-3 pb-8 w-full self-center" style={{ maxWidth: 560 }}>
      <View className="flex-row items-start" style={{ gap: 8, marginBottom: 6 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: MUTED }}>{r.code}{r.department ? ` · ${r.department}` : ''}</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: INK }}>{r.name}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color="#6B7280" />
        </Pressable>
      </View>
      <DetailLine label="Status">
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: STATUS_COLORS[r.status] }} />
          {value(`${r.status}${r.status === 'In progress' ? ` · ${r.progress}% of its days used` : ''}`)}
        </View>
      </DetailLine>
      <DetailLine label="Planned">{value(r.plan ? `${fmtSpan(r.plan)} (${r.durationDays} days)` : 'No planned dates yet')}</DetailLine>
      <DetailLine label="Actual">{value(actual)}</DetailLine>
      {r.projected ? <DetailLine label="Projected">{value(fmtSpan(r.projected), '#1D4ED8')}</DetailLine> : null}
      <DetailLine label="Delay">
        <View style={{ gap: 2 }}>
          <VarianceText v={r.varianceDays} size={13} />
          {r.label ? value(r.label, INK_2) : null}
        </View>
      </DetailLine>
      <DetailLine label="Reason for delay">
        {r.reasons.length ? (
          <View style={{ gap: 3 }}>
            {r.reasons.map((x, i) => (
              <Text key={i} style={{ fontSize: 13, color: INK }}>
                <Text style={{ fontWeight: '700' }}>{x.who}:</Text> {x.text}
              </Text>
            ))}
          </View>
        ) : (
          value('None written in Sheet View', MUTED)
        )}
      </DetailLine>
      {before.length || after.length ? (
        <DetailLine label="Links">
          <View style={{ gap: 3 }}>
            {before.map(({ l, other }) => (
              <Text key={l.id} style={{ fontSize: 12, color: INK_2 }}>
                After <Text style={{ fontWeight: '700', color: INK }}>{other?.code}</Text> {other?.name} · {DEPENDENCY_TYPE_FULL_LABEL[l.type]}
                {l.soft ? ' (soft)' : ''}
              </Text>
            ))}
            {after.map(({ l, other }) => (
              <Text key={l.id} style={{ fontSize: 12, color: INK_2 }}>
                Before <Text style={{ fontWeight: '700', color: INK }}>{other?.code}</Text> {other?.name} · {DEPENDENCY_TYPE_FULL_LABEL[l.type]}
                {l.soft ? ' (soft)' : ''}
              </Text>
            ))}
          </View>
        </DetailLine>
      ) : null}
    </View>
  );
}
