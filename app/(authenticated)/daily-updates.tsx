import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../components/ui/AppText';
import { KeyboardAvoider } from '../../components/ui/KeyboardAvoider';
import { isFieldRole, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { DprTaskRow } from '../../components/dpr/DprTaskRow';
import { DprHistorySection } from '../../components/dpr/DprHistorySection';
import { DprWorkersAttendance } from '../../components/workforce/DprWorkersAttendance';
import { DateField } from '../../components/ui/DateField';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatCardDateRange } from '../../lib/flowchart/delay';
import {
  addDaysToKey,
  EMPTY_DPR_ENTRY,
  fetchTodayDprEntries,
  fetchTodaySubtasks,
  fetchUrgentTasksForEngineer,
  fetchWeekDprTasks,
  formatHeaderDate,
  inPreconstruction,
  todayDateKey,
  weekRangeAndLabel,
  type DprEntryFields,
  type DprSubtaskItem,
  type DprTask,
} from '../../lib/dprEntries';
import { fetchApprovedGrantsForToday, requestDprEditAccess } from '../../lib/dprEditRequests';
import { fetchWorksForProject, type WorkOption } from '../../lib/flowchart/data';

// Outside/above the status+department drill-down — Today (the full DPR
// editing form), Upcoming (tomorrow, read-only preview), and Week (the
// whole calendar week, read-only preview), by explicit request.
type TimeScope = 'today' | 'upcoming' | 'week' | 'pr';
const TIME_SCOPE_ORDER: TimeScope[] = ['today', 'upcoming', 'week', 'pr'];
const TIME_SCOPE_LABEL: Record<TimeScope, string> = {
  today: 'Today',
  upcoming: 'Upcoming',
  week: 'Week',
  // PR — Progress Report: pick a date range, then one cumulative % per task
  // (app/pr-edit/[taskId].tsx).
  pr: 'PR',
};

