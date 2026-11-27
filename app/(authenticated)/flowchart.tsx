import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text } from '../../components/ui/AppText';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import {
  deleteDependency,
  fetchBoardLayout,
  clearBoardPositions,
  fetchFlowchartData,
  fetchFlowchartSet,
  saveBoardPosition,
  setBoardLinkRule,
  FLOWCHART_SET_LABEL,
  flowchartSetForBoard,
  type FlowchartBoard,
  type FlowchartData,
  type FlowchartSetKey,
} from '../../lib/flowchart/data';
import { exportFilteredTasksPdf, printFilteredTasks } from '../../lib/flowchart/filterExport';
import { exportChecklistExcel, exportFlowchartExcel } from '../../lib/flowchart/excelExport';
import { downloadFlowchartA3Pdf } from '../../lib/flowchart/a3Pdf';
import { appendBoardBelow, buildDateOrderBoard, buildPastCopyBoard, PAST_COPY_LEVEL_STACKS, pastTaskCode } from '../../lib/flowchart/dateOrder';
import { applyBoardLayout, EMPTY_BOARD_LAYOUT, isSavedLinkId, linkKey, type BoardLayout } from '../../lib/flowchart/boardLayout';
import type { FlowchartSeriesEdge, FlowchartTask } from '../../lib/flowchart/types';
import { fetchMilestones, type Milestone } from '../../lib/flowchart/milestones';
import { CANVAS_THEMES, type CanvasTheme } from '../../components/flowchart/GridBackground';
import { matchesPlannedDateFilter, PLANNED_DATE_MODE_LABEL, type PlannedDateMode } from '../../lib/flowchart/plannedDateFilter';
import { formatDateLabel } from '../../lib/reports/dateRange';
import { FlowchartCanvas, type CanvasViewMemory } from '../../components/flowchart/FlowchartCanvas';
import { FlowchartFilterModal } from '../../components/flowchart/FlowchartFilterModal';
import { FilteredTaskList } from '../../components/flowchart/FilteredTaskList';
import { ChecklistSheetView } from '../../components/flowchart/ChecklistSheetView';
import { SheetReportView } from '../../components/flowchart/SheetReportView';
import { PAST_MILESTONES, pastMilestoneLabel } from '../../lib/flowchart/pastMilestones';
import { GanttView } from '../../components/flowchart/GanttView';
import { matchesStatusFilter, type StatusFilter } from '../../lib/flowchart/sheetStatus';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormModal } from '../../components/ui/FormModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { withTimeout } from '../../lib/withTimeout';

const FETCH_TIMEOUT_MS = 12_000;

// Board tab names (renamed 2026-11-18, client request). Also used in the
// Checklist Excel file name. Internal keys (fc2/fc3/…) are unchanged.
const BOARD_LABEL: Record<FlowchartBoard, string> = {
  fc2: 'Current Status',
  fc3: '56 Tasks',
  fc2test: 'Copy',
  past: 'Past Tasks',
  pastcopy: 'Completed Tasks', // renamed from "Past Tasks Copy" (2026-11-23, client)
  pastcopystatus: 'Completed Tasks',
  test: 'Test',
  main: 'Main Flowchart',
};
// Past Tasks and its copy (2026-11-21) work the same: Date Order, the Current
// Status copy below, staged delays, milestone reports. Only the columns differ.
const isPastBoard = (b: FlowchartBoard) => b === 'past' || b === 'pastcopy';
const SHOW_SETS_KEY = 'flowchart:showOldVersions';
// Past Tasks Copy level reports. LL, L and ML are one report (2026-11-22,
// client); UL, Mezz and No level stay on their own.
const COMBINED_LEVELS = 3;
function pastCopyReportGroups() {
  const levels = PAST_COPY_LEVEL_STACKS;
  const short = (label: string) => label.split(/\s+/)[0];
  const combined = levels.slice(0, COMBINED_LEVELS);
  return [
    // 2026-11-26, client: "Delays should be around 50 days, it's showing 100+ — cross
    // check the working days." Only the PTC tasks (the Current Status tasks moved into
    // ML — CIV-09/03/13/22 — are left out of this report), in working days, each late
    // day counted once; every task listed with its own delay.
    {
      name: combined.map((s) => short(s.label)).join(' + '),
      label: `Level ${combined.map((s) => short(s.label)).join(' + ')} (−7'6" to −2'0")`,
      taskCodes: combined.flatMap((s) => s.taskCodes).filter((c) => c.startsWith('PT-')),
      format: 'allDelays' as const,
      endCode: 'level',
      workingDays: true,
      scope: 'this level',
    },
    // Mezzanine Slab Casting milestone (2026-11-23, client): the LL and L columns,
    // PCC works (PT-23), and Mezzanine Slab Casting (PT-24) as the last task —
    // its end is the milestone's end. Every delay entered in the pop-ups, task by
    // task, including the days from the task above.
    ...(() => {
      const ll = levels.find((s) => s.label.includes(`−7'6"`));
      const l = levels.find((s) => s.label.includes(`−4'6"`));
      return ll && l
        ? [
            {
              name: 'milestone-mezz-slab',
              label: 'Milestone – Mezzanine Slab Casting (LL + L)',
              taskCodes: [...ll.taskCodes, ...l.taskCodes, 'PT-23', 'PT-24'],
              format: 'taskDelays' as const,
              // Its delay is followed back from this last task (milestoneChain.ts).
              lastCode: 'PT-24',
            },
          ]
        : [];
    })(),
    // Line report (2026-11-25, client): Mezzanine Slab Casting down the links to the
    // Mezzanine toilet slab — PTC-24 → PTC-30 → CIV-07 → CIV-08 → CIV-12 → CIV-17.
    // Same layout as the 28 Jul – 24 Sep date-range report, ending at CIV-17.
    {
      name: 'line-mezz-slab-to-toilet-slab',
      label: 'Line – Mezzanine Slab Casting to Mezzanine Toilet Slab (PTC-24 → CIV-17)',
      taskCodes: ['PT-24', 'PT-30', 'CIV-07', 'CIV-08', 'CIV-12', 'CIV-17'],
      format: 'allDelays' as const,
      endCode: 'CIV-17',
    },
    // Line report (2026-11-25, client): the 9 tasks from 3" Starter casting down to
    // Roof beam with curing — every task listed, with a Cumulative row.
    {
      name: 'line-starter-to-roof-beam',
      label: 'Line – 3" Starter Casting to Roof Beam with Curing (PTC-30 → CIV-34, 9 tasks)',
      taskCodes: ['PT-30', 'CIV-01', 'CIV-07', 'CIV-08', 'CIV-12', 'CIV-17', 'CIV-29', 'CIV-06', 'CIV-34'],
      format: 'allDelays' as const,
      endCode: 'CIV-34',
      // Working days (2026-11-26, client: "around 50 days"): the total is the delay of
      // the line's last finished task (PC-CIV-06); all 9 tasks are still listed.
      workingDays: true,
      totalFromLastFinished: true,
      // Construction delay = the whole actual period (Roof beam 9–26 Nov = 18 days, client).
      conWhole: true,
    },
    // L (−4'6") on its own (2026-11-23, client): only that column's tasks —
    // the column with the delay table.
    ...levels
      .filter((s) => s.label.includes(`−4'6"`))
      .map((s) => ({ name: `only:${s.label}`, label: `Level ${s.label.replace(/\s+/g, ' ')} only`, taskCodes: s.taskCodes, format: 'allDelays' as const })),
    ...levels.slice(COMBINED_LEVELS).map((s) => ({ name: s.label, label: `Level ${s.label.replace(/\s+/g, ' ')}`, taskCodes: s.taskCodes })),
  ];
}
// Past Tasks Copy A4 print: down to this card (2026-11-22, client).
const A4_PRINT_LAST_CODE = 'CIV-34';

