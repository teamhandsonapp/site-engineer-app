import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { Text } from '../../components/ui/AppText';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import {
  fetchFlowchartData,
  fetchFlowchartSet,
  FLOWCHART_SET_LABEL,
  flowchartSetForBoard,
  type FlowchartBoard,
  type FlowchartData,
  type FlowchartSetKey,
} from '../../lib/flowchart/data';
import { exportFilteredTasksPdf, printFilteredTasks } from '../../lib/flowchart/filterExport';
import { exportFlowchartExcel } from '../../lib/flowchart/excelExport';
import { fetchMilestones, type Milestone } from '../../lib/flowchart/milestones';
import { CANVAS_THEMES, type CanvasTheme } from '../../components/flowchart/GridBackground';
import { matchesPlannedDateFilter, PLANNED_DATE_MODE_LABEL, type PlannedDateMode } from '../../lib/flowchart/plannedDateFilter';
import { formatDateLabel } from '../../lib/reports/dateRange';
import { FlowchartCanvas } from '../../components/flowchart/FlowchartCanvas';
import { FlowchartFilterModal } from '../../components/flowchart/FlowchartFilterModal';
import { FilteredTaskList } from '../../components/flowchart/FilteredTaskList';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormModal } from '../../components/ui/FormModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { withTimeout } from '../../lib/withTimeout';

const FETCH_TIMEOUT_MS = 12_000;
const SHOW_SETS_KEY = 'flowchart:showOldVersions';

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
  const [board, setBoard] = useState<FlowchartBoard>('main');
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
      const [flowchartData, milestoneList] = await Promise.all([
        withTimeout(fetchFlowchartData(projectId, board), FETCH_TIMEOUT_MS, "Couldn't reach the server — check your connection and try again."),
        fetchMilestones(projectId).catch(() => []), // filter option list only — a courtesy, not load-bearing, same as FlowchartCanvas's own fetchMilestones call
      ]);
      setData(flowchartData);
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

  // Filter derivations — all null when nothing's been picked yet, which
  // makes filteredTasks equal data.tasks exactly (no behavior change for a
  // project where the filter's never been opened).
  const allDepartments = Array.from(new Set((data?.tasks ?? []).map((t) => t.workName)));
  const plannedDateFilterActive = dateMode !== null && dateFrom !== null && dateTo !== null && dateFrom <= dateTo;
  const hasActiveFilter = floorFilter !== null || deptFilter !== null || roomFilter !== null || milestoneFilter !== null || plannedDateFilterActive;
  const filteredTasks = (data?.tasks ?? []).filter(
    (t) =>
      (floorFilter === null || t.floorLevel === floorFilter) &&
      (deptFilter === null || t.workName === deptFilter) &&
      (roomFilter === null || t.roomType === roomFilter) &&
      (milestoneFilter === null || t.milestoneId === milestoneFilter) &&
      (!plannedDateFilterActive || matchesPlannedDateFilter(t, dateMode!, dateFrom!, dateTo!))
  );
  const filteredTaskIds = new Set(filteredTasks.map((t) => t.id));
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
        <View className="flex-row rounded-xl p-1" style={{ backgroundColor: isDark ? '#1F1F1F' : '#F1F3F6' }}>
          {(['main', 'fc2'] as FlowchartBoard[]).map((b) => {
            const active = board === b;
            return (
              <Pressable
                key={b}
                testID={`flowchart-board-${b}`}
                onPress={() => {
                  if (board === b) return;
                  setTaskSet(null);
                  setBoard(b);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                className="items-center justify-center rounded-lg px-4"
                style={{ minHeight: 36, backgroundColor: active ? (isDark ? '#141414' : '#fff') : 'transparent' }}
              >
                <Text className="text-xs font-bold" style={{ color: active ? (isDark ? '#F5F5F5' : '#0F1F33') : '#9CA3AF' }}>
                  {b === 'main' ? 'Flowchart' : 'Flowchart 2'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Top row (2026-11-13): Filter · ⋯ more (Excel) · 👁 old flowchart versions. */}
      <View
        className="flex-row items-center gap-2 px-3 pt-2 pb-1.5"
        style={{ backgroundColor: CANVAS_THEMES[canvasTheme].bg }}
      >
        {taskSet === null && data && data.tasks.length > 0 ? (
          <Pressable
            testID="flowchart-filter"
            onPress={() => setFilterModalOpen(true)}
            className="flex-row items-center gap-1.5 px-3 rounded-xl border"
            style={{
              minHeight: 40,
              backgroundColor: hasActiveFilter ? '#0F1F33' : isDark ? '#141414' : '#fff',
              borderColor: hasActiveFilter ? '#0F1F33' : isDark ? '#242424' : '#E5E5E5',
            }}
          >
            <Ionicons name="filter-outline" size={15} color={hasActiveFilter ? '#fff' : isDark ? '#E5E5E5' : '#374151'} />
            <Text className="text-xs font-bold" style={{ color: hasActiveFilter ? '#fff' : isDark ? '#E5E5E5' : '#374151' }}>
              Filter{hasActiveFilter ? ` (${filteredTasks.length})` : ''}
            </Text>
          </Pressable>
        ) : null}
        <View className="flex-1" />
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
      </View>

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
              key={`set-${taskSet}`}
              projectId={selectedProjectId}
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
      ) : !data || (data.tasks.length === 0 && !isStaff) ? (
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
            key={`empty-${board}`}
            projectId={selectedProjectId}
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

          {hasActiveFilter && viewMode === 'list' ? (
            <FilteredTaskList tasks={filteredTasks} />
          ) : (
            <FlowchartCanvas
              // Remounts on every filter change — FlowchartCanvas seeds its
              // own position/zoom state from initialTasks ONCE at mount
              // (useMemo/useState with an empty dep array), so swapping the
              // prop alone would silently keep showing the old task set.
              key={`${board}-${
                hasActiveFilter
                  ? `filtered-${floorFilter}-${deptFilter}-${roomFilter}-${milestoneFilter}-${dateMode}-${dateFrom}-${dateTo}`
                  : 'unfiltered'
              }`}
              projectId={selectedProjectId}
              flowchartSet={flowchartSetForBoard(board)}
              initialTasks={hasActiveFilter ? filteredTasks : data.tasks}
              seriesEdges={hasActiveFilter ? filteredSeriesEdges : data.seriesEdges}
              parallelEdges={hasActiveFilter ? filteredParallelEdges : data.parallelEdges}
              taskTypes={data.taskTypes}
              canEdit={isStaff}
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
            milestones={milestones}
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