// PR tab row: task + planned span, Edit PR (or checklist pending).
function PrTaskRow({ task }: { task: DprTask }) {
  const pre = inPreconstruction(task.status);
  return (
    <View className="flex-row items-center gap-2 py-2.5 border-b border-neutral-100">
      <View className="flex-1 pr-1">
        <Text className="text-xs font-semibold text-neutral-800" numberOfLines={1}>{task.taskName}</Text>
        <Text className="text-2xs text-neutral-400 mt-0.5" numberOfLines={1}>
          {task.workName} · {formatCardDateRange(task.plannedStartDate, task.plannedEndDate)}
        </Text>
        {pre ? <Text className="text-2xs font-semibold text-neutral-500 mt-0.5">Checklist pending</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit PR for ${task.taskName}`}
        onPress={() => router.push(`/pr-edit/${task.id}`)}
        className="flex-row items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1.5"
      >
        <Ionicons name="create-outline" size={12} color="#0F1F33" />
        <Text className="text-2xs font-bold text-brand-navy">Edit PR</Text>
      </Pressable>
    </View>
  );
}

// A read-only preview row for Upcoming/Week — no DPR fields to fill in yet
// (those are only ever entered for today), just enough to see what's coming.
function TaskSummaryRow({ task }: { task: DprTask }) {
  return (
    <View className="flex-row items-center justify-between py-2.5 border-b border-neutral-100">
      <View className="flex-1 pr-2">
        <Text className="text-xs font-semibold text-neutral-800" numberOfLines={1}>{task.taskName}</Text>
        <Text className="text-2xs text-neutral-400 mt-0.5">{task.workName}</Text>
      </View>
      <View className="items-end">
        <Text className="text-2xs text-neutral-400">{formatCardDateRange(task.plannedStartDate, task.plannedEndDate)}</Text>
        {task.scheduledToday && (
          <View className="mt-1 px-2 py-0.5 rounded-full bg-brand-amber/15">
            <Text className="text-2xs font-bold text-brand-amber">Today</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// "All" chip on the DPR list's department filter.
const ALL_DEPARTMENTS = 'All';

// Status tabs on Today's list. Completed tasks never reach this list.
type StatusTabKey = 'yet' | 'in_progress' | 'on_hold';
const STATUS_TABS: { key: StatusTabKey; label: string }[] = [
  { key: 'yet', label: 'Yet to Start' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'on_hold', label: 'On Hold' },
];
function statusTabOf(status: DprTask['status']): StatusTabKey {
  if (status === 'in_progress') return 'in_progress';
  if (status === 'on_hold') return 'on_hold';
  return 'yet'; // draft / ready / blocked
}

// The DPR tab's single screen — no separate landing page + "New DPR" button
// step, and no Scheduled-today/This-week stat cards, by explicit request:
// this Drawer screen (title set in ../_layout.tsx's Drawer.Screen) goes
// straight to today's date and today's own task list. Points 1-6 and 8 of
// the DPR form itself. Point 7 (quality checklist PDF/sign-off) is linked
// from each row rather than inlined into it — see DprTaskRow's own Quality
// Checklist action. Point 6's Completed Tasks list is its OWN separate
// drawer tab (completed-tasks.tsx), not a section on this screen.
export default function DailyUpdatesLandingScreen() {
  const { state } = useAuth();
  const isFieldEngineer = state.status === 'signed-in' && isFieldRole(state.profile.role);
  // Admin can also view/edit/submit DPR from mobile, by explicit request —
  // there's only ONE dpr_entries row per (task, day), not one per user, so
  // admin editing it here is literally the same record a site engineer
  // already filled in, not a separate admin-only copy.
  const isAdminUser = state.status === 'signed-in' && state.profile.role === 'admin';
  const { selectedProjectId } = useProject();

  // The project's departments, fetched once for the whole list and passed to
  // each DprTaskRow (it used to be one identical query per row).
  const [projectWorks, setProjectWorks] = useState<WorkOption[]>([]);
  useEffect(() => {
    if (!selectedProjectId) return;
    let cancelled = false;
    fetchWorksForProject(selectedProjectId)
      .then((w) => !cancelled && setProjectWorks(w))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const todayKey = todayDateKey();
  const { weekStartKey, weekEndKey, label: weekLabel } = weekRangeAndLabel(todayKey);
  const tomorrowKey = addDaysToKey(todayKey, 1);
  // Tomorrow can fall in the NEXT calendar week (e.g. today is Saturday, the
  // last day of a Sun-Sat week) — widen the fetch past weekEndKey whenever
  // that happens, so Upcoming always has tomorrow's tasks regardless of
  // where in the week today lands.
  const fetchEndKey = weekEndKey > tomorrowKey ? weekEndKey : tomorrowKey;

  const [tasks, setTasks] = useState<DprTask[]>([]);
  const [urgentTasks, setUrgentTasks] = useState<DprTask[]>([]);
  const [entries, setEntries] = useState<Record<string, DprEntryFields>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeScope, setTimeScope] = useState<TimeScope>('today');
  // PR tab date range (defaults to this calendar week).
  const [prFrom, setPrFrom] = useState(weekStartKey);
  const [prTo, setPrTo] = useState(weekEndKey);
  // Department filter chip on Today's list (null = All).
  const [activeDepartment, setActiveDepartment] = useState<string | null>(null);
  // Status tab on Today's list (null = first tab that has tasks).
  const [statusTab, setStatusTab] = useState<StatusTabKey | null>(null);
  // Which of today's tasks this engineer already has an admin-approved
  // "Contact Admin" edit grant for — unlocks DprTaskRow's own locked form
  // for just that (task, day), see its isLockedForEngineer.
  const [approvedGrants, setApprovedGrants] = useState<Set<string>>(new Set());
  // Today's subtasks per task — a day can now have SEVERAL, each with its
  // own text and Department, by explicit request (see DprSubtaskItem).
  const [subtasksByTask, setSubtasksByTask] = useState<Record<string, DprSubtaskItem[]>>({});

  const load = useCallback(async () => {
    if (!selectedProjectId) {
      setTasks([]);
      setUrgentTasks([]);
      setEntries({});
      setSubtasksByTask({});
      return;
    }
    try {
      setError(null);
      const engineerId = state.status === 'signed-in' ? state.profile.id : null;
      const [weekTasks, urgent] = await Promise.all([
        fetchWeekDprTasks(selectedProjectId, weekStartKey, fetchEndKey, todayKey),
        engineerId ? fetchUrgentTasksForEngineer(selectedProjectId, engineerId, todayKey) : Promise.resolve([]),
      ]);
      setTasks(weekTasks);
      setUrgentTasks(urgent);
      // Urgent tasks aren't necessarily IN weekTasks (an urgent task can be
      // scheduled well outside this week) — their DPR entries (Dependency/
      // Comments/% Work Done Today) still need fetching, or a freshly
      // pushed urgent task would look like it has no entry row at all.
      const allIds = [...new Set([...weekTasks.map((t) => t.id), ...urgent.map((t) => t.id)])];
      setEntries(await fetchTodayDprEntries(allIds, todayKey));
      setSubtasksByTask(await fetchTodaySubtasks(allIds, todayKey));
      if (engineerId) setApprovedGrants(await fetchApprovedGrantsForToday(allIds, todayKey, engineerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // weekStartKey/fetchEndKey/todayKey are all pure functions of "now" —
    // recomputed fresh every render, not state, so they're deliberately
    // left out of this dependency list (identical values every time this
    // screen is open on the same calendar day; a genuinely new day only
    // ever arrives via a fresh mount anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, state.status]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (state.status !== 'signed-in' || (!isFieldEngineer && !isAdminUser)) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  const prTasks = tasks
    .filter((t) => t.plannedStartDate && t.plannedEndDate && t.plannedStartDate <= prTo && t.plannedEndDate >= prFrom)
    .sort((a, b) => (a.plannedStartDate ?? '').localeCompare(b.plannedStartDate ?? ''));
  const tomorrowTasks = tasks.filter((t) => t.plannedStartDate && t.plannedEndDate && t.plannedStartDate <= tomorrowKey && t.plannedEndDate >= tomorrowKey);
  const weekTasks = tasks.filter((t) => t.plannedStartDate && t.plannedEndDate && t.plannedStartDate <= weekEndKey && t.plannedEndDate >= weekStartKey);

  // Today's list: every active task (urgent pushes first), then by planned
  // start — no status / checklist drill-down any more.
  const urgentIds = new Set(urgentTasks.map((t) => t.id));
  const allDprTasks = [
    ...urgentTasks,
    ...tasks
      .filter((t) => t.scheduledToday && !urgentIds.has(t.id))
      .sort((a, b) => (a.plannedStartDate ?? '9999').localeCompare(b.plannedStartDate ?? '9999')),
  ];
  // Departments of today's tasks -> the Workers Attendance folders shown above the list.
  const todayDepartments = Array.from(
    new Map(allDprTasks.filter((t) => t.workId).map((t) => [t.workId as string, { workId: t.workId as string, workName: t.workName }])).values()
  );
  // Status tabs (2026-11-11): each task sits under its own status.
  const statusCounts = Object.fromEntries(STATUS_TABS.map((s) => [s.key, allDprTasks.filter((t) => statusTabOf(t.status) === s.key).length])) as Record<StatusTabKey, number>;
  const activeStatus: StatusTabKey =
    statusTab && statusCounts[statusTab] > 0 ? statusTab : (STATUS_TABS.find((s) => statusCounts[s.key] > 0)?.key ?? 'yet');
  const statusTasks = allDprTasks.filter((t) => statusTabOf(t.status) === activeStatus);
  const listDepartments = Array.from(new Set(statusTasks.map((t) => t.workName)));
  const listDepartment = activeDepartment && listDepartments.includes(activeDepartment) ? activeDepartment : ALL_DEPARTMENTS;
  const listTasks = listDepartment === ALL_DEPARTMENTS ? statusTasks : statusTasks.filter((t) => t.workName === listDepartment);

  async function handleRequestEditAccess(task: DprTask, message: string) {
    if (!selectedProjectId || state.status !== 'signed-in') return;
    await requestDprEditAccess(task.id, todayKey, selectedProjectId, state.profile.id, task.taskName, message);
  }

  return (
    <KeyboardAvoider style={{ backgroundColor: '#FAFAFA' }}>
      <View className="px-4 pt-4 pb-2">
        <Text className="text-lg font-extrabold text-neutral-900">{formatHeaderDate(todayKey)}</Text>
        <Text className="text-xs text-neutral-400 mt-0.5">{weekLabel}</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="px-4 pb-8 flex-grow"
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
        >
          {error && (
            <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-4">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          )}

          {!selectedProjectId ? (
            <EmptyState icon="calendar-outline" iconColor="#9CA3AF" title="No project selected" subtitle="Pick a project from Home to fill in today's DPR." />
          ) : (
            <>
              {/* Today / Upcoming / Week switch. */}
                <View className="flex-row self-start rounded-lg bg-neutral-100 p-0.5 mb-3">
                  {TIME_SCOPE_ORDER.map((scope) => {
                    const active = scope === timeScope;
                    return (
                      <Pressable
                        key={scope}
                        onPress={() => setTimeScope(scope)}
                        className="rounded-md px-3 py-1.5"
                        style={{ backgroundColor: active ? '#fff' : 'transparent' }}
                      >
                        <Text className={`text-xs font-bold ${active ? 'text-neutral-900' : 'text-neutral-400'}`}>
                          {TIME_SCOPE_LABEL[scope]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

              {timeScope === 'today' ? (
                <>
                {allDprTasks.length === 0 ? (
                  <EmptyState
                    icon="checkmark-done-outline"
                    iconColor="#9CA3AF"
                    title="No tasks to report on"
                    subtitle="Tasks added to this project's flowchart show here."
                  />
                ) : (
                  // Planned start/end drive this list now, not the pre-
                  // construction checklist stage, by explicit request
                  // (2026-11-09): every active task, earliest planned start
                  // first, each opening straight into its DPR 1..N pager.
                  <>
                    {/* Workers Attendance — separate section for the
                        departments of today's tasks (autosaves; same records
                        as inside each task's DPR). */}
                    <DprWorkersAttendance
                      projectId={selectedProjectId}
                      departments={todayDepartments}
                      dateKey={todayKey}
                      userId={state.profile.id}
                    />
                    {/* Status tabs */}
                    <View className="flex-row border-b border-neutral-200 mb-3">
                      {STATUS_TABS.map((s) => {
                        const active = s.key === activeStatus;
                        return (
                          <Pressable
                            key={s.key}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: active }}
                            onPress={() => {
                              setStatusTab(s.key);
                              setActiveDepartment(null);
                            }}
                            className="flex-1 flex-row items-center justify-center gap-1 py-2"
                            style={{ borderBottomWidth: 2, borderBottomColor: active ? '#0F1F33' : 'transparent' }}
                          >
                            <Text numberOfLines={1} className={`shrink text-xs font-bold ${active ? 'text-neutral-900' : 'text-neutral-400'}`}>{s.label}</Text>
                            <Text className={`shrink-0 text-2xs font-bold ${active ? 'text-neutral-900' : 'text-neutral-400'}`}>({statusCounts[s.key]})</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {listTasks.length === 0 && (
                      <Text className="text-xs text-neutral-400 mb-3">No tasks here.</Text>
                    )}
                    {listDepartments.length > 1 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerClassName="flex-row items-center gap-2 mb-3">
                        {[ALL_DEPARTMENTS, ...listDepartments].map((dept) => {
                          const active = dept === listDepartment;
                          const count = dept === ALL_DEPARTMENTS ? statusTasks.length : statusTasks.filter((t) => t.workName === dept).length;
                          return (
                            <Pressable
                              key={dept}
                              onPress={() => setActiveDepartment(dept)}
                              className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
                              style={{ backgroundColor: active ? '#0F1F33' : '#F5F5F5' }}
                            >
                              <Text className={`text-xs font-bold ${active ? 'text-white' : 'text-neutral-700'}`}>{dept}</Text>
                              <View className="rounded-full px-1.5 py-0.5" style={{ backgroundColor: active ? 'rgba(255,255,255,0.2)' : '#E5E5E5' }}>
                                <Text className={`text-2xs font-bold ${active ? 'text-white' : 'text-neutral-600'}`}>{count}</Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    )}
                    {listTasks.map((task) => (
                      <DprTaskRow
                        key={task.id}
                        task={task}
                        projectId={selectedProjectId}
                        works={projectWorks}
                        dependencies={(entries[task.id] ?? EMPTY_DPR_ENTRY).dependencyCategories}
                        dependencyOtherText={(entries[task.id] ?? EMPTY_DPR_ENTRY).dependencyOtherText}
                        comment={(entries[task.id] ?? EMPTY_DPR_ENTRY).comment}
                        subtasks={subtasksByTask[task.id] ?? []}
                        percentComplete={(entries[task.id] ?? EMPTY_DPR_ENTRY).percentComplete}
                        submittedByName={(entries[task.id] ?? EMPTY_DPR_ENTRY).submittedByName}
                        submittedAtISO={(entries[task.id] ?? EMPTY_DPR_ENTRY).submittedAtISO}
                        isAdmin={isAdminUser}
                        dprSubmittedAtISO={(entries[task.id] ?? EMPTY_DPR_ENTRY).dprSubmittedAtISO}
                        hasApprovedEditGrant={approvedGrants.has(task.id)}
                        onRequestEditAccess={(message) => handleRequestEditAccess(task, message)}
                      />
                    ))}
                    {isAdminUser && <DprHistorySection projectId={selectedProjectId} />}
                  </>
                )}
                </>
              ) : timeScope === 'pr' ? (
                <>
                  {/* Date range -> every task whose planned span overlaps it. */}
                  <View className="flex-row gap-2 mb-3">
                    <View className="flex-1">
                      <DateField label="From" value={prFrom} onChange={(d) => { setPrFrom(d); if (d > prTo) setPrTo(d); }} />
                    </View>
                    <View className="flex-1">
                      <DateField label="To" value={prTo} minDate={prFrom} onChange={setPrTo} />
                    </View>
                  </View>
                  {prTasks.length === 0 ? (
                    <EmptyState icon="calendar-outline" iconColor="#9CA3AF" title="No tasks in this range" subtitle="Pick a different From / To range." />
                  ) : (
                    <Card>
                      <Text className="text-2xs text-neutral-400 mb-1">
                        {prTasks.length} task{prTasks.length === 1 ? '' : 's'} · one cumulative % per task, shared across its DPR days
                      </Text>
                      {prTasks.map((task) => (
                        <PrTaskRow key={task.id} task={task} />
                      ))}
                    </Card>
                  )}
                </>
              ) : timeScope === 'upcoming' ? (
                tomorrowTasks.length === 0 ? (
                  <EmptyState icon="calendar-outline" iconColor="#9CA3AF" title="Nothing scheduled tomorrow" />
                ) : (
                  <Card>
                    {tomorrowTasks.map((task) => (
                      <TaskSummaryRow key={task.id} task={task} />
                    ))}
                  </Card>
                )
              ) : weekTasks.length === 0 ? (
                <EmptyState icon="calendar-outline" iconColor="#9CA3AF" title="Nothing scheduled this week" />
              ) : (
                <Card>
                  {weekTasks.map((task) => (
                    <TaskSummaryRow key={task.id} task={task} />
                  ))}
                </Card>
              )}
            </>
          )}
        </ScrollView>
      )}
    </KeyboardAvoider>
  );
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