type FlowchartViewMode = 'flowchart' | 'list';

// Which project this shows is no longer this screen's own concern — it
// reads the single shared selection from ProjectContext (set on App Home /
// Project Dashboard) instead of fetching its own project list and showing
// its own picker chips, same re-plumbing as Gantt.
// Flowchart-only error boundary: a render error anywhere in the canvas shows
// a message with "Try Again" instead of the app-wide fallback, and is tagged
// 'flowchart_render_error' in Sentry.
export default function FlowchartScreen() {
  return (
    <ErrorBoundary
      area="flowchart_render_error"
      title="Flowchart couldn't load"
      message="Something went wrong while drawing this project's flowchart. Tap Try Again, or go back and open it again."
    >
      <FlowchartScreenContent />
    </ErrorBoundary>
  );
}

function FlowchartScreenContent() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isStaff = profile ? appRoleFor(profile.role) === 'staff' : false;
  const { selectedProjectId, projects } = useProject();
  const projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? 'Project';

  const [data, setData] = useState<FlowchartData | null>(null);
  // Past Tasks: the Current Status board, drawn (copied, view-only) below the stacks.
  const [currentStatusCopy, setCurrentStatusCopy] = useState<FlowchartData | null>(null);
  // Past Tasks / Past Tasks Copy: cards moved and links made or removed on
  // that board (lib/flowchart/boardLayout.ts, 2026-11-22).
  const [boardLayout, setBoardLayout] = useState<BoardLayout>(EMPTY_BOARD_LAYOUT);
  // Excel download (Task ID / dates / Delayed By / empty Delay Reason).
  const [excelExporting, setExcelExporting] = useState(false);
  const [excelNote, setExcelNote] = useState<{ text: string; isError: boolean } | null>(null);
  // "⋯" more menu (Excel lives there now).
  const [moreOpen, setMoreOpen] = useState(false);
  // 👁 shows the old flowchart versions (56 / 15 / 311-task sets). Hidden by
  // default; the choice is remembered on this device.
  const [showSets, setShowSets] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(SHOW_SETS_KEY)
      .then((v) => setShowSets(v === '1'))
      .catch(() => {});
  }, []);
  function toggleShowSets() {
    setShowSets((prev) => {
      const next = !prev;
      AsyncStorage.setItem(SHOW_SETS_KEY, next ? '1' : '0').catch(() => {});
      // Hiding the versions also leaves an old version you were viewing.
      if (!next) setTaskSet(null);
      return next;
    });
  }
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hidden-sets toggle (top-right corner). null = the normal, editable
  // flowchart (real tasks). A set key shows that archived flowchart-only set
  // (tasks.flowchart_set — soft-deleted, so nothing else in the app shows
  // them) view-only, never linked to DPR/checklists.
  const [taskSet, setTaskSet] = useState<FlowchartSetKey | null>(null);
  // Which live board: the original flowchart or Flowchart 2.
  const [board, setBoard] = useState<FlowchartBoard>('fc2');
  // Phones (2026-11-16): the button rows scroll sideways and use short labels instead of overflowing.
  const narrow = useWindowDimensions().width < 500;
  const [archive, setArchive] = useState<{ data: FlowchartData | null; loading: boolean; error: string | null }>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (taskSet === null || !selectedProjectId) return;
    let cancelled = false;
    setArchive({ data: null, loading: true, error: null });
    withTimeout(fetchFlowchartSet(selectedProjectId, taskSet), FETCH_TIMEOUT_MS, "Couldn't reach the server — check your connection and try again.")
      .then((d) => { if (!cancelled) setArchive({ data: d, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setArchive({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) }); });
    return () => { cancelled = true; };
  }, [taskSet, selectedProjectId]);

  // Filter panel — Floor/Department/Room/Milestone, each independently
  // combinable; null means "All" for that dimension. Operates on whatever
  // fetchFlowchartData already returned, so it's automatically scoped to
  // the same hidden_from_flowchart/pilot-visible set the unfiltered canvas
  // shows. Planned Date is a 5th dimension but shaped differently — a mode
  // (Start/Complete/Happening) PLUS a range, so it only counts as active
  // once all three are set (see plannedDateFilterActive below).
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  // Live task count of the empty-project canvas; hides the first-task hint.
  const [emptyCanvasCount, setEmptyCanvasCount] = useState(0);
  const [floorFilter, setFloorFilter] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const [roomFilter, setRoomFilter] = useState<string | null>(null);
  const [milestoneFilter, setMilestoneFilter] = useState<string | null>(null);
  // Past Tasks Reports: the 4 client milestones (lib/flowchart/pastMilestones.ts).
  const [pastMilestone, setPastMilestone] = useState<string | null>(null);
  // Status filter: Completed / Upcoming / Delayed (same rules as Reports).
  // (no Actual Start). Hides the other tasks without moving anything.
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  // Flowchart 2 extra views: "Sheet View" (the 7 checklist points as an
  // autosaving table) and "Reports" (that sheet as a downloadable report).
  // 'dates' = Past Tasks "Date Order" (actual-date order; undated tasks below).
  const [boardView, setBoardView] = useState<'chart' | 'sheet' | 'reports' | 'gantt' | 'dates'>('chart');
  const [dateMode, setDateMode] = useState<PlannedDateMode | null>(null);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<FlowchartViewMode>('flowchart');
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  // Lifted out of FlowchartCanvas (was local state there) so this screen's
  // own chrome above the canvas — header/filter row/completion-warning bar
  // background — can follow the same choice instead of only the canvas
  // grid changing. Session-only, matching the canvas's own prior behavior
  // (never persisted).
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>('light');

  const load = useCallback(async (projectId: string) => {
    try {
      setError(null);
      const [flowchartData, milestoneList, statusCopy, layout] = await Promise.all([
        withTimeout(fetchFlowchartData(projectId, board), FETCH_TIMEOUT_MS, "Couldn't reach the server — check your connection and try again."),
        fetchMilestones(projectId).catch(() => []), // filter option list only — a courtesy, not load-bearing, same as FlowchartCanvas's own fetchMilestones call
        // Past Tasks: the live Current Status board. Past Tasks Copy: its own copy
        // of it (2026-11-22). The stacks still show if this fails.
        board === 'pastcopy'
          ? fetchFlowchartData(projectId, 'pastcopystatus').catch(() => null)
          : board === 'past'
            ? fetchFlowchartData(projectId, 'fc2').catch(() => null)
            : Promise.resolve(null),
        isPastBoard(board) ? fetchBoardLayout(board).catch(() => EMPTY_BOARD_LAYOUT) : Promise.resolve(EMPTY_BOARD_LAYOUT),
      ]);
      setData(flowchartData);
      setCurrentStatusCopy(statusCopy);
      setBoardLayout(layout);
      setMilestones(milestoneList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [board]);

  useEffect(() => {
    if (!selectedProjectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    load(selectedProjectId).finally(() => setLoading(false));
  }, [selectedProjectId, load]);

  function retry() {
    if (selectedProjectId) load(selectedProjectId);
  }

  // Small ⟳ button (2026-11-14): re-fetches the board (or the old version
  // being viewed) without leaving the tab. FlowchartCanvas reads its tasks
  // once at mount, so bumping refreshKey (part of every canvas key) redraws
  // it with the new data.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Where the user is looking on the board; refresh puts them back there.
  const viewMemory = useRef<CanvasViewMemory>({ pending: false, view: null });
  async function refresh() {
    if (!selectedProjectId || refreshing) return;
    setRefreshing(true);
    try {
      if (taskSet !== null) {
        const d = await withTimeout(fetchFlowchartSet(selectedProjectId, taskSet), FETCH_TIMEOUT_MS, "Couldn't reach the server — check your connection and try again.");
        setArchive({ data: d, loading: false, error: null });
      } else {
        await load(selectedProjectId);
      }
      viewMemory.current.pending = true;
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setArchive((a) => ({ ...a, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setRefreshing(false);
    }
  }

  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  if (!selectedProjectId) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <EmptyState
          icon="briefcase-outline"
          iconColor="#9CA3AF"
          title={isStaff ? 'No project selected' : 'No project assigned'}
          subtitle={
            isStaff
              ? 'Pick a project from Home to see its flowchart.'
              : "Your account isn't linked to a project yet. Contact your PMC office to get this set up."
          }
        />
        {isStaff && (
          <Pressable onPress={() => router.push('/home')} className="mt-4 px-4 py-2 rounded-lg bg-brand-navy">
            <Text className="text-xs font-semibold text-white">Go to Home</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // A milestone made / removed on the board (milestone line, 2026-11-23): the
  // Filter and Reports see it straight away, without a reload.
  function handleMilestonesChange(list: Milestone[], taskIds: string[], milestoneId: string | null) {
    setMilestones(list);
    const ids = new Set(taskIds);
    const tag = <D extends { tasks: FlowchartTask[] } | null>(d: D): D =>
      d ? ({ ...d, tasks: d.tasks.map((t) => (ids.has(t.id) ? { ...t, milestoneId } : t)) } as D) : d;
    setData((prev) => tag(prev));
    setCurrentStatusCopy((prev) => tag(prev));
    if (milestoneId === null && milestoneFilter && !list.some((m) => m.id === milestoneFilter)) setMilestoneFilter(null);
  }

  // Filter derivations — all null when nothing's been picked yet, which
  // makes filteredTasks equal data.tasks exactly (no behavior change for a
  // project where the filter's never been opened).
  const allDepartments = Array.from(new Set((data?.tasks ?? []).map((t) => t.workName)));
  const plannedDateFilterActive = dateMode !== null && dateFrom !== null && dateTo !== null && dateFrom <= dateTo;
  const hasActiveFilter = statusFilter !== null || floorFilter !== null || deptFilter !== null || roomFilter !== null || milestoneFilter !== null || plannedDateFilterActive;
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const matchesFilters = (t: NonNullable<typeof data>['tasks'][number]) =>
    (floorFilter === null || t.floorLevel === floorFilter) &&
    (deptFilter === null || t.workName === deptFilter) &&
    (roomFilter === null || t.roomType === roomFilter) &&
    (milestoneFilter === null || t.milestoneId === milestoneFilter) &&
    (!plannedDateFilterActive || matchesPlannedDateFilter(t, dateMode!, dateFrom!, dateTo!)) &&
    (statusFilter === null || matchesStatusFilter(t, statusFilter as StatusFilter, todayKey));
  const filteredTasks = (data?.tasks ?? []).filter(matchesFilters);
  const filteredTaskIds = new Set(filteredTasks.map((t) => t.id));
  const filterOn = hasActiveFilter;
  // Filter on (2026-11-15, client): the matching tasks are shown in ONE
  // column, in date order (planned start, else planned end, else actual
  // start; undated last). Display only: positions are never saved, and the
  // board is read-only while a filter is on.
  const dateKey = (t: (typeof filteredTasks)[number]) => t.plannedStartDate ?? t.dueDate ?? t.actualStartDate ?? null;
  const columnTasks = [...filteredTasks]
    .sort((a, b) => {
      const ka = dateKey(a);
      const kb = dateKey(b);
      if (ka !== kb) return ka === null ? 1 : kb === null ? -1 : ka.localeCompare(kb);
      return a.taskId.localeCompare(b.taskId, undefined, { numeric: true });
    })
    .map((t, i) => ({ ...t, manualPositionX: 0, manualPositionY: i * 148, sectionTitle: null, dividerBelow: false }));
  // Sheet View / Reports: "Stack - Task name" (stack = the column's black heading).
  // Stack-name prefix removed (2026-11-16, client): plain task names in Sheet View / Reports.
  const sheetTasks = columnTasks;
  // Past Works Reports (2026-11-21, client): everything on the Past Works
  // board is counted — the Past Tasks AND the Current Status tasks copied
  // below them (same filters, same date order). The copied tasks report their
  // Past Works delays (own Pre-construction + Construction), not Current Status's.
  const pastIds = new Set((data?.tasks ?? []).map((t) => t.id));
  const copiedReportTasks =
    isPastBoard(board) ? [...(currentStatusCopy?.tasks ?? [])].filter((t) => !pastIds.has(t.id) && matchesFilters(t)).sort((a, b) => {
      const ka = dateKey(a);
      const kb = dateKey(b);
      if (ka !== kb) return ka === null ? 1 : kb === null ? -1 : ka.localeCompare(kb);
      return a.taskId.localeCompare(b.taskId, undefined, { numeric: true });
    }) : [];
  // Past Tasks Reports: one of the 4 milestones picked → only its tasks (2026-11-21).
  // Past Tasks Copy (2026-11-21, client): a report per LEVEL column instead (same format).
  // Milestones drawn on this board (Past Tasks Copy milestone lines, 2026-11-23):
  // the Filter and the Reports list only these, not other boards' milestones.
  // Past Tasks Copy's copy below is its own; on Past Tasks the cards below are the live Current Status tasks.
  const boardTaskList = [...(data?.tasks ?? []), ...(board === 'pastcopy' ? currentStatusCopy?.tasks ?? [] : [])];
  const boardMilestones = isPastBoard(board) ? milestones.filter((m) => boardTaskList.some((t) => t.milestoneId === m.id)) : milestones;
  // Past Tasks and Past Tasks Copy (2026-11-23, client): every level / milestone
  // report in the "All delays" layout, and each drawn milestone line is a report too.
  const reportGroups: {
    name: string;
    label: string;
    taskCodes: string[];
    taskIds?: Set<string>;
    format?: 'allDelays' | 'taskDelays';
    lastCode?: string;
    endCode?: string;
    workingDays?: boolean;
    scope?: string;
    totalFromLastFinished?: boolean;
    conWhole?: boolean;
  }[] = [
    ...(board === 'pastcopy'
      ? pastCopyReportGroups()
      : PAST_MILESTONES.map((m) => ({ name: m.name, label: pastMilestoneLabel(m.name), taskCodes: m.taskCodes }))),
    ...boardMilestones.map((m) => ({
      name: `milestone:${m.id}`,
      label: `Milestone – ${m.name}`,
      taskCodes: [] as string[],
      taskIds: new Set(boardTaskList.filter((t) => t.milestoneId === m.id).map((t) => t.id)),
    })),
  ].map((g) => ({ ...g, format: ('format' in g && g.format === 'taskDelays' ? 'taskDelays' : 'allDelays') as 'allDelays' | 'taskDelays' }));
  const pickedGroup = isPastBoard(board) && pastMilestone ? reportGroups.find((m) => m.name === pastMilestone) ?? null : null;
  const pastMilestoneCodes = pickedGroup ? new Set(pickedGroup.taskCodes) : null;
  const reportTasksAll = (isPastBoard(board) ? [...sheetTasks, ...copiedReportTasks] : sheetTasks).filter(
    (t) => !pickedGroup || (pickedGroup.taskIds ? pickedGroup.taskIds.has(t.id) : pastMilestoneCodes!.has(pastTaskCode(t.taskId)))
  );
  // A level / milestone by task code (2026-11-23, client: "16 tasks should be there"):
  // each code once, even if the same card comes up twice; and the codes not
  // found at all are named on the report instead of silently left out.
  const reportTasks =
    pickedGroup && !pickedGroup.taskIds
      ? reportTasksAll.filter((t, i, all) => all.findIndex((x) => pastTaskCode(x.taskId) === pastTaskCode(t.taskId)) === i)
      : reportTasksAll;
  const missingReportCodes =
    pickedGroup && !pickedGroup.taskIds
      ? pickedGroup.taskCodes.filter((c) => !reportTasks.some((t) => pastTaskCode(t.taskId) === c)).map((c) => c.replace(/^PT-/, 'PTC-'))
      : [];
  const reportDepartments = isPastBoard(board)
    ? Array.from(new Set([...allDepartments, ...(currentStatusCopy?.tasks ?? []).map((t) => t.workName)]))
    : allDepartments;
  // Canvases remount on every filter change — FlowchartCanvas seeds its own
  // position/zoom state from initialTasks ONCE at mount (useMemo/useState
  // with an empty dep array), so swapping the prop alone would silently keep
  // showing the old task set.
  const canvasFilterKey = hasActiveFilter
    ? `filtered-${statusFilter}-${floorFilter}-${deptFilter}-${roomFilter}-${milestoneFilter}-${dateMode}-${dateFrom}-${dateTo}`
    : 'unfiltered';
  // Past Tasks "Date Order": actual-date order, "No actual dates" group below. Display only.
  // Below them, a view-only copy of the Current Status board (not linked, nothing moved).
  const builtDateOrder = isPastBoard(board) && boardView === 'dates' ? board === 'pastcopy'
      ? buildPastCopyBoard(
          filteredTasks,
          // A milestone filter covers the copied cards below too (2026-11-23).
          milestoneFilter && currentStatusCopy
            ? { ...currentStatusCopy, tasks: currentStatusCopy.tasks.filter((t) => t.milestoneId === milestoneFilter) }
            : currentStatusCopy,
          data?.seriesEdges ?? []
        )
      : appendBoardBelow(buildDateOrderBoard(filteredTasks), currentStatusCopy) : null;
  // Cards dragged and links made / removed on this board (2026-11-22) win
  // over the worked-out layout.
  const savedBoardLinks = [...(data?.seriesEdges ?? []), ...(currentStatusCopy?.seriesEdges ?? [])];
  const dateOrder = builtDateOrder ? applyBoardLayout(builtDateOrder, boardLayout, savedBoardLinks) : null;
  // Milestone with a last task (2026-11-23, client): the report follows its delay back
  // through the links on the board — the same board as Date Order, same links.
  const chainBoard =
    isPastBoard(board) && boardView === 'reports' && pickedGroup && 'lastCode' in pickedGroup && pickedGroup.lastCode
      ? applyBoardLayout(
          board === 'pastcopy'
            ? buildPastCopyBoard(filteredTasks, currentStatusCopy, data?.seriesEdges ?? [])
            : appendBoardBelow(buildDateOrderBoard(filteredTasks), currentStatusCopy),
          boardLayout,
          savedBoardLinks
        )
      : null;
  const reportChain = chainBoard
    ? new Map(
        chainBoard.tasks.map((t) => [
          t.taskId,
          {
            // Same dates as the card's red "Pre-con · Const · Total" line.
            dates: {
              plannedStart: t.currentPlannedStartDate ?? t.plannedStartDate,
              plannedEnd: t.currentDueDate ?? t.dueDate,
              actualStart: t.actualStartDate,
              actualEnd: t.actualEndDate,
            },
            above: chainBoard.edges.flatMap((e) => {
              if (e.taskId !== t.id) return [];
              const p = chainBoard.tasks.find((x) => x.id === e.dependsOnTaskId);
              return p ? [{ code: p.taskId, type: e.type, actualStart: p.actualStartDate, actualEnd: p.actualEndDate }] : [];
            }),
          },
        ])
      )
    : undefined;
  // Past Tasks Copy's tasks are all its own copies, so a removed saved link is
  // deleted. On Past Tasks the cards below are the live Current Status tasks:
  // a link touching them is only hidden on Past Tasks.
  const ownBoardTaskIds = new Set([
    ...(data?.tasks ?? []).map((t) => t.id),
    ...(board === 'pastcopy' ? (currentStatusCopy?.tasks ?? []).map((t) => t.id) : []),
  ]);
  const setLinkRuleLocal = (key: string, rule: 'show' | 'hide' | null) =>
    setBoardLayout((prev) => {
      const links = new Map(prev.links);
      if (rule) links.set(key, rule);
      else links.delete(key);
      return { ...prev, links };
    });
  const dateBoardLayout = {
    savePosition: async (taskId: string, x: number, y: number) => {
      await saveBoardPosition(board, taskId, x, y);
      setBoardLayout((prev) => ({ ...prev, positions: new Map(prev.positions).set(taskId, { x, y }) }));
    },
    removeLink: async (edge: FlowchartSeriesEdge) => {
      const key = linkKey(edge.dependsOnTaskId, edge.taskId);
      if (isSavedLinkId(edge.id) && ownBoardTaskIds.has(edge.taskId) && ownBoardTaskIds.has(edge.dependsOnTaskId)) {
        await deleteDependency(edge.id);
        if (boardLayout.links.has(key)) await setBoardLinkRule(board, edge.dependsOnTaskId, edge.taskId, null);
        setLinkRuleLocal(key, null);
      } else {
        await setBoardLinkRule(board, edge.dependsOnTaskId, edge.taskId, 'hide');
        setLinkRuleLocal(key, 'hide');
      }
    },
    linkCreated: async (edge: FlowchartSeriesEdge) => {
      await setBoardLinkRule(board, edge.dependsOnTaskId, edge.taskId, 'show');
      setLinkRuleLocal(linkKey(edge.dependsOnTaskId, edge.taskId), 'show');
    },
  };
  const filteredSeriesEdges = (data?.seriesEdges ?? []).filter((e) => filteredTaskIds.has(e.taskId) && filteredTaskIds.has(e.dependsOnTaskId));
  const filteredParallelEdges = (data?.parallelEdges ?? []).filter((e) => filteredTaskIds.has(e.taskAId) && filteredTaskIds.has(e.taskBId));
  const filterSummary = {
    floor: floorFilter,
    department: deptFilter,
    room: roomFilter,
    milestone: milestoneFilter ? (milestones.find((m) => m.id === milestoneFilter)?.name ?? null) : null,
    plannedDate: plannedDateFilterActive
      ? `${PLANNED_DATE_MODE_LABEL[dateMode!]}: ${formatDateLabel(dateFrom)} – ${formatDateLabel(dateTo)}`
      : null,
  };

  async function handleDownloadPdf() {
    setExporting(true);
    try {
      const savedTo = await exportFilteredTasksPdf(filteredTasks, filterSummary);
      if (savedTo) Alert.alert('Saved', `Saved to ${savedTo}`);
    } catch (err) {
      Alert.alert('Could not export PDF', err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  // Every task the flowchart is currently showing (the filtered set when a
  // filter is on). Feedback is shown inline — Alert does nothing on web.
  async function handleDownloadExcel() {
    setExcelExporting(true);
    setExcelNote(null);
    try {
      const note = await exportFlowchartExcel(filteredTasks, projectName);
      setExcelNote({ text: note || `Excel file with ${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'} downloaded`, isError: false });
    } catch (err) {
      setExcelNote({ text: `Could not create the Excel file: ${err instanceof Error ? err.message : String(err)}`, isError: true });
    } finally {
      setExcelExporting(false);
    }
  }

  // Flowchart 2 "Checklist Excel": task, department, planned/actual start and
  // five empty pre-checklist columns for the client's comments.
  async function handleDownloadChecklistExcel() {
    setExcelExporting(true);
    setExcelNote(null);
    try {
      const note = await exportChecklistExcel(filteredTasks, projectName, BOARD_LABEL[board]);
      setExcelNote({ text: note || `Checklist Excel with ${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'} downloaded`, isError: false });
    } catch (err) {
      setExcelNote({ text: `Could not create the checklist Excel: ${err instanceof Error ? err.message : String(err)}`, isError: true });
    } finally {
      setExcelExporting(false);
    }
  }

  // Flowchart 2 "Download A3 PDF": the board as cards + arrows on A3 portrait
  // pages (lib/flowchart/a3Pdf.ts). Uses whatever is shown (filter applies).
  async function handleDownloadA3Pdf() {
    setExcelExporting(true);
    setExcelNote(null);
    try {
      // Past Tasks Date Order: print that chart exactly as shown on screen.
      const note = dateOrder
        ? await downloadFlowchartA3Pdf(dateOrder.tasks, dateOrder.edges, `${projectName} — ${BOARD_LABEL[board]} — Date Order`, { fillWidth: true, splitAtRowGap: true, noEstimated: board === 'pastcopy' })
        : await downloadFlowchartA3Pdf(filteredTasks, filteredSeriesEdges, `${projectName} — ${BOARD_LABEL[board]}`);
      setExcelNote({ text: note || 'A3 PDF created', isError: false });
    } catch (err) {
      setExcelNote({ text: `Could not create the A3 PDF: ${err instanceof Error ? err.message : String(err)}`, isError: true });
    } finally {
      setExcelExporting(false);
    }
  }

  // Past Tasks Copy (2026-11-22, client): the board from the top row down to
  // PC-CIV-34 only, on 3 A4 portrait pages (all columns on every page).
  async function handleDownloadA4Pdf() {
    if (!dateOrder) return;
    const last = dateOrder.tasks.find((t) => pastTaskCode(t.taskId) === A4_PRINT_LAST_CODE);
    const lastY = last?.manualPositionY ?? Infinity;
    const tasks = dateOrder.tasks.filter((t) => (t.manualPositionY ?? Infinity) <= lastY);
    const ids = new Set(tasks.map((t) => t.id));
    const edges = dateOrder.edges.filter((e) => ids.has(e.taskId) && ids.has(e.dependsOnTaskId));
    setExcelExporting(true);
    setExcelNote(null);
    try {
      const note = await downloadFlowchartA3Pdf(tasks, edges, `${projectName} — ${BOARD_LABEL[board]}`, { fillWidth: true, rowPages: 3, paper: 'A4', noEstimated: true });
      setExcelNote({ text: note || 'A4 PDF created', isError: false });
    } catch (err) {
      setExcelNote({ text: `Could not create the A4 PDF: ${err instanceof Error ? err.message : String(err)}`, isError: true });
    } finally {
      setExcelExporting(false);
    }
  }

  async function handlePrint() {
    setPrinting(true);
    try {
      await printFilteredTasks(filteredTasks, filterSummary);
    } catch (err) {
      Alert.alert('Could not print', err instanceof Error ? err.message : String(err));
    } finally {
      setPrinting(false);
    }
  }

  function handleClearFilters() {
    setFloorFilter(null);
    setDeptFilter(null);
    setRoomFilter(null);
    setMilestoneFilter(null);
    setStatusFilter(null);
    setDateMode(null);
    setDateFrom(null);
    setDateTo(null);
    setViewMode('flowchart');
  }

  const isDark = canvasTheme === 'black';

  return (
    <View className="flex-1" style={{ backgroundColor: CANVAS_THEMES[canvasTheme].bg }}>
      {error && (
        <View className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
          <Pressable onPress={retry} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      )}

      {/* Boards: the original flowchart and Flowchart 2 (site sheet 3 Nov 2026). */}
      <View className="flex-row px-3 pt-2" style={{ backgroundColor: CANVAS_THEMES[canvasTheme].bg }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ paddingRight: 8 }}>
        <View className="flex-row rounded-xl p-1" style={{ backgroundColor: isDark ? '#1F1F1F' : '#F1F3F6' }}>
          {/* L (−4'6") and Main Flowchart tabs removed (2026-11-23, client). */}
          {(['fc2', 'fc3', 'fc2test', 'past', 'pastcopy', 'test'] as FlowchartBoard[]).map((b) => {
            const active = board === b;
            return (
              <Pressable
                key={b}
                testID={`flowchart-board-${b}`}
                onPress={() => {
                  if (board === b) return;
                  setTaskSet(null);
                  // Milestones (Past Tasks) and levels (Past Tasks Copy) differ: start with none picked.
                  setPastMilestone(null);
                  // Flowchart 3 has Sheet View only (no Project Status / Gantt).
                  if (b === 'fc3' && boardView !== 'sheet') setBoardView('chart');
                  // Past Tasks opens on Date Order (2026-11-20, client); it exists only there.
                  if (isPastBoard(b)) setBoardView('dates');
                  else if (boardView === 'dates') setBoardView('chart');
                  setBoard(b);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                className="items-center justify-center rounded-lg"
                style={{ minHeight: 36, paddingHorizontal: narrow ? 10 : 16, backgroundColor: active ? (isDark ? '#141414' : '#fff') : 'transparent' }}
              >
                <Text className="text-xs font-bold" style={{ color: active ? (isDark ? '#F5F5F5' : '#0F1F33') : '#9CA3AF' }}>
                  {BOARD_LABEL[b]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        </ScrollView>
        <View className="flex-1" />
        <Pressable
          testID="flowchart-refresh"
          onPress={refresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel="Refresh flowchart"
          hitSlop={8}
          className="items-center justify-center rounded-lg border self-center"
          style={{ width: 32, height: 32, backgroundColor: isDark ? '#141414' : '#fff', borderColor: isDark ? '#242424' : '#E5E5E5' }}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={isDark ? '#E5E5E5' : '#0F1F33'} />
          ) : (
            <Ionicons name="refresh" size={16} color={isDark ? '#E5E5E5' : '#374151'} />
          )}
        </Pressable>
      </View>

      {/* Top row (2026-11-13): Filter · ⋯ more (Excel) · 👁 old flowchart versions. */}
      {<View
        className="flex-row items-center gap-2 px-3 pt-2 pb-1.5"
        style={{ backgroundColor: CANVAS_THEMES[canvasTheme].bg }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
        {taskSet === null && data && data.tasks.length > 0 ? (
          <Pressable
            testID="flowchart-filter"
            onPress={() => setFilterModalOpen(true)}
            className="flex-row items-center gap-1.5 px-3 rounded-xl border"
            style={{
              minHeight: 40,
              backgroundColor: filterOn ? '#0F1F33' : isDark ? '#141414' : '#fff',
              borderColor: filterOn ? '#0F1F33' : isDark ? '#242424' : '#E5E5E5',
            }}
          >
            <Ionicons name="filter-outline" size={15} color={filterOn ? '#fff' : isDark ? '#E5E5E5' : '#374151'} />
            <Text className="text-xs font-bold" style={{ color: filterOn ? '#fff' : isDark ? '#E5E5E5' : '#374151' }}>
              Filter{filterOn ? ` (${filteredTasks.length})` : ''}
            </Text>
          </Pressable>
        ) : null}
        {taskSet === null && board !== 'main' && data && data.tasks.length > 0
          ? ([
              // Past Tasks only: tasks in actual-date order.
              ['dates', 'Date Order', 'swap-horizontal-outline'],
              ['sheet', 'Sheet View', 'grid-outline'],
              ['reports', 'Project Status', 'document-text-outline'],
              // Gantt View (2026-11-17, client): same tasks + links as a day-by-day Gantt chart.
              ['gantt', 'Gantt View', 'calendar-outline'],
            ] as const)
              .filter(([view]) => board !== 'fc3' || view === 'sheet')
              .filter(([view]) => view !== 'dates' || isPastBoard(board))
              .map(([view, label, icon]) => {
              const on = boardView === view;
              return (
                <Pressable
                  key={view}
                  testID={`flowchart-${view}-view`}
                  onPress={() => setBoardView(on ? 'chart' : view)}
                  className="flex-row items-center gap-1.5 px-3 rounded-xl border"
                  style={{
                    minHeight: 40,
                    backgroundColor: on ? '#0F1F33' : isDark ? '#141414' : '#fff',
                    borderColor: on ? '#0F1F33' : isDark ? '#242424' : '#E5E5E5',
                  }}
                >
                  <Ionicons name={on ? 'git-network-outline' : icon} size={15} color={on ? '#fff' : isDark ? '#E5E5E5' : '#374151'} />
                  <Text className="text-xs font-bold" style={{ color: on ? '#fff' : isDark ? '#E5E5E5' : '#374151' }}>
                    {on ? (narrow ? 'Chart' : 'Flowchart View') : narrow && view === 'sheet' ? 'Sheet' : narrow && view === 'gantt' ? 'Gantt' : narrow && view === 'dates' ? 'Dates' : label}
                  </Text>
                </Pressable>
              );
            })
          : null}
        </ScrollView>
        <Pressable
          testID="flowchart-eye"
          onPress={() => toggleShowSets()}
          accessibilityRole="button"
          accessibilityLabel={showSets ? 'Hide old flowchart versions' : 'Show old flowchart versions'}
          className="items-center justify-center rounded-xl border"
          style={{ width: 40, height: 40, backgroundColor: showSets ? '#0F1F33' : isDark ? '#141414' : '#fff', borderColor: showSets ? '#0F1F33' : isDark ? '#242424' : '#E5E5E5' }}
        >
          <Ionicons name={showSets ? 'eye' : 'eye-outline'} size={18} color={showSets ? '#fff' : isDark ? '#E5E5E5' : '#374151'} />
        </Pressable>
        {taskSet === null && data && data.tasks.length > 0 ? (
          <Pressable
            testID="flowchart-more"
            onPress={() => setMoreOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="More options"
            className="items-center justify-center rounded-xl border"
            style={{ width: 40, height: 40, backgroundColor: isDark ? '#141414' : '#fff', borderColor: isDark ? '#242424' : '#E5E5E5' }}
          >
            {excelExporting ? <ActivityIndicator size="small" color="#0F1F33" /> : <Ionicons name="ellipsis-horizontal" size={18} color={isDark ? '#E5E5E5' : '#374151'} />}
          </Pressable>
        ) : null}
      </View>}

      {/* "⋯" more options */}
      <FormModal visible={moreOpen} onRequestClose={() => setMoreOpen(false)} position="bottom" animationType="slide">
        <View className="bg-white rounded-t-2xl px-4 pt-3 pb-8 w-full self-center" style={{ maxWidth: 560 }}>
          <View className="flex-row items-center mb-2">
            <Text className="flex-1 text-base font-bold text-neutral-900">More</Text>
            <Pressable onPress={() => setMoreOpen(false)} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#6B7280" />
            </Pressable>
          </View>
          <Pressable
            testID="flowchart-more-excel"
            onPress={() => {
              setMoreOpen(false);
              void handleDownloadExcel();
            }}
            disabled={excelExporting || filteredTasks.length === 0}
            className="flex-row items-center gap-3 border-t border-neutral-100"
            style={{ minHeight: 52, opacity: excelExporting || filteredTasks.length === 0 ? 0.5 : 1 }}
          >
            <Ionicons name="document-text-outline" size={20} color="#15803D" />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-neutral-900">Download Excel</Text>
              <Text className="text-2xs text-neutral-500">{filteredTasks.length} task{filteredTasks.length === 1 ? '' : 's'}{hasActiveFilter ? ' (filtered)' : ''}</Text>
            </View>
          </Pressable>
          {board !== 'main' ? (
            <Pressable
              testID="flowchart-more-checklist-excel"
              onPress={() => {
                setMoreOpen(false);
                void handleDownloadChecklistExcel();
              }}
              disabled={excelExporting || filteredTasks.length === 0}
              className="flex-row items-center gap-3 border-t border-neutral-100"
              style={{ minHeight: 52, opacity: excelExporting || filteredTasks.length === 0 ? 0.5 : 1 }}
            >
              <Ionicons name="checkbox-outline" size={20} color="#15803D" />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-neutral-900">Download Checklist Excel</Text>
                <Text className="text-2xs text-neutral-500">{filteredTasks.length} tasks · client checklist filled in from the app</Text>
              </View>
            </Pressable>
          ) : null}
          {board === 'fc2' || board === 'fc2test' || board === 'test' || isPastBoard(board) ? (
            <Pressable
              testID="flowchart-more-a3pdf"
              onPress={() => {
                setMoreOpen(false);
                void handleDownloadA3Pdf();
              }}
              disabled={excelExporting || filteredTasks.length === 0}
              className="flex-row items-center gap-3 border-t border-neutral-100"
              style={{ minHeight: 52, opacity: excelExporting || filteredTasks.length === 0 ? 0.5 : 1 }}
            >
              <Ionicons name="document-outline" size={20} color="#B91C1C" />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-neutral-900">Download A3 PDF</Text>
                <Text className="text-2xs text-neutral-500">{dateOrder ? 'Date Order chart' : 'Flowchart drawing'}, A3 portrait{hasActiveFilter ? ' (filtered)' : ''}</Text>
              </View>
            </Pressable>
          ) : null}
          {isPastBoard(board) && isStaff && boardLayout.positions.size > 0 ? (
            <Pressable
              testID="flowchart-more-reset-layout"
              onPress={async () => {
                setMoreOpen(false);
                try {
                  await clearBoardPositions(board);
                  setBoardLayout((prev) => ({ ...prev, positions: new Map() }));
                  setRefreshKey((k) => k + 1);
                } catch (e) {
                  setExcelNote({ text: `Couldn't reset the layout — ${e instanceof Error ? e.message : String(e)}`, isError: true });
                }
              }}
              className="flex-row items-center gap-3 border-t border-neutral-100"
              style={{ minHeight: 52 }}
            >
              <Ionicons name="refresh-outline" size={20} color="#0F1F33" />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-neutral-900">Reset layout</Text>
                <Text className="text-2xs text-neutral-500">Moved cards go back to where the board puts them</Text>
              </View>
            </Pressable>
          ) : null}
          {board === 'pastcopy' && dateOrder ? (
            <Pressable
              testID="flowchart-more-a4pdf"
              onPress={() => {
                setMoreOpen(false);
                void handleDownloadA4Pdf();
              }}
              disabled={excelExporting}
              className="flex-row items-center gap-3 border-t border-neutral-100"
              style={{ minHeight: 52, opacity: excelExporting ? 0.5 : 1 }}
            >
              <Ionicons name="print-outline" size={20} color="#B91C1C" />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-neutral-900">Download A4 PDF</Text>
                <Text className="text-2xs text-neutral-500">Top row down to PC-CIV-34 · 3 pages, A4 portrait</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      </FormModal>

      {showSets ? (
      <View
        className="flex-row flex-wrap items-center gap-1.5 px-3 pb-1.5"
        style={{ backgroundColor: CANVAS_THEMES[canvasTheme].bg }}
      >
        <Text className="text-2xs font-bold mr-1" style={{ color: isDark ? '#A3A3A3' : '#6B7280' }}>Old versions:</Text>
        {(Object.keys(FLOWCHART_SET_LABEL) as FlowchartSetKey[]).map((key) => {
          const active = taskSet === key;
          return (
            <Pressable
              key={key}
              onPress={() => setTaskSet(active ? null : key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              className="px-3 py-1 rounded-full border"
              style={{
                backgroundColor: active ? '#0F1F33' : isDark ? '#141414' : '#fff',
                borderColor: active ? '#0F1F33' : isDark ? '#242424' : '#E5E5E5',
              }}
            >
              <Text className="text-xs font-bold" style={{ color: active ? '#fff' : isDark ? '#E5E5E5' : '#374151' }}>
                {FLOWCHART_SET_LABEL[key]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      ) : null}

      {taskSet !== null ? (
        archive.loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#0F1F33" />
          </View>
        ) : archive.error ? (
          <View className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
            <Text className="text-sm text-red-600">{archive.error}</Text>
          </View>
        ) : !archive.data || archive.data.tasks.length === 0 ? (
          <EmptyState
            icon="git-network-outline"
            iconColor="#9CA3AF"
            title={`No ${FLOWCHART_SET_LABEL[taskSet]} saved yet`}
            subtitle="This hidden task set hasn't been added to the database yet."
          />
        ) : (
          <View className="flex-1">
            <View className="px-4 py-1.5" style={{ backgroundColor: isDark ? '#1F1A0A' : '#FEF3C7' }}>
              <Text className="text-2xs font-semibold" style={{ color: isDark ? '#FCD34D' : '#92400E' }}>
                Hidden set · view only · {archive.data.tasks.length} tasks · not linked to DPR or checklists
              </Text>
            </View>
            <FlowchartCanvas
              key={`set-${taskSet}-r${refreshKey}`}
              projectId={selectedProjectId}
              viewMemory={viewMemory}
              initialTasks={archive.data.tasks}
              seriesEdges={archive.data.seriesEdges}
              parallelEdges={archive.data.parallelEdges}
              taskTypes={data?.taskTypes ?? []}
              canEdit={false}
              viewOnly
              canvasTheme={canvasTheme}
              onCanvasThemeChange={setCanvasTheme}
            />
          </View>
        )
      ) : loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : !data || (data.tasks.length === 0 && (!isStaff || board === 'fc3')) ? (
        <EmptyState
          icon="git-network-outline"
          iconColor="#9CA3AF"
          title="No tasks yet"
          subtitle="This project doesn't have any tasks to chart yet."
        />
      ) : data.tasks.length === 0 ? (
        // Staff on an empty project: keep the canvas (its toolbar holds the
        // New Task button) with a centred hint over the empty grid.
        <View className="flex-1">
          <FlowchartCanvas
            key={`empty-${board}-r${refreshKey}`}
            projectId={selectedProjectId}
            viewMemory={viewMemory}
            flowchartSet={flowchartSetForBoard(board)}
            initialTasks={data.tasks}
            seriesEdges={data.seriesEdges}
            parallelEdges={data.parallelEdges}
            taskTypes={data.taskTypes}
            canEdit={isStaff}
            canvasTheme={canvasTheme}
            onCanvasThemeChange={setCanvasTheme}
            onTaskCountChange={setEmptyCanvasCount}
          />
          {emptyCanvasCount === 0 ? <View pointerEvents="none" className="absolute inset-0 items-center justify-center px-10">
            <View className="items-center rounded-2xl px-6 py-5" style={{ backgroundColor: isDark ? 'rgba(20,20,20,0.92)' : 'rgba(255,255,255,0.94)' }}>
              <View className="w-14 h-14 rounded-full items-center justify-center mb-3" style={{ backgroundColor: '#FEF3C7' }}>
                <Ionicons name="git-network-outline" size={26} color="#F0A227" />
              </View>
              <Text className="text-base font-bold text-center" style={{ color: isDark ? '#F5F5F5' : '#0F1F33' }}>Start this project&apos;s flowchart</Text>
              <Text className="text-xs text-center mt-1.5" style={{ color: isDark ? '#A3A3A3' : '#6B7280' }}>
                Tap <Text className="font-bold">New Task</Text> at the top to add the first task.
              </Text>
            </View>
          </View> : null}
        </View>
      ) : (
        <>
          {/* Filter results controls (only while a filter is on). The phase
              completion chip and the Excel button moved out (2026-11-13). */}
          {hasActiveFilter && (
          <View
            className="flex-row flex-wrap items-center justify-between gap-y-2 px-4 py-2 border-b"
            style={{ backgroundColor: CANVAS_THEMES[canvasTheme].bg, borderColor: isDark ? '#242424' : '#F5F5F5' }}
          >
            {hasActiveFilter && (
              <View className="flex-row items-center gap-1.5 ml-auto">
                <View className="flex-row rounded-lg bg-neutral-100 p-0.5">
                  <Pressable
                    onPress={() => setViewMode('flowchart')}
                    className="px-2.5 py-1 rounded-md"
                    style={{ backgroundColor: viewMode === 'flowchart' ? '#fff' : 'transparent' }}
                  >
                    <Text className={`text-2xs font-bold ${viewMode === 'flowchart' ? 'text-neutral-900' : 'text-neutral-400'}`}>Chart</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setViewMode('list')}
                    className="px-2.5 py-1 rounded-md"
                    style={{ backgroundColor: viewMode === 'list' ? '#fff' : 'transparent' }}
                  >
                    <Text className={`text-2xs font-bold ${viewMode === 'list' ? 'text-neutral-900' : 'text-neutral-400'}`}>List</Text>
                  </Pressable>
                </View>
                <Pressable onPress={handleDownloadPdf} disabled={exporting} hitSlop={6} style={{ opacity: exporting ? 0.4 : 1 }}>
                  {exporting ? <ActivityIndicator size="small" color="#0F1F33" /> : <Ionicons name="download-outline" size={18} color="#0F1F33" />}
                </Pressable>
                <Pressable onPress={handlePrint} disabled={printing} hitSlop={6} style={{ opacity: printing ? 0.4 : 1 }}>
                  {printing ? <ActivityIndicator size="small" color="#0F1F33" /> : <Ionicons name="print-outline" size={18} color="#0F1F33" />}
                </Pressable>
                <Pressable onPress={handleClearFilters} hitSlop={6}>
                  <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                </Pressable>
              </View>
            )}
          </View>
          )}

          {excelNote && (
            <Pressable
              onPress={() => setExcelNote(null)}
              className="flex-row items-center gap-2 px-4 py-2"
              style={{ backgroundColor: excelNote.isError ? '#FEE2E2' : '#DCFCE7' }}
            >
              <Ionicons name={excelNote.isError ? 'alert-circle' : 'checkmark-circle'} size={15} color={excelNote.isError ? '#B91C1C' : '#15803D'} />
              <Text className="flex-1 text-xs font-semibold" style={{ color: excelNote.isError ? '#B91C1C' : '#15803D' }}>
                {excelNote.text}
              </Text>
              <Ionicons name="close" size={14} color={excelNote.isError ? '#B91C1C' : '#15803D'} />
            </Pressable>
          )}

          {/* The yellow "56 Tasks · view only · write reasons in Sheet View"
              strip on the 56 Tasks board was removed on request (2026-11-18). */}
          {boardView === 'sheet' && board !== 'main' ? (
            <ChecklistSheetView tasks={sheetTasks} editable={isStaff} userId={profile?.id ?? null} />
          ) : boardView === 'reports' && board !== 'main' && board !== 'fc3' ? (
            <SheetReportView
              stages={isPastBoard(board)}
              tasks={reportTasks}
              copiedTaskIds={isPastBoard(board) ? new Set(copiedReportTasks.map((t) => t.id)) : undefined}
              projectName={projectName}
              pastMilestones={
                isPastBoard(board)
                  ? {
                      title: board === 'pastcopy' ? (boardMilestones.length ? 'LEVEL / MILESTONE' : 'LEVEL') : 'MILESTONE',
                      options: reportGroups.map((m) => ({ value: m.name, label: m.label, format: m.format, lastCode: m.lastCode, endCode: m.endCode, workingDays: m.workingDays, scope: m.scope, totalFromLastFinished: m.totalFromLastFinished, conWhole: m.conWhole })),
                      value: pastMilestone,
                      onChange: setPastMilestone,
                      missing: missingReportCodes,
                      chain: reportChain,
                    }
                  : undefined
              }
              topFilterText={[statusFilter, deptFilter, floorFilter, roomFilter, milestoneFilter ? milestones.find((m) => m.id === milestoneFilter)?.name : null, filterSummary.plannedDate]
                .filter(Boolean)
                .join(' · ')}
              pageFilters={{
                departments: reportDepartments,
                department: deptFilter,
                floor: floorFilter,
                room: roomFilter,
                milestones: boardMilestones,
                milestoneId: milestoneFilter,
                plannedDateText: filterSummary.plannedDate,
                onDepartment: setDeptFilter,
                onFloor: setFloorFilter,
                onRoom: setRoomFilter,
                onMilestone: setMilestoneFilter,
                onOpenFilters: () => setFilterModalOpen(true),
              }}
            />
          ) : boardView === 'gantt' && board !== 'main' && board !== 'fc3' ? (
            <GanttView
              tasks={sheetTasks}
              allTasks={data.tasks}
              seriesEdges={data.seriesEdges}
              projectName={projectName}
              filterText={[statusFilter, deptFilter, floorFilter, roomFilter, milestoneFilter ? milestones.find((m) => m.id === milestoneFilter)?.name : null, filterSummary.plannedDate]
                .filter(Boolean)
                .join(' · ')}
            />
          ) : hasActiveFilter && viewMode === 'list' ? (
            <FilteredTaskList tasks={filteredTasks} />
          ) : dateOrder ? (
            <FlowchartCanvas
              key={`dates-${canvasFilterKey}-r${refreshKey}`}
              projectId={selectedProjectId}
              viewMemory={viewMemory}
              // Past Tasks board: turns on the blue Estimated dates (and checklist
              // wheel) exactly as on Current Status. View-only, so nothing is created here.
              flowchartSet={flowchartSetForBoard(board)}
              initialTasks={dateOrder.tasks}
              seriesEdges={dateOrder.edges}
              parallelEdges={dateOrder.parallelEdges}
              taskTypes={data.taskTypes}
              // Move & link here too (2026-11-22, client): staff, once
              // unlocked for Editing; kept on this board only (boardLayout).
              canEdit={isStaff && !hasActiveFilter}
              boardLayout={dateBoardLayout}
              uniqueTaskCount={dateOrder.tasks.length}
              // Every card opens/edits like a normal board (staff edit) — the
              // Past Tasks stacks and, since 2026-11-21, the Current Status copy
              // below (editing a copy card edits that Current Status task).
              detailTaskIds={new Set(dateOrder.tasks.map((t) => t.id))}
              // The Current Status copy: on Past Works its delays sit under Construction,
              // with its own (empty) Pre-construction — Current Status itself is untouched.
              copiedTaskIds={new Set(dateOrder.tasks.filter((t) => !filteredTaskIds.has(t.id)).map((t) => t.id))}
              detailEditAllowed={isStaff}
              canvasTheme={canvasTheme}
              onCanvasThemeChange={setCanvasTheme}
              onMilestonesChange={handleMilestonesChange}
              delayCheckPanel={isPastBoard(board)}
            />
          ) : (
            <FlowchartCanvas
              key={`${board}-${canvasFilterKey}-r${refreshKey}`}
              projectId={selectedProjectId}
              viewMemory={viewMemory}
              flowchartSet={flowchartSetForBoard(board)}
              initialTasks={hasActiveFilter ? columnTasks : data.tasks}
              seriesEdges={hasActiveFilter ? filteredSeriesEdges : data.seriesEdges}
              parallelEdges={hasActiveFilter ? filteredParallelEdges : data.parallelEdges}
              taskTypes={data.taskTypes}
              canEdit={isStaff && !hasActiveFilter && board !== 'fc3'}
              viewOnly={board === 'fc3'}
              canvasTheme={canvasTheme}
              onCanvasThemeChange={setCanvasTheme}
            />
          )}

          <FlowchartFilterModal
            visible={filterModalOpen}
            departments={allDepartments}
            floor={floorFilter}
            department={deptFilter}
            room={roomFilter}
            milestones={boardMilestones}
            milestoneId={milestoneFilter}
            dateMode={dateMode}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChangeFloor={setFloorFilter}
            onChangeDepartment={setDeptFilter}
            onChangeRoom={setRoomFilter}
            onChangeMilestone={setMilestoneFilter}
            onChangeDateMode={setDateMode}
            onChangeDateFrom={setDateFrom}
            onChangeDateTo={setDateTo}
            statusFilter={statusFilter}
            onChangeStatus={setStatusFilter}
            shownCount={filteredTasks.length}
            totalCount={data.tasks.length}
            onClear={handleClearFilters}
            onClose={() => setFilterModalOpen(false)}
          />
        </>
      )}
    </View>
  );
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
