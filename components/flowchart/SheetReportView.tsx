import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '../ui/AppText';
import { fetchChecklistNotesForTasks, type ChecklistNoteKey, type ChecklistNotes } from '../../lib/flowchart/checklistNotes';
import type { SheetStatusTask } from '../../lib/flowchart/sheetStatus';
import type { Milestone } from '../../lib/flowchart/milestones';
import { FLOOR_LEVEL_PRESETS, ROOM_TYPE_PRESETS } from '../../lib/flowchart/types';
import {
  REPORT_STATUSES,
  SHEET_FIELDS,
  STATUS_COLORS,
  DELAY_RED,
  exportSheetReportExcel,
  printSheetReport,
  responsibleText,
  reasonEntries,
  waitingOn,
  reasonDetail,
  sheetReportRows,
  summarizeReport,
  type ReportStatus,
  type SheetReportRow,
  type ReportSummary,
} from '../../lib/flowchart/sheetReport';

// Flowchart 2 "Reports" tab (2026-11-16): a dashboard, not just a table —
// count tiles, a status donut, tasks per department (stacked by status), the
// most delayed tasks, and how far each checklist point has been filled in.
// Report filters (status / checklist point) plus the top Filter button decide
// which tasks are counted. Excel / Print-PDF download the same report.

// Status filter (2026-11-16): only Completed, Upcoming and Delayed — same as the board's Filter.
const STATUS_OPTIONS = ['All', 'Completed', 'Upcoming', 'Delayed'] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

const INK = '#0b0b0b';
const INK_2 = '#52514e';
const MUTED = '#898781';
const BORDER = '#E7E5E0';
const TRACK = '#F0EFEC';
const DELAY_COLOR = DELAY_RED;
const SERIES_1 = '#0F1F33'; // brand navy
const AMBER = '#F0A227';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

// Report task sheet columns (2026-11-16).
const SHEET_COLS: { label: string; width: number; value: (r: SheetReportRow) => string; style: (r: SheetReportRow) => object }[] = [
  { label: '#', width: 40, value: (r) => String(r.no), style: () => ({ color: '#898781' }) },
  { label: 'Task ID', width: 76, value: (r) => r.taskCode, style: () => ({ color: '#0b0b0b', fontWeight: '700' }) },
  { label: 'Task name', width: 280, value: (r) => r.taskName, style: () => ({ color: '#0b0b0b' }) },
  { label: 'Department', width: 120, value: (r) => r.department, style: () => ({ color: '#52514e' }) },
  { label: 'Planned (completed)', width: 130, value: (r) => r.plannedDates, style: () => ({ color: '#52514e' }) },
  { label: 'Actual (completed)', width: 130, value: (r) => r.actualDates, style: () => ({ color: '#52514e' }) },
  { label: 'Delay', width: 220, value: (r) => r.delay, style: (r) => ({ color: r.delayed ? '#B91C1C' : '#52514e', fontWeight: r.delayed ? '600' : '400' }) },
  // Each written reason on its own line, text only, all in one cell.
  { label: 'Reason for delay', width: 260, value: () => '', style: () => ({}) },
];

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="px-2.5 py-1.5 rounded-full" style={{ backgroundColor: active ? '#0F1F33' : '#F1F5F9' }}>
      <Text className="text-2xs font-semibold" style={{ color: active ? '#fff' : '#475569' }}>{label}</Text>
    </Pressable>
  );
}

function Card({ title, subtitle, children, minWidth = 320 }: { title: string; subtitle?: string; children: React.ReactNode; minWidth?: number }) {
  // Phones (2026-11-16): never wider than the screen (minus the page padding), so cards
  // stack full-width instead of running off the right edge.
  const fit = Math.max(240, useWindowDimensions().width - 32);
  return (
    <View className="rounded-2xl p-4" style={{ backgroundColor: '#fcfcfb', borderWidth: 1, borderColor: BORDER, flexGrow: 1, flexShrink: 1, flexBasis: Math.min(minWidth, fit), minWidth: Math.min(minWidth, fit, 300), maxWidth: '100%' }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: INK }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: 11, color: INK_2, marginTop: 2 }}>{subtitle}</Text> : null}
      <View style={{ marginTop: 12 }}>{children}</View>
    </View>
  );
}

