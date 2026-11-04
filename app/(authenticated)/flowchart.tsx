import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchFlowchartData, type FlowchartData } from '../../lib/flowchart/data';
import { exportFilteredTasksPdf, printFilteredTasks } from '../../lib/flowchart/filterExport';
import { fetchMilestones, type Milestone } from '../../lib/flowchart/milestones';
import { CANVAS_THEMES, type CanvasTheme } from '../../components/flowchart/GridBackground';
import { matchesPlannedDateFilter, PLANNED_DATE_MODE_LABEL, type PlannedDateMode } from '../../lib/flowchart/plannedDateFilter';
import { formatDateLabel } from '../../lib/reports/dateRange';
import { FlowchartCanvas } from '../../components/flowchart/FlowchartCanvas';
import { FlowchartFilterModal } from '../../components/flowchart/FlowchartFilterModal';
import { FilteredTaskList } from '../../components/flowchart/FilteredTaskList';
import { PhaseCompletionBar } from '../../components/flowchart/PhaseCompletionBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { withTimeout } from '../../lib/withTimeout';

const FETCH_TIMEOUT_MS = 12_000;

type FlowchartViewMode = 'flowchart' | 'list';

// Which project this shows is no longer this screen's own concern — it
// reads the single shared selection from ProjectContext (set on App Home /
// Project Dashboard) instead of fetching its own project list and showing
// its own picker chips, same re-plumbing as Gantt.
export default function FlowchartScreen() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isStaff = profile ? appRoleFor(profile.role) === 'staff' : false;
  const { selectedProjectId } = useProject();

  const [data, setData] = useState<FlowchartData | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter panel — Floor/Department/Room/Milestone, each independently
  // combinable; null means "All" for that dimension. Operates on whatever
  // fetchFlowchartData already returned, so it's automatically scoped to
  // the same hidden_from_flowchart/pilot-visible set the unfiltered canvas
  // shows. Planned Date is a 5th dimension but shaped differently — a mode
  // (Start/Complete/Happening) PLUS a range, so it only counts as active
  // once all three are set (see plannedDateFilterActive below).
  const [filterModalOpen, setFilterModalOpen] = useState(false);
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
        withTimeout(fetchFlowchartData(projectId), FETCH_TIMEOUT_MS, "Couldn't reach the server — check your connection and try again."),
        fetchMilestones(projectId).catch(() => []), // filter option list only — a courtesy, not load-bearing, same as FlowchartCanvas's own fetchMilestones call
      ]);
      setData(flowchartData);
      setMilestones(milestoneList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : !data || data.tasks.length === 0 ? (
        <EmptyState
          icon="git-network-outline"
          iconColor="#9CA3AF"
          title="No tasks yet"
          subtitle="This project doesn't have any tasks to chart yet."
        />
      ) : (
        <>
          <PhaseCompletionBar tasks={data.tasks} seriesEdges={data.seriesEdges} theme={canvasTheme} />

          <View
            className="flex-row items-center justify-between px-4 py-2 border-b"
            style={{ backgroundColor: CANVAS_THEMES[canvasTheme].bg, borderColor: isDark ? '#242424' : '#F5F5F5' }}
          >
            <Pressable
              onPress={() => setFilterModalOpen(true)}
              className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full border"
              style={{
                backgroundColor: hasActiveFilter ? '#0F1F33' : isDark ? '#141414' : '#fff',
                borderColor: hasActiveFilter ? '#0F1F33' : isDark ? '#242424' : '#E5E5E5',
              }}
            >
              <Ionicons name="filter-outline" size={14} color={hasActiveFilter ? '#fff' : isDark ? '#E5E5E5' : '#374151'} />
              <Text className="text-xs font-bold" style={{ color: hasActiveFilter ? '#fff' : isDark ? '#E5E5E5' : '#374151' }}>
                Filter{hasActiveFilter ? ` (${filteredTasks.length})` : ''}
              </Text>
            </Pressable>

            {hasActiveFilter && (
              <View className="flex-row items-center gap-1.5">
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

          {hasActiveFilter && viewMode === 'list' ? (
            <FilteredTaskList tasks={filteredTasks} />
          ) : (
            <FlowchartCanvas
              // Remounts on every filter change — FlowchartCanvas seeds its
              // own position/zoom state from initialTasks ONCE at mount
              // (useMemo/useState with an empty dep array), so swapping the
              // prop alone would silently keep showing the old task set.
              key={
                hasActiveFilter
                  ? `filtered-${floorFilter}-${deptFilter}-${roomFilter}-${milestoneFilter}-${dateMode}-${dateFrom}-${dateTo}`
                  : 'unfiltered'
              }
              projectId={selectedProjectId}
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
