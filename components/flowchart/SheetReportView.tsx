import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { useProject } from '../../lib/ProjectContext';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '../ui/AppText';
import { fetchChecklistNotesForTasks, type ChecklistNoteKey, type ChecklistNotes } from '../../lib/flowchart/checklistNotes';
import type { SheetStatusTask } from '../../lib/flowchart/sheetStatus';
import type { Milestone } from '../../lib/flowchart/milestones';
import { FLOOR_LEVEL_PRESETS, ROOM_TYPE_PRESETS } from '../../lib/flowchart/types';
import {
  exportMilestoneExcel,
  fmtDay,
  milestoneSummary,
  differenceText,
  lineDelay,
  printMilestoneReport,
  type MilestoneSummary,
} from '../../lib/flowchart/milestoneReport';
import {
  REPORT_STATUSES,
  SHEET_FIELDS,
  STAGED_SHEET_FIELDS,
  STATUS_COLORS,
  DELAY_RED,
  exportSheetReportExcel,
  printSheetReport,
  partyRows,
  partyRowsStaged,
  stagedWaitingOn,
  hasAnyReason,
  reportParties,
  reportTitle,
  reportFileName,
  toggleStatus,
  responsibleText,
  reasonEntries,
  waitingOn,
  reasonDetail,
  sheetReportRows,
  asConstructionRows,
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

// Status filter (2026-11-16): only Completed, Upcoming and Pending — same as the board's Filter.
const STATUS_OPTIONS = ['All', 'Pending', 'In progress', 'Upcoming', 'Completed'] as const;
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
  'Material Procurement Status': '#0D9488',
  'Contractor / Vendor Finalization': '#0891B2',
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
            <View style={{ height: 10, borderRadius: 5, backgroundColor: TRACK, overflow: 'hidden' }}>
              <View style={{ width: `${total > 0 ? Math.min(100, (x.tasks / total) * 100) : 0}%`, height: 10, borderRadius: 5, backgroundColor: whoColor(x.who, contractors, dependencies) }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Past Works status box (2026-11-21): "waiting on" for Pre-construction and
// Construction separately, each under its own heading; then tasks with no
// reason in either stage.
function StagedWaitingOn({ rows, total }: { rows: SheetReportRow[]; total: number }) {
  const w = stagedWaitingOn(rows, ['Client']);
  const part = (label: string, items: { who: string; tasks: number }[]) =>
    items.length ? (
      <View key={label}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: INK, marginTop: 10 }}>{label}</Text>
        <WaitingOnList items={items} total={total} />
      </View>
    ) : null;
  return (
    <>
      {part('Pre-construction delays', w.pre)}
      {part('Construction delays', w.construction)}
      {w.none ? <WaitingOnList items={[{ who: 'No reason written', tasks: w.none }]} total={total} /> : null}
    </>
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

function Legend({ only }: { only?: ReportStatus[] | null }) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 12, marginBottom: 10 }}>
      {REPORT_STATUSES.filter((s) => !only || only.includes(s)).map((s) => (
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
  showCounts = false,
}: {
  label: string;
  parts: { color: string; n: number }[];
  max: number;
  value: string;
  labelWidth?: number;
  /** Small grey line under the bar (e.g. the task's delay reasons). */
  note?: string;
  /** Show each part's number inside the bar. */
  showCounts?: boolean;
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
      <View style={{ flex: 1, height: 32, borderRadius: 8, backgroundColor: TRACK, overflow: 'hidden' }}>
        <View style={{ width: `${max > 0 ? Math.min(100, (total / max) * 100) : 0}%`, height: 32, flexDirection: 'row', gap: 2 }}>
          {parts
            .filter((p) => p.n > 0)
            .map((p, i, arr) => (
              <View
                key={i}
                style={{
                  flex: p.n,
                  minWidth: showCounts ? 26 : undefined,
                  backgroundColor: p.color,
                  borderTopRightRadius: i === arr.length - 1 ? 4 : 0,
                  borderBottomRightRadius: i === arr.length - 1 ? 4 : 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {/* Count inside each coloured part (2026-11-16), e.g. Civil Works 30 · 9 · 9. */}
                {showCounts ? (
                  <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: p.color === '#F0A227' ? '#0F172A' : '#fff' }}>
                    {p.n}
                  </Text>
                ) : null}
              </View>
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
  const whos = reasons.map((x) => x.who);
  const contractors = whos.filter((w) => /contractor( — |$)/i.test(w)).sort();
  const dependencies = whos.filter((w) => !/contractor( — |$)/i.test(w) && !WHO_COLORS[w] && !w.startsWith('Consultant') && w !== 'No reason written');
  const depColor = (w: string) => whoColor(w, contractors, dependencies);
  return (
    <Card title={title} minWidth={380}>
      {/* depColor: same colours as the "waiting on" bars */}
      {reasons.length === 0 ? (
        <Text style={{ fontSize: 12, color: MUTED }}>No reasons written yet.</Text>
      ) : (
        <>
          {reasons.map((x) => (
            // Heading in the person's bar colour with the count beside it (2026-11-16); no chip row.
            <View key={x.who} style={{ borderLeftWidth: 3, borderColor: depColor(x.who), paddingLeft: 10, marginBottom: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: depColor(x.who), marginBottom: 4 }}>
                {x.who} <Text style={{ color: INK }}>{x.tasks}</Text>
              </Text>
              {x.items.map((it, i) => (
                <View key={i} style={{ marginBottom: 5 }}>
                  <Text style={{ fontSize: 12, color: INK }}>{it.taskName}</Text>
                  {/* Reason text under the task (2026-11-16), unless it just repeats the heading. */}
                  {it.text && it.text.toLowerCase() !== x.who.toLowerCase() ? (
                    <Text style={{ fontSize: 11, color: INK_2, marginTop: 1 }}>{it.text}</Text>
                  ) : null}
                </View>
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
  stages = false,
  copiedTaskIds,
  pastMilestones,
}: {
  /** Past Tasks (2026-11-21): the 4 client milestones; one picked → the report covers only its tasks. */
  /** Past Tasks Copy: the level columns instead (title 'LEVEL'), same report format. */
  pastMilestones?: { title?: string; options: { value: string; label: string }[]; value: string | null; onChange: (v: string | null) => void };
  /** Past Tasks (2026-11-21): Pre-construction and Construction delays reported separately. */
  stages?: boolean;
  /** Past Works: the Current Status tasks copied onto that board — their
   *  Pre-construction is their own Past Works one (copyPreConstruction). */
  copiedTaskIds?: ReadonlySet<string>;
  pageFilters: ReportPageFilters;
  tasks: ({ id: string; taskId: string; taskName: string; workName: string } & SheetStatusTask)[];
  projectName: string;
  /** What the top Filter button is set to, e.g. "Electrical", or "" for none. */
  topFilterText: string;
}) {
  const { selectedProjectId } = useProject();
  const [notes, setNotes] = useState<Map<string, ChecklistNotes> | null>(null);
  // Past Tasks: Construction-stage delays (empty if that table isn't set up yet).
  const [constructionNotes, setConstructionNotes] = useState<Map<string, ChecklistNotes> | null>(null);
  // Status can be more than one (2026-11-17, client): e.g. Pending + Upcoming in one report. [] = All.
  const [statuses, setStatuses] = useState<ReportStatus[]>([]);
  const pickStatus = (s: StatusOption) => setStatuses((cur) => toggleStatus(cur, s));
  const statusOn = (s: StatusOption) => (s === 'All' ? statuses.length === 0 : statuses.includes(s));
  const [point, setPoint] = useState<ChecklistNoteKey | null>(null);
  // Report for one party (2026-11-16): Architect, Consultant (MEP) … — separate from the normal filters.
  const [party, setParty] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(true);
  const [busy, setBusy] = useState<'excel' | 'pdf' | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const idsKey = tasks.map((t) => t.id).join(',');
  const copiedKey = [...(copiedTaskIds ?? [])].sort().join(',');

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    setConstructionNotes(null);
    const ids = idsKey ? idsKey.split(',') : [];
    const copied = new Set(copiedKey ? copiedKey.split(',') : []);
    const empty = () => new Map<string, ChecklistNotes>();
    Promise.all([
      fetchChecklistNotesForTasks(ids.filter((id) => !copied.has(id))).catch(empty),
      copied.size ? fetchChecklistNotesForTasks(ids.filter((id) => copied.has(id)), 'copyPreConstruction').catch(empty) : Promise.resolve(empty()),
      stages ? fetchChecklistNotesForTasks(ids, 'construction').catch(empty) : Promise.resolve(null),
    ]).then(([pre, copiedPre, construction]) => {
      if (cancelled) return;
      for (const [id, n] of copiedPre) pre.set(id, n);
      setNotes(pre);
      setConstructionNotes(construction);
    });
    return () => {
      cancelled = true;
    };
  }, [idsKey, copiedKey, stages]);

  const allRows = useMemo(
    () => (notes ? sheetReportRows(tasks, notes, todayKey(), stages ? constructionNotes ?? new Map() : undefined) : []),
    [tasks, notes, constructionNotes, stages]
  );
  const parties = useMemo(() => reportParties(allRows), [allRows]);
  // Past Works: a party / checklist point counts in either stage (Pre-construction or Construction).
  const byParty = (rs: SheetReportRow[], p: string) => (stages ? partyRowsStaged(rs, p) : partyRows(rs, p));
  const partyAll = useMemo(() => (party ? byParty(allRows, party) : []), [allRows, party, stages]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(
    () =>
      (party ? byParty(allRows, party) : allRows)
        .filter((r) => statuses.length === 0 || statuses.includes(r.status))
        .filter((r) => (point ? !!r.notes[point]?.trim() || (stages && !!r.constructionNotes?.[point]?.trim()) : true))
        .map((r, i) => ({ ...r, no: i + 1 })),
    [allRows, statuses, point, party, stages] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sum = useMemo(() => summarizeReport(rows), [rows]);
  // Past Tasks: the same tasks (same filters), with their Construction-stage delays.
  const constructionRows = useMemo(() => {
    if (!stages) return null;
    const c = asConstructionRows(allRows);
    return (party ? partyRows(c, party) : c)
      .filter((r) => statuses.length === 0 || statuses.includes(r.status))
      .filter((r) => (point ? !!r.notes[point]?.trim() : true))
      .map((r, i) => ({ ...r, no: i + 1 }));
  }, [stages, allRows, party, statuses, point]);
  const picked: ReportStatus[] | null = statuses.length ? statuses : null;
  const statusText = statuses.join(' + '); // "Pending + Upcoming"
  // "Responsible — by who": delayed tasks only, matching the bars in the Pending box (Client hidden there too).
  const screenWidth = useWindowDimensions().width;

  const filterText =
    [topFilterText, statusText, point ? `${STAGED_SHEET_FIELDS.find((f) => f.key === point)?.label} written` : '']
      .filter(Boolean)
      .join(' · ') || 'All tasks';

  // Past Tasks milestone picked → "Milestone 1 – +3'-6" slab" under the title (screen, PDF, Excel).
  const milestoneLabel = pastMilestones?.value ? pastMilestones.options.find((o) => o.value === pastMilestones.value)?.label ?? null : null;

  // File name follows the filters, e.g. "ROAST @ Kokapet - Architect - Upcoming Tasks Dependencies - 16 Nov 2026".
  const fileName = reportFileName(
    projectName,
    party,
    statuses.length ? statuses.join(' & ') : 'All',
    [topFilterText, point ? `${STAGED_SHEET_FIELDS.find((f) => f.key === point)?.label} written` : ''].filter(Boolean),
    milestoneLabel
  );

  // Milestone report (2026-11-21, client): cumulative planned / actual span, delay, and who — party only.
  const milestoneSum = useMemo(() => (milestoneLabel ? milestoneSummary(rows, todayKey()) : null), [milestoneLabel, rows]);

  async function run(kind: 'excel' | 'pdf') {
    setBusy(kind);
    setMessage(null);
    try {
      if (milestoneLabel && milestoneSum) {
        // Milestone picked: the milestone report format (2026-11-21, client).
        if (kind === 'excel') {
          const note = await exportMilestoneExcel(milestoneSum, projectName, milestoneLabel, fileName);
          setMessage({ text: note || `Milestone Excel with ${milestoneSum.tasks} tasks downloaded`, error: false });
        } else await printMilestoneReport(milestoneSum, projectName, milestoneLabel, fileName);
      } else if (kind === 'excel') {
        const note = await exportSheetReportExcel(rows, projectName, filterText, party, fileName, milestoneLabel);
        setMessage({ text: note || `Excel report with ${rows.length} tasks downloaded`, error: false });
      } else {
        // Project created date for the PDF header.
        const { data: proj } = selectedProjectId
          ? await supabase.from('projects').select('created_at').eq('id', selectedProjectId).maybeSingle()
          : { data: null };
        await printSheetReport(rows, projectName, filterText, (proj as { created_at?: string } | null)?.created_at ?? null, party, fileName, picked, constructionRows, milestoneLabel);
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
          <Text style={{ fontSize: 18, fontWeight: '700', color: INK }}>
            {reportTitle(party)}
            {party && picked ? ` · ${statusText}` : ''}
          </Text>
          {milestoneLabel ? <Text style={{ fontSize: 15, fontWeight: '700', color: '#B45309' }}>{milestoneLabel}</Text> : null}
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

      {/* Report for one party (2026-11-16): turns the whole page into e.g. an "Architect Report". */}
      {parties.length > 0 ? (
        <View className="rounded-2xl p-3" style={{ backgroundColor: '#FEF5E4', borderWidth: 1, borderColor: '#F5D9A8', gap: 6 }}>
          <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#7A4B00', width: 86 }}>REPORT FOR</Text>
            <Chip label="All" active={party === null} onPress={() => setParty(null)} />
            {parties.map((p) => (
              <Chip key={p} label={p} active={party === p} onPress={() => setParty(party === p ? null : p)} />
            ))}
          </View>
          {party ? (
            // Status inside the party report (2026-11-16): same Status filter as below, with this party's counts.
            <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#7A4B00', width: 86 }}>STATUS</Text>
              {STATUS_OPTIONS.map((s) => {
                const n = s === 'All' ? partyAll.length : partyAll.filter((r) => r.status === s).length;
                return <Chip key={s} label={`${s} ${n}`} active={statusOn(s)} onPress={() => pickStatus(s)} />;
              })}
            </View>
          ) : null}
          {party ? (
            <Text style={{ fontSize: 11, color: '#7A4B00' }}>
              Only tasks waiting on {party}, with only {party}'s reasons. Tap more than one status to put them in one report, e.g. Pending + Upcoming. Tap All for the full Project Status.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Filters, one row above the charts */}
      <View className="rounded-2xl p-3" style={{ backgroundColor: '#fcfcfb', borderWidth: 1, borderColor: BORDER, gap: 8 }}>
        {pastMilestones ? <ChipLine label={pastMilestones.title ?? 'MILESTONE'} options={pastMilestones.options} value={pastMilestones.value} onChange={pastMilestones.onChange} /> : null}
        <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: MUTED, width: 86 }}>STATUS</Text>
          {STATUS_OPTIONS.map((s) => (
            <Chip key={s} label={s} active={statusOn(s)} onPress={() => pickStatus(s)} />
          ))}
        </View>
        <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: MUTED, width: 86 }}>WRITTEN IN</Text>
          <Chip label="Any" active={point === null} onPress={() => setPoint(null)} />
          {(stages ? STAGED_SHEET_FIELDS : SHEET_FIELDS).map((f) => (
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

      {milestoneLabel ? (
        <MilestoneReportCard summary={milestoneSum!} />
      ) : (
      <>
      {/* Headline tiles */}
      {/* Tiles keep their own height (a short tile no longer stretches to the Pending tile's). */}
      <View className="flex-row flex-wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
        {/* Statuses picked (2026-11-16/17): only their boxes, no Total or other boxes. */}
        {picked ? null : <Tile label="Total tasks" value={sum.total} sub="Pending + In progress + Upcoming + Completed" />}
        {REPORT_STATUSES.filter((s) => !picked || picked.includes(s)).map((s) => (
          <Tile key={s} label={s} value={sum.byStatus[s]} sub={`${pct(sum.byStatus[s], sum.total)}% of tasks`} color={STATUS_COLORS[s]} >
            {/* Who the tasks are waiting on — Pending and Upcoming (2026-11-16). Client is passed over for the task's next reason. */}
            {s === 'In progress' ? (
              // In progress (2026-11-16): just the task names, no reasons.
              rows.filter((r) => r.status === s).length ? (
                <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderColor: BORDER, gap: 5 }}>
                  {rows.filter((r) => r.status === s).map((r) => (
                    <Text key={r.taskCode} style={{ fontSize: 12, color: INK }}>
                      <Text style={{ fontWeight: '700' }}>{r.taskCode}</Text> · {r.taskName}
                    </Text>
                  ))}
                </View>
              ) : null
            ) : (
              stages ? (
                <StagedWaitingOn rows={rows.filter((r) => r.status === s)} total={sum.byStatus[s]} />
              ) : (
                <WaitingOnList items={waitingOn(rows.filter((r) => r.status === s), ['Client'])} total={sum.byStatus[s]} />
              )
            )}
          </Tile>
        ))}
      </View>

      {rows.length === 0 ? (
        <Text style={{ fontSize: 13, color: MUTED, padding: 12 }}>No tasks match this report.</Text>
      ) : (
        <>

          {stages && constructionRows ? (
            <>
              <StageHeading label="Pre-construction delays" />
              {/* "No one responsible" = no reason in EITHER stage, said once (under Pre-construction). */}
              <DependenciesBlock rows={rows} party={party} prefix="Pre-construction — " screenWidth={screenWidth} emptyText="No pre-construction delays written yet." hasReason={hasAnyReason} />
              <StageHeading label="Construction delays" />
              <DependenciesBlock rows={constructionRows} party={party} prefix="Construction — " screenWidth={screenWidth} emptyText="No construction delays written yet." hasReason={() => true} />
            </>
          ) : (
            <DependenciesBlock rows={rows} party={party} prefix="" screenWidth={screenWidth} />
          )}

          {/* Status pie + tasks by department, moved to the end of the report (2026-11-16). */}
          {/* Full Project Status only (2026-11-16): hidden for a party report or a single status. */}
          {party || picked ? null : (
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <Card title="Tasks by department" subtitle="Each bar split by status" minWidth={420}>
              <Legend only={picked} />
              {sum.departments.map((d) => (
                <BarRow
                  key={d.name}
                  label={d.name}
                  parts={REPORT_STATUSES.map((s) => ({ color: STATUS_COLORS[s], n: d.byStatus[s] }))}
                  showCounts
                  max={deptMax}
                  value={String(d.total)}
                />
              ))}
            </Card>
          </View>
          )}
        </>
      )}
      </>
      )}
    </ScrollView>
  );
}

// Milestone report on screen (2026-11-21): same content as its PDF / Excel.
function MilestoneReportCard({ summary: s }: { summary: MilestoneSummary }) {
  const d = s.delayDays ?? 0;
  const tone = s.delayDays === null ? MUTED : d > 0 ? '#B91C1C' : '#15803D';
  const max = Math.max(1, ...s.reasons.map((r) => r.tasks), s.noReason);
  const cell = (t: string, bold = false, right = false, color = INK) => (
    <Text style={{ flex: 1, fontSize: 13, fontWeight: bold ? '700' : '400', color, textAlign: right ? 'right' : 'left' }}>{t}</Text>
  );
  const bar = (label: string, n: number, color: string) => (
    <View key={label} className="flex-row items-center" style={{ gap: 10, marginTop: 8 }}>
      <Text style={{ width: 150, fontSize: 13, fontWeight: '600', color: INK }}>{label}</Text>
      <View style={{ flex: 1, height: 18, borderRadius: 4, backgroundColor: TRACK, overflow: 'hidden' }}>
        <View style={{ width: `${(n / max) * 100}%`, height: 18, borderRadius: 4, backgroundColor: color }} />
      </View>
      <Text style={{ width: 32, textAlign: 'right', fontSize: 14, fontWeight: '700', color: INK }}>{n}</Text>
    </View>
  );
  const countRow = (label: string, n: number, color: string) => (
    <View key={label} className="flex-row items-center" style={{ paddingVertical: 7, borderTopWidth: 1, borderColor: BORDER }}>
      <Text style={{ flex: 1, fontSize: 14, color: INK }}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: '800', color }}>{n}</Text>
    </View>
  );
  // Client format (2026-11-22): Planned end → Actual end → Difference; then
  // tasks in milestone, tasks delayed (with reasons), tasks completed on time.
  return (
    <View style={{ gap: 12 }}>
      <Card title="Milestone summary" minWidth={320}>
        <View style={{ borderWidth: 1, borderColor: BORDER, borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
          <View className="flex-row" style={{ paddingHorizontal: 10, paddingVertical: 8, gap: 8, backgroundColor: '#F1F5F9' }}>
            {cell('Planned end', true)}
            {cell('Actual end', true)}
            {cell('Difference', true, true)}
          </View>
          <View className="flex-row" style={{ paddingHorizontal: 10, paddingVertical: 8, gap: 8, borderTopWidth: 1, borderColor: BORDER }}>
            {cell(fmtDay(s.plannedEnd))}
            {cell(s.finished ? fmtDay(s.actualEnd) : 'Not finished yet')}
            {cell(differenceText(s), true, true, tone)}
          </View>
        </View>
        {countRow('No. of tasks in milestone', s.tasks, INK)}
        {countRow('No. of tasks delayed', s.delayedTasks, '#B91C1C')}
        {countRow('No. of tasks completed on time', s.onTime, '#15803D')}
        <Text style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>Difference = actual end − planned end.</Text>
      </Card>
      <Card title={`Reasons for delay (${s.delayedTasks} delayed)`} minWidth={320}>
        {s.reasons.length || s.noReason ? (
          <>
            {s.reasons.map((r) => bar(r.reason, r.tasks, r.color))}
            {s.noReason ? bar('Not written', s.noReason, '#9CA3AF') : null}
          </>
        ) : (
          <Text style={{ fontSize: 13, color: MUTED }}>No delayed tasks.</Text>
        )}
        <Text style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>Delayed tasks per reason; a task with two reasons counts for both.</Text>
        {s.equipment.length ? (
          <View style={{ marginTop: 12 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: INK, marginBottom: 4 }}>Equipment delays</Text>
            {s.equipment.map((e, i) => (
              <View key={`${e.code}-${e.stage}-${i}`} className="flex-row" style={{ gap: 10, paddingVertical: 5, borderTopWidth: 1, borderColor: BORDER }}>
                <Text style={{ width: 80, fontSize: 13, fontWeight: '700', color: INK }}>{e.code}</Text>
                <Text style={{ width: 56, fontSize: 12, color: INK_2 }}>{e.stage}</Text>
                <Text style={{ flex: 1, fontSize: 13, color: INK }}>{e.text}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: (e.delayDays ?? 0) > 0 ? '#B91C1C' : '#15803D' }}>{lineDelay(e.delayDays)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function StageHeading({ label }: { label: string }) {
  return (
    <Text style={{ fontSize: 15, fontWeight: '700', color: '#0F1F33', marginTop: 4 }}>{label}</Text>
  );
}

// "Dependencies for Pending / Completed / Upcoming Tasks" cards for one set of rows.
// Past Tasks shows it twice: Pre-construction, then Construction (2026-11-21).
function DependenciesBlock({
  rows,
  party,
  prefix,
  screenWidth,
  emptyText,
  hasReason = (r: SheetReportRow) => reasonEntries(r).length > 0,
}: {
  rows: SheetReportRow[];
  party: string | null;
  prefix: string;
  screenWidth: number;
  emptyText?: string;
  /** Which tasks count as having someone responsible (Past Works: either stage). */
  hasReason?: (r: SheetReportRow) => boolean;
}) {
  const reasonsFor = (s: ReportStatus) =>
    summarizeReport(rows.filter((r) => r.status === s)).reasons.filter((x) => party === 'Client' || x.who !== 'Client');
  const pendingR = reasonsFor('Pending');
  const completedR = reasonsFor('Completed');
  const upcomingR = reasonsFor('Upcoming');
  if (emptyText && !pendingR.length && !completedR.length && !upcomingR.length) {
    return <Text style={{ fontSize: 13, color: MUTED }}>{emptyText}</Text>;
  }
  return (
    <>
          {/* Dependencies: Pending with Completed under it on the left, Upcoming on the right (2026-11-16).
              Each card sits in its own row so it sizes by width, never by a fixed height. */}
          <View className="flex-row flex-wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
            {/* Empty boxes are hidden (2026-11-16), e.g. Pending/Completed when Status = Upcoming. */}
            {pendingR.length > 0 || completedR.length > 0 ? (
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: Math.min(380, Math.max(240, screenWidth - 32)), gap: 12 }}>
              {pendingR.length > 0 ? (
              <View className="flex-row">
                <ResponsibleCard
                  title={`${prefix}Dependencies for Pending Tasks`}
                  reasons={pendingR}
                  countLabel="pending"
                  countColor={DELAY_COLOR}
                  noReason={rows.filter((r) => r.status === 'Pending' && !hasReason(r)).length}
                />
              </View>
              ) : null}
              {completedR.length > 0 ? (
              <View className="flex-row">
                <ResponsibleCard
                  title={`${prefix}Dependencies for Completed Tasks`}
                  reasons={completedR}
                  countLabel="completed"
                  countColor={MUTED}
                  noReason={rows.filter((r) => r.status === 'Completed' && !hasReason(r)).length}
                />
              </View>
              ) : null}
            </View>
            ) : null}
            {upcomingR.length > 0 ? (
            <ResponsibleCard
              title={`${prefix}Dependencies for Upcoming Tasks`}
              reasons={upcomingR}
              countLabel="upcoming"
              countColor={MUTED}
              noReason={rows.filter((r) => r.status === 'Upcoming' && !hasReason(r)).length}
            />
            ) : null}
          </View>
    </>
  );
}