function Tile({ label, value, sub, color, children, wide }: { label: string; value: number; sub?: string; color?: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <View className="rounded-2xl px-4 py-3" style={{ backgroundColor: '#fcfcfb', borderWidth: 1, borderColor: BORDER, flexGrow: 1, flexBasis: wide ? 240 : 130 }}>
      <View className="flex-row items-center gap-1.5">
        {color ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} /> : null}
        <Text style={{ fontSize: 12, color: INK_2 }}>{label}</Text>
      </View>
      <Text style={{ fontSize: 28, fontWeight: '700', color: INK, marginTop: 2 }}>{value}</Text>
      {sub ? <Text style={{ fontSize: 11, color: MUTED }}>{sub}</Text> : null}
      {children}
    </View>
  );
}

// Bar colour per person (2026-11-16): the same colours as the card checklist
// wheel; each department's contractor gets its own shade.
const WHO_COLORS: Record<string, string> = {
  Architect: '#2563EB',
  Consultant: '#7C3AED',
  Client: '#DB2777',
  'Procurement lead time': '#0D9488',
  'Contractor finalization': '#0891B2',
  Other: '#CA8A04',
};
const CONTRACTOR_COLORS = ['#EA580C', '#0EA5E9', '#16A34A', '#9333EA', '#B91C1C', '#0F766E'];
// Other dependencies show their own text ("Roof Erection", "External Civil Works") — each its own shade.
const DEPENDENCY_COLORS = ['#CA8A04', '#65A30D', '#0891B2', '#A16207', '#4D7C0F'];
function whoColor(who: string, contractors: string[], dependencies: string[] = []): string {
  if (WHO_COLORS[who]) return WHO_COLORS[who];
  if (who === 'No reason written') return '#CBD5E1';
  if (who === 'Consultant (MEP)') return '#7C3AED';
  if (who === 'Consultant (Structural)') return '#C026D3';
  const c = contractors.indexOf(who);
  if (c >= 0) return CONTRACTOR_COLORS[c % CONTRACTOR_COLORS.length];
  const d = dependencies.indexOf(who);
  return DEPENDENCY_COLORS[(d < 0 ? 0 : d) % DEPENDENCY_COLORS.length];
}

