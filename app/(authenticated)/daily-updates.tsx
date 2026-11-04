import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { isFieldRole, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { DprTaskRow } from '../../components/dpr/DprTaskRow';
import { DprHistorySection } from '../../components/dpr/DprHistorySection';
import { formatCardDateRange } from '../../lib/flowchart/delay';
import {
  addDaysToKey,
  EMPTY_DPR_ENTRY,
  fetchPendingChecklistSummaries,
  fetchTodayDprEntries,
  fetchTodaySubtasks,
  fetchUrgentTasksForEngineer,
  fetchWeekDprTasks,
  formatHeaderDate,
  todayDateKey,
  weekRangeAndLabel,
  type DprEntryFields,
  type DprSubtaskItem,
  type DprTask,
  type PendingChecklistGroup,
} from '../../lib/dprEntries';
import { fetchApprovedGrantsForToday, requestDprEditAccess } from '../../lib/dprEditRequests';
import { CATEGORY_LABEL } from '../../lib/taskDetail/constants';
import type { DependencyCategory } from '../../lib/taskDetail/constants';

// Outside/above the status+department drill-down — Today (the full DPR
// editing form), Upcoming (tomorrow, read-only preview), and Week (the
// whole calendar week, read-only preview), by explicit request.
type TimeScope = 'today' | 'upcoming' | 'week';
const TIME_SCOPE_ORDER: TimeScope[] = ['today', 'upcoming', 'week'];
const TIME_SCOPE_LABEL: Record<TimeScope, string> = {
  today: 'Today',
  upcoming: 'Upcoming',
  week: 'Week',
};

// A read-only preview row for Upcoming/Week — no DPR fields to fill in yet
// (those are only ever entered for today), just enough to see what's coming.
function TaskSummaryRow({ task }: { task: DprTask }) {
  return (
    <View className="flex-row items-center justify-between py-2.5 border-b border-neutral-100">
      <View className="flex-1 pr-2">
        <Text className="text-xs font-semibold text-neutral-800" numberOfLines={1}>{task.taskCode} — {task.taskName}</Text>
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

// Pending tab's own row shape — by explicit request, distinct from the full
// DprTaskRow every other bucket shows: just the task id/department plus
// which checklist categories still have unfulfilled prerequisite items and
// how many (e.g. "Architect: 3 pending"), not the whole DPR entry form.
// Tapping through opens /task/[taskId] — the existing prerequisite-detail
// screen (reused as-is, not rebuilt) — for "what exactly is pending."
function PendingTaskSummaryRow({ task, groups }: { task: DprTask; groups: PendingChecklistGroup[] }) {
  return (
    <Pressable onPress={() => router.push(`/task/${task.id}`)}>
      <Card className="mb-2.5">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-2">
            <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>
              {task.taskCode} · {task.workName}
            </Text>
            <Text className="text-xs text-neutral-500 mt-0.5" numberOfLines={1}>{task.taskName}</Text>
          </View>
          <Text className="text-neutral-300 text-base">›</Text>
        </View>
        {groups.length > 0 && (
          <View className="flex-row flex-wrap gap-1.5 mt-2">
            {groups.map((g) => (
              <View key={g.category} className="px-2 py-0.5 rounded-full bg-red-50">
                <Text className="text-2xs font-semibold text-red-600">
                  {CATEGORY_LABEL[g.category as DependencyCategory] ?? g.category}: {g.pendingCount} pending
                </Text>
              </View>
            ))}
          </View>
        )}
      </Card>
    </Pressable>
  );
}

// Today's tasks drill down 2 levels: first ONLY the 4 status options
// (Priority/In Progress/On Hold/Pending — the last one covers draft/ready/
// blocked, shown as "Yet to Start" everywhere else in this app, renamed
// "Pending" here — "Priority"/urgent internally is the one exception, see
// below); tapping one hides that list and shows that status's departments
// as a chip row PLUS the currently-picked department's tasks directly
// below, both on the same screen — switching chips no longer navigates to
// a separate level (by explicit request, once several real departments
// existed at once: a full extra screen just to pick one, before any task
// appeared, read as an unnecessary step). The chip row auto-selects the
// first department the moment a status is opened, so a task list is always
// showing, never an empty "pick one" prompt. Bucketing is driven by the
// task's REAL status (bucketForTask below) — In Progress means the task has
// actually started, not just "scheduled today"; a not-yet-started task
// (draft/ready/blocked) lands in Pending regardless of its date. Priority/
// urgent is a separate, orthogonal bucket — whatever an admin pushed to
// THIS engineer from the flowchart (pushTasksUrgent), fetched separately
// since an urgent task might not even be scheduled today.
type StatusBucket = 'urgent' | 'in_progress' | 'on_hold' | 'pending';
const BUCKET_ORDER: StatusBucket[] = ['urgent', 'in_progress', 'on_hold', 'pending'];
const BUCKET_LABEL: Record<StatusBucket, string> = {
  urgent: 'Priority',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  pending: 'Pending',
};
// Wired to the task's REAL status — was a hardcoded stub returning
// 'in_progress' for every task regardless of status, by explicit
// correction: "it should have started, then only it will come in
// progress." Matches STATUS_DISPLAY_LABEL's own grouping (DprTaskRow.tsx):
// draft/ready/blocked = "Yet to Start" (-> pending here), on_hold stays its
// own bucket, in_progress is the only one that means the task has actually
// started. completed tasks never reach this function at all (excluded
// upstream by fetchWeekDprTasks's own point-5 filter).
function bucketForTask(task: DprTask): StatusBucket {
  if (task.status === 'in_progress') return 'in_progress';
  if (task.status === 'on_hold') return 'on_hold';
  return 'pending'; // draft/ready/blocked
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
  // null = not drilled in yet — only the level above is shown, by explicit
  // request ("when I open one thing only another will come... not
  // everything show outside"). Status -> Department -> Tasks is a strict
  // one-level-at-a-time reveal now, each with its own back step, instead of
  // all three stacked and visible together.
  const [activeBucket, setActiveBucket] = useState<StatusBucket | null>(null);
  // Department chips — back by explicit request, scoped to non-Pending
  // buckets only (Pending's own PendingTaskSummaryRow already shows each
  // task's department inline, so a filter row there would be redundant).
  const [activeDepartment, setActiveDepartment] = useState<string | null>(null);
  const [pendingSummaries, setPendingSummaries] = useState<Record<string, PendingChecklistGroup[]>>({});
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
      // Pending tab's own checklist summary — fetched for every task here
      // (cheap, one batched query) rather than re-fetched per drill-down,
      // since which tasks land in "pending" is only known once bucketed at
      // render time from the real status.
      setPendingSummaries(await fetchPendingChecklistSummaries(allIds));
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

  const todayTasks = tasks.filter((t) => t.scheduledToday);
  const tomorrowTasks = tasks.filter((t) => t.plannedStartDate && t.plannedEndDate && t.plannedStartDate <= tomorrowKey && t.plannedEndDate >= tomorrowKey);
  const weekTasks = tasks.filter((t) => t.plannedStartDate && t.plannedEndDate && t.plannedStartDate <= weekEndKey && t.plannedEndDate >= weekStartKey);
  const tasksByBucket: Record<StatusBucket, DprTask[]> = { urgent: urgentTasks, in_progress: [], on_hold: [], pending: [] };
  for (const task of todayTasks) tasksByBucket[bucketForTask(task)].push(task);

  // Department chips — shown for every bucket EXCEPT Pending (that one's
  // own PendingTaskSummaryRow already prints the department inline per row,
  // so a filter there would just be a redundant extra tap). Auto-selects
  // the FIRST department the moment a status is opened (falls back to it
  // whenever activeDepartment is null or stale — e.g. picked under a
  // different status tab with no matching department) so a task list is
  // always showing under the chips, never an empty "pick one" prompt.
  const activeBucketTasks = activeBucket ? tasksByBucket[activeBucket] : [];
  const showDepartmentChips = activeBucket !== null && activeBucket !== 'pending';
  const departments = showDepartmentChips ? Array.from(new Set(activeBucketTasks.map((t) => t.workName))) : [];
  const effectiveDepartment = showDepartmentChips
    ? ((activeDepartment && departments.includes(activeDepartment) ? activeDepartment : departments[0]) ?? null)
    : null;
  const visibleTasks = showDepartmentChips ? activeBucketTasks.filter((t) => t.workName === effectiveDepartment) : activeBucketTasks;

  async function handleRequestEditAccess(task: DprTask, message: string) {
    if (!selectedProjectId || state.status !== 'signed-in') return;
    await requestDprEditAccess(task.id, todayKey, selectedProjectId, state.profile.id, `${task.taskCode} — ${task.taskName}`, message);
  }

  return (
    <View className="flex-1 bg-neutral-50">
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
              {/* Hidden once drilled into a status bucket (In Progress/On
                  Hold/Pending), by explicit correction — Today/Upcoming/
                  Week only belongs at the outermost level; sitting above
                  the bucket's own back arrow + task list read as clutter.
                  Upcoming/Week have no bucket drill-down of their own (see
                  their flat TaskSummaryRow list below), so this only ever
                  needs to hide for Today. */}
              {!(timeScope === 'today' && activeBucket !== null) && (
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
              )}

              {timeScope === 'today' ? (
                <>
                {todayTasks.length === 0 && urgentTasks.length === 0 ? (
                  <EmptyState
                    icon="checkmark-done-outline"
                    iconColor="#9CA3AF"
                    title="Nothing scheduled today"
                    subtitle="No active tasks have a planned date falling on today."
                  />
                ) : activeBucket === null ? (
                  // Level 1 — status only. Nothing else on screen until one is tapped.
                  <View className="gap-2.5">
                    {BUCKET_ORDER.map((bucket) => (
                      <Pressable
                        key={bucket}
                        onPress={() => setActiveBucket(bucket)}
                        className="flex-row items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3.5"
                      >
                        <Text className="text-sm font-bold text-neutral-900">{BUCKET_LABEL[bucket]}</Text>
                        <View className="flex-row items-center gap-2">
                          <View className="px-2 py-0.5 rounded-full bg-neutral-100">
                            <Text className="text-2xs font-bold text-neutral-600">{tasksByBucket[bucket].length}</Text>
                          </View>
                          <Text className="text-neutral-300 text-base">›</Text>
                        </View>
                      </Pressable>
                    ))}
                    {isAdminUser && <DprHistorySection />}
                  </View>
                ) : (
                  // Level 2 — department chips (Pending excepted, see
                  // showDepartmentChips's own comment above) directly above
                  // that department's tasks, both on this one screen;
                  // switching chips just swaps effectiveDepartment, no
                  // further navigation.
                  <>
                    <Pressable onPress={() => setActiveBucket(null)} className="flex-row items-center gap-1 mb-3 self-start">
                      <Text className="text-base text-neutral-400">‹</Text>
                      <Text className="text-sm font-semibold text-neutral-500">{BUCKET_LABEL[activeBucket]}</Text>
                    </Pressable>

                    {showDepartmentChips && departments.length > 0 && (
                      // items-center — a horizontal ScrollView's content container
                      // defaults to alignItems: stretch on its cross axis; without
                      // this each chip stretches to the ScrollView's own height
                      // instead of its own content, turning rounded-full into a
                      // giant vertical capsule (confirmed live once already).
                      // maxHeight — on web, ScrollView itself has no intrinsic
                      // height and defaults to flex-growing inside this column
                      // layout, which left a large empty gap above and below the
                      // chip row (confirmed live) instead of sitting flush under
                      // the back link. Capped to the chip's own rendered height.
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }} contentContainerClassName="flex-row items-center gap-2 mb-3">
                        {departments.map((dept) => {
                          const count = activeBucketTasks.filter((t) => t.workName === dept).length;
                          const active = dept === effectiveDepartment;
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

                    {visibleTasks.length === 0 ? (
                      <Text className="text-xs text-neutral-400 px-1">No tasks in this group.</Text>
                    ) : activeBucket === 'pending' ? (
                      visibleTasks.map((task) => (
                        <PendingTaskSummaryRow key={task.id} task={task} groups={pendingSummaries[task.id] ?? []} />
                      ))
                    ) : (
                      visibleTasks.map((task) => (
                        <DprTaskRow
                          key={task.id}
                          task={task}
                          projectId={selectedProjectId}
                          dependencies={(entries[task.id] ?? EMPTY_DPR_ENTRY).dependencyCategories}
                          dependencyOtherText={(entries[task.id] ?? EMPTY_DPR_ENTRY).dependencyOtherText}
                          comment={(entries[task.id] ?? EMPTY_DPR_ENTRY).comment}
                          subtasks={subtasksByTask[task.id] ?? []}
                          percentComplete={(entries[task.id] ?? EMPTY_DPR_ENTRY).percentComplete}
                          targetedWorkforcePerDay={(entries[task.id] ?? EMPTY_DPR_ENTRY).targetedWorkforcePerDay}
                          actualWorkforcePerDay={(entries[task.id] ?? EMPTY_DPR_ENTRY).actualWorkforcePerDay}
                          submittedByName={(entries[task.id] ?? EMPTY_DPR_ENTRY).submittedByName}
                          submittedAtISO={(entries[task.id] ?? EMPTY_DPR_ENTRY).submittedAtISO}
                          isAdmin={isAdminUser}
                          dprSubmittedAtISO={(entries[task.id] ?? EMPTY_DPR_ENTRY).dprSubmittedAtISO}
                          hasApprovedEditGrant={approvedGrants.has(task.id)}
                          onRequestEditAccess={(message) => handleRequestEditAccess(task, message)}
                        />
                      ))
                    )}

                  </>
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
    </View>
  );
}