// Inside the Pending tile: who the pending tasks are waiting on, as thin bars
// (most first) so it reads at a glance without reading the text.
function WaitingOnList({ items, total }: { items: { who: string; tasks: number }[]; total: number }) {
  if (items.length === 0) return null;
  const isContractor = (w: string) => /contractor( — |$)/i.test(w);
  const contractors = items.map((x) => x.who).filter(isContractor).sort();
  const dependencies = items.map((x) => x.who).filter((w) => !isContractor(w) && !WHO_COLORS[w] && !w.startsWith('Consultant') && w !== 'No reason written');
  const delays = items.reduce((a, x) => a + x.tasks, 0);
  return (
    <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderColor: BORDER, gap: 7 }}>
      {/* Bars count delays: a task with two delays (e.g. Architect and Consultant) counts in both. */}
      {delays !== total ? (
        <Text style={{ fontSize: 11, color: MUTED }}>
          {delays} delays across {total} tasks · a task with 2 delays counts in both
        </Text>
      ) : null}
      {items.map((x) => {
        const none = x.who === 'No reason written';
        return (
          <View key={x.who}>
            <View className="flex-row items-center" style={{ gap: 6, marginBottom: 3 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, color: none ? MUTED : INK_2, fontStyle: none ? 'italic' : 'normal' }}>{x.who}</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: INK }}>{x.tasks}</Text>
            </View>
            <View style={{ height: 5, borderRadius: 3, backgroundColor: TRACK, overflow: 'hidden' }}>
              <View style={{ width: `${total > 0 ? Math.min(100, (x.tasks / total) * 100) : 0}%`, height: 5, borderRadius: 3, backgroundColor: whoColor(x.who, contractors, dependencies) }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Donut: one ring, a 2px surface gap between segments, total in the middle.
function StatusDonut({ byStatus, total }: { byStatus: Record<ReportStatus, number>; total: number }) {
  // Bigger donut (2026-11-16).
  const size = 240;
  const stroke = 36;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 1 ? 2 : 0;
  let offset = 0;
  const segs = REPORT_STATUSES.filter((s) => byStatus[s] > 0).map((s) => {
    const len = (byStatus[s] / Math.max(total, 1)) * c;
    const seg = { s, len: Math.max(len - gap, 0.5), offset };
    offset += len;
    return seg;
  });
  return (
    <View className="flex-row flex-wrap items-center" style={{ gap: 20 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={TRACK} strokeWidth={stroke} fill="none" />
          {segs.map((g) => (
            <Circle
              key={g.s}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={STATUS_COLORS[g.s]}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${g.len} ${c - g.len}`}
              strokeDashoffset={-g.offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ))}
        </Svg>
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
          <Text style={{ fontSize: 34, fontWeight: '700', color: INK }}>{total}</Text>
          <Text style={{ fontSize: 11, color: INK_2 }}>tasks</Text>
        </View>
      </View>
      <View style={{ gap: 10 }}>
        {REPORT_STATUSES.map((s) => (
          <View key={s} className="flex-row items-center" style={{ gap: 8 }}>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: STATUS_COLORS[s] }} />
            <Text style={{ fontSize: 13, color: INK, width: 116 }}>{s}</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: INK, width: 30, textAlign: 'right' }}>{byStatus[s]}</Text>
            <Text style={{ fontSize: 12, color: MUTED, width: 40, textAlign: 'right' }}>{pct(byStatus[s], total)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Legend() {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 12, marginBottom: 10 }}>
      {REPORT_STATUSES.map((s) => (
        <View key={s} className="flex-row items-center" style={{ gap: 5 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: STATUS_COLORS[s] }} />
          <Text style={{ fontSize: 11, color: INK_2 }}>{s}</Text>
        </View>
      ))}
    </View>
  );
}

// Horizontal bars: label · bar · value. Stacked segments get a 2px surface gap.
function BarRow({
  label,
  parts,
  max,
  value,
  labelWidth = 130,
  note,
}: {
  label: string;
  parts: { color: string; n: number }[];
  max: number;
  value: string;
  labelWidth?: number;
  /** Small grey line under the bar (e.g. the task's delay reasons). */
  note?: string;
}) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  // Phones: label on its own line above the bar so the bar gets the full width.
  const narrow = useWindowDimensions().width < 640;
  const labelEl = (
    <Text numberOfLines={2} style={{ width: narrow ? undefined : labelWidth, fontSize: 12, color: INK, marginBottom: narrow ? 3 : 0 }}>
      {label}
    </Text>
  );
  return (
    <View style={{ marginBottom: 10 }}>
    {narrow ? labelEl : null}
    <View className="flex-row items-center" style={{ gap: 8 }}>
      {narrow ? null : labelEl}
      <View style={{ flex: 1, height: 14, borderRadius: 4, backgroundColor: TRACK, overflow: 'hidden' }}>
        <View style={{ width: `${max > 0 ? Math.min(100, (total / max) * 100) : 0}%`, height: 14, flexDirection: 'row', gap: 2 }}>
          {parts
            .filter((p) => p.n > 0)
            .map((p, i, arr) => (
              <View
                key={i}
                style={{
                  flex: p.n,
                  backgroundColor: p.color,
                  borderTopRightRadius: i === arr.length - 1 ? 4 : 0,
                  borderBottomRightRadius: i === arr.length - 1 ? 4 : 0,
                }}
              />
            ))}
        </View>
      </View>
      <Text numberOfLines={1} style={{ minWidth: 44, maxWidth: 110, fontSize: 12, fontWeight: '700', color: INK, textAlign: 'right' }}>{value}</Text>
    </View>
    {note ? <Text style={{ fontSize: 11, color: INK_2, marginLeft: narrow ? 0 : labelWidth + 8, marginTop: 3 }}>{note}</Text> : null}
    </View>
  );
}

// One "Responsible — by who" box: a tile per person, then each person's task list.
function ResponsibleCard({
  title,
  reasons,
  countLabel,
  countColor,
  noReason,
}: {
  title: string;
  reasons: ReportSummary['reasons'];
  countLabel: string;
  countColor: string;
  noReason: number;
}) {
  return (
    <Card title={title} minWidth={380}>
      {reasons.length === 0 ? (
        <Text style={{ fontSize: 12, color: MUTED }}>No reasons written yet.</Text>
      ) : (
        <>
          <View className="flex-row flex-wrap" style={{ gap: 8, marginBottom: 14 }}>
            {reasons.map((x) => (
              <View key={x.who} style={{ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FEF5E4', minWidth: 96 }}>
                <Text style={{ fontSize: 12, color: '#412402', fontWeight: '600' }}>{x.who}</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: INK }}>{x.tasks}</Text>
              </View>
            ))}
          </View>
          {reasons.map((x) => (
            <View key={x.who} style={{ borderLeftWidth: 3, borderColor: AMBER, paddingLeft: 10, marginBottom: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: INK, marginBottom: 4 }}>{x.who}</Text>
              {x.items.map((it, i) => (
                <Text key={i} style={{ fontSize: 12, color: INK, marginBottom: 4 }}>
                  {it.taskName}
                </Text>
              ))}
            </View>
          ))}
        </>
      )}
      {noReason > 0 ? (
        <Text style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
          {noReason} {countLabel} task{noReason === 1 ? ' has' : 's have'} no one responsible written.
        </Text>
      ) : null}
    </Card>
  );
}

/** The flowchart page's own filters, shown inside Reports too (2026-11-16). */
export interface ReportPageFilters {
  departments: string[];
  department: string | null;
  floor: string | null;
  room: string | null;
  milestones: Milestone[];
  milestoneId: string | null;
  plannedDateText: string | null;
  onDepartment: (v: string | null) => void;
  onFloor: (v: string | null) => void;
  onRoom: (v: string | null) => void;
  onMilestone: (v: string | null) => void;
  /** Opens the full filter panel (for the Planned Date range). */
  onOpenFilters: () => void;
}

function ChipLine({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: MUTED, width: 86 }}>{label}</Text>
      <Chip label="All" active={value === null} onPress={() => onChange(null)} />
      {options.map((o) => (
        <Chip key={o.value} label={o.label} active={value === o.value} onPress={() => onChange(value === o.value ? null : o.value)} />
      ))}
    </View>
  );
}

export function SheetReportView({
  tasks,
  projectName,
  topFilterText,
  pageFilters,
}: {
  pageFilters: ReportPageFilters;
  tasks: ({ id: string; taskId: string; taskName: string; workName: string } & SheetStatusTask)[];
  projectName: string;
  /** What the top Filter button is set to, e.g. "Electrical", or "" for none. */
  topFilterText: string;
}) {
  const [notes, setNotes] = useState<Map<string, ChecklistNotes> | null>(null);
  const [status, setStatus] = useState<StatusOption>('All');
  const [point, setPoint] = useState<ChecklistNoteKey | null>(null);
  const [showTable, setShowTable] = useState(true);
  const [busy, setBusy] = useState<'excel' | 'pdf' | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const idsKey = tasks.map((t) => t.id).join(',');

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    fetchChecklistNotesForTasks(idsKey ? idsKey.split(',') : [])
      .then((m) => !cancelled && setNotes(m))
      .catch(() => !cancelled && setNotes(new Map()));
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const allRows = useMemo(() => (notes ? sheetReportRows(tasks, notes, todayKey()) : []), [tasks, notes]);
  const rows = useMemo(
    () =>
      allRows
        .filter((r) => (status === 'All' ? true : r.status === status))
        .filter((r) => (point ? !!r.notes[point]?.trim() : true))
        .map((r, i) => ({ ...r, no: i + 1 })),
    [allRows, status, point]
  );
  const sum = useMemo(() => summarizeReport(rows), [rows]);
  // "Responsible — by who": delayed tasks only, matching the bars in the Delayed box (Client hidden there too).
  const delayedReasons = useMemo(
    () => summarizeReport(rows.filter((r) => r.status === 'Delayed')).reasons.filter((x) => x.who !== 'Client'),
    [rows]
  );
  const upcomingReasons = useMemo(
    () => summarizeReport(rows.filter((r) => r.status === 'Upcoming')).reasons.filter((x) => x.who !== 'Client'),
    [rows]
  );
  const completedReasons = useMemo(
    () => summarizeReport(rows.filter((r) => r.status === 'Completed')).reasons.filter((x) => x.who !== 'Client'),
    [rows]
  );
  const screenWidth = useWindowDimensions().width;

  const filterText =
    [topFilterText, status !== 'All' ? status : '', point ? `${SHEET_FIELDS.find((f) => f.key === point)?.label} written` : '']
      .filter(Boolean)
      .join(' · ') || 'All tasks';

  async function run(kind: 'excel' | 'pdf') {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'excel') {
        const note = await exportSheetReportExcel(rows, projectName, filterText);
        setMessage({ text: note || `Excel report with ${rows.length} tasks downloaded`, error: false });
      } else {
        await printSheetReport(rows, projectName, filterText);
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  if (!notes) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#f9f9f7' }}>
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  const deptMax = Math.max(1, ...sum.departments.map((d) => d.total));
  const delayMax = Math.max(1, ...sum.topDelayed.map((r) => r.delayDays));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f9f9f7' }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      {/* Header + downloads */}
      <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: INK }}>Flowchart 2 report</Text>
          <Text style={{ fontSize: 12, color: INK_2 }}>
            {projectName} · {filterText} · {new Date().toLocaleDateString()}
          </Text>
        </View>
        <Pressable
          testID="report-excel"
          onPress={() => void run('excel')}
          disabled={busy !== null || rows.length === 0}
          className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg"
          style={{ backgroundColor: '#0F1F33', opacity: busy !== null || rows.length === 0 ? 0.5 : 1 }}
        >
          {busy === 'excel' ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="document-outline" size={14} color="#fff" />}
          <Text className="text-xs font-bold text-white">Download Excel</Text>
        </Pressable>
        <Pressable
          testID="report-pdf"
          onPress={() => void run('pdf')}
          disabled={busy !== null || rows.length === 0}
          className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg border"
          style={{ borderColor: '#0F1F33', backgroundColor: '#fff', opacity: busy !== null || rows.length === 0 ? 0.5 : 1 }}
        >
          {busy === 'pdf' ? <ActivityIndicator size="small" color="#0F1F33" /> : <Ionicons name="print-outline" size={14} color="#0F1F33" />}
          <Text className="text-xs font-bold" style={{ color: '#0F1F33' }}>Print / PDF</Text>
        </Pressable>
      </View>
      {message ? <Text style={{ fontSize: 12, color: message.error ? '#B91C1C' : INK }}>{message.text}</Text> : null}

      {/* Filters, one row above the charts */}
      <View className="rounded-2xl p-3" style={{ backgroundColor: '#fcfcfb', borderWidth: 1, borderColor: BORDER, gap: 8 }}>
        <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: MUTED, width: 86 }}>STATUS</Text>
          {STATUS_OPTIONS.map((s) => (
            <Chip key={s} label={s} active={status === s} onPress={() => setStatus(s)} />
          ))}
        </View>
        <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: MUTED, width: 86 }}>WRITTEN IN</Text>
          <Chip label="Any" active={point === null} onPress={() => setPoint(null)} />
          {SHEET_FIELDS.map((f) => (
            <Chip key={f.key} label={f.label} active={point === f.key} onPress={() => setPoint(point === f.key ? null : f.key)} />
          ))}
        </View>
        <ChipLine
          label="DEPARTMENT"
          options={pageFilters.departments.map((d) => ({ value: d, label: d }))}
          value={pageFilters.department}
          onChange={pageFilters.onDepartment}
        />
        <ChipLine label="FLOOR" options={FLOOR_LEVEL_PRESETS.map((f) => ({ value: f, label: f }))} value={pageFilters.floor} onChange={pageFilters.onFloor} />
        <ChipLine label="ROOM" options={ROOM_TYPE_PRESETS.map((r) => ({ value: r, label: r }))} value={pageFilters.room} onChange={pageFilters.onRoom} />
        {pageFilters.milestones.length > 0 ? (
          <ChipLine
            label="MILESTONE"
            options={pageFilters.milestones.map((m) => ({ value: m.id, label: m.name }))}
            value={pageFilters.milestoneId}
            onChange={pageFilters.onMilestone}
          />
        ) : null}
        <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: MUTED, width: 86 }}>PLANNED DATE</Text>
          <Chip label={pageFilters.plannedDateText ?? 'Pick a date range'} active={!!pageFilters.plannedDateText} onPress={pageFilters.onOpenFilters} />
        </View>
      </View>

      {/* Headline tiles */}
      {/* Tiles keep their own height (a short tile no longer stretches to the Pending tile's). */}
      <View className="flex-row flex-wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Tile label="Total tasks" value={sum.total} sub="Delayed + Upcoming + Completed" />
        {REPORT_STATUSES.map((s) => (
          <Tile key={s} label={s} value={sum.byStatus[s]} sub={`${pct(sum.byStatus[s], sum.total)}% of tasks`} color={STATUS_COLORS[s]} >
            {/* Who the tasks are waiting on — Delayed and Upcoming (2026-11-16). Client is passed over for the task's next reason. */}
            <WaitingOnList items={waitingOn(rows.filter((r) => r.status === s), ['Client'])} total={sum.byStatus[s]} />
          </Tile>
        ))}
      </View>

      {rows.length === 0 ? (
        <Text style={{ fontSize: 13, color: MUTED, padding: 12 }}>No tasks match this report.</Text>
      ) : (
        <>
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <Card title="Most delayed tasks" subtitle="Top 10 by total days of delay" minWidth={420}>
              {sum.topDelayed.length === 0 ? (
                <Text style={{ fontSize: 12, color: MUTED }}>No delayed tasks in this report.</Text>
              ) : (
                sum.topDelayed.map((r) => (
                  <BarRow
                    key={`${r.no}-${r.taskName}`}
                    label={`${r.taskCode} · ${r.taskName}`}
                    labelWidth={180}
                    parts={[{ color: DELAY_COLOR, n: r.delayDays }]}
                    max={delayMax}
                    value={`${r.delayDays}d`}
                    note={responsibleText(r) ? `Responsible: ${responsibleText(r)}` : 'No one responsible written'}
                  />
                ))
              )}
            </Card>
            <Card title="Checklist filled in" subtitle={`Tasks with something written, out of ${sum.total}`}>
              {sum.checklist.map((c) => (
                <BarRow
                  key={c.key}
                  label={c.label}
                  labelWidth={150}
                  parts={[{ color: SERIES_1, n: c.written }]}
                  max={sum.total}
                  value={`${c.written} · ${pct(c.written, sum.total)}%`}
                />
              ))}
            </Card>
          </View>

          {/* Dependencies: Delayed with Completed under it on the left, Upcoming on the right (2026-11-16).
              Each card sits in its own row so it sizes by width, never by a fixed height. */}
          <View className="flex-row flex-wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: Math.min(380, Math.max(240, screenWidth - 32)), gap: 12 }}>
              <View className="flex-row">
                <ResponsibleCard
                  title="Dependencies for Delayed Tasks"
                  reasons={delayedReasons}
                  countLabel="delayed"
                  countColor={DELAY_COLOR}
                  noReason={rows.filter((r) => r.status === 'Delayed' && reasonEntries(r).length === 0).length}
                />
              </View>
              <View className="flex-row">
                <ResponsibleCard
                  title="Dependencies for Completed Tasks"
                  reasons={completedReasons}
                  countLabel="completed"
                  countColor={MUTED}
                  noReason={rows.filter((r) => r.status === 'Completed' && reasonEntries(r).length === 0).length}
                />
              </View>
            </View>
            <ResponsibleCard
              title="Dependencies for Upcoming Tasks"
              reasons={upcomingReasons}
              countLabel="upcoming"
              countColor={MUTED}
              noReason={rows.filter((r) => r.status === 'Upcoming' && reasonEntries(r).length === 0).length}
            />
          </View>

          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
          <Card title="Delay by department" subtitle="Delayed tasks and total days of delay" minWidth={420}>
            {sum.departments.map((d) => (
              <View key={d.name} className="flex-row items-center" style={{ paddingVertical: 6, borderBottomWidth: 1, borderColor: BORDER }}>
                <Text style={{ flex: 1, fontSize: 12, color: INK }}>{d.name}</Text>
                <Text style={{ width: 120, fontSize: 12, color: INK_2, textAlign: 'right' }}>
                  {d.delayed} of {d.total} delayed
                </Text>
                <Text style={{ width: 80, fontSize: 12, fontWeight: '700', color: INK, textAlign: 'right' }}>{d.delayDays}d</Text>
              </View>
            ))}
          </Card>
          </View>

          {/* Table view */}
          <Pressable onPress={() => setShowTable((v) => !v)} className="flex-row items-center" style={{ gap: 6, paddingVertical: 4 }}>
            <Ionicons name={showTable ? 'chevron-down' : 'chevron-forward'} size={16} color={INK} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>Task sheet ({rows.length})</Text>
            <Text style={{ fontSize: 11, color: MUTED }}>Delayed → Upcoming → Completed</Text>
          </Pressable>
          {showTable ? (
            <ScrollView horizontal>
              <View style={{ borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff' }}>
                <View className="flex-row" style={{ backgroundColor: '#F1F5F9' }}>
                  {SHEET_COLS.map((c) => (
                    <Text key={c.label} style={{ width: c.width, padding: 8, fontSize: 11, fontWeight: '700', color: INK_2 }}>{c.label}</Text>
                  ))}
                </View>
                {REPORT_STATUSES.map((s) => {
                  const group = rows.filter((r) => r.status === s);
                  if (group.length === 0) return null;
                  return (
                    <View key={s}>
                      {/* Group heading */}
                      <View className="flex-row items-center" style={{ gap: 8, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: '#F8FAFC', borderTopWidth: 1, borderColor: BORDER }}>
                        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: STATUS_COLORS[s] }} />
                        <Text style={{ fontSize: 13, fontWeight: '700', color: INK }}>{s}</Text>
                        <Text style={{ fontSize: 12, color: MUTED }}>{group.length} task{group.length === 1 ? '' : 's'}</Text>
                      </View>
                      {group.map((r: SheetReportRow, i) => (
                        <View key={`${r.no}-${r.taskName}`} className="flex-row" style={{ borderTopWidth: 1, borderColor: BORDER, backgroundColor: i % 2 ? '#FCFCFB' : '#fff' }}>
                          {SHEET_COLS.map((c) =>
                            c.label === 'Reason for delay' ? (
                              // Who in bold navy, the written text under it; one block per reason.
                              <View key={c.label} style={{ width: c.width, padding: 8, gap: 6 }}>
                                {reasonEntries(r).map((e, k) => (
                                  <View key={k}>
                                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#0F1F33' }}>{e.who}</Text>
                                    {reasonDetail(e) ? <Text style={{ fontSize: 12, color: '#52514e' }}>{e.text}</Text> : null}
                                  </View>
                                ))}
                              </View>
                            ) : (
                              <Text key={c.label} style={{ width: c.width, padding: 8, fontSize: 12, ...c.style(r) }}>{c.value(r)}</Text>
                            )
                          )}
                        </View>
                      ))}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}

          {/* Status pie + tasks by department, moved to the end of the report (2026-11-16). */}
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <Card title="Task status" subtitle="Delayed, upcoming and completed tasks">
              <StatusDonut byStatus={sum.byStatus} total={sum.total} />
            </Card>
            <Card title="Tasks by department" subtitle="Each bar split by status" minWidth={420}>
              <Legend />
              {sum.departments.map((d) => (
                <BarRow
                  key={d.name}
                  label={d.name}
                  parts={REPORT_STATUSES.map((s) => ({ color: STATUS_COLORS[s], n: d.byStatus[s] }))}
                  max={deptMax}
                  value={String(d.total)}
                />
              ))}
            </Card>
          </View>
        </>
      )}
    </ScrollView>
  );
}
