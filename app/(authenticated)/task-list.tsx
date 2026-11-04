import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchFlowchartData, type FlowchartData } from '../../lib/flowchart/data';
import { formatActualDateRange, formatCardDateRange, resolveDelayChip, splitTaskName } from '../../lib/flowchart/delay';
import type { FlowchartTask } from '../../lib/flowchart/types';
import { fetchPendingChecklistVerifications, type PendingChecklistVerification } from '../../lib/taskDetail/data';
import { formatTime12h } from '../../lib/formatTime';
import { supabase } from '../../lib/supabase';
import { EmptyState } from '../../components/ui/EmptyState';
import { withTimeout } from '../../lib/withTimeout';

const FETCH_TIMEOUT_MS = 12_000;

// Same data source as Flowchart (lib/flowchart/data.ts's fetchFlowchartData)
// — a flat, searchable, virtualized alternative for quickly locating ONE
// task by name/code (awkward to do inside the pan/zoom graph with 300+
// nodes), not a second data model. Tapping a row goes to the exact same
// app/task/[taskId].tsx detail screen Flowchart's own "Open" action uses,
// which now also shows this same task's dependencies (predecessors/
// successors/parallel, via task_dependencies/task_parallel_links) and its
// existing checklist — nothing new to build there either.
type TaskStatus = 'Not Started' | 'In Progress' | 'Completed';

function deriveStatus(task: FlowchartTask): TaskStatus {
  if (task.actualEndDate) return 'Completed';
  if (task.actualStartDate) return 'In Progress';
  return 'Not Started';
}

const STATUS_STYLE: Record<TaskStatus, { bg: string; text: string }> = {
  'Not Started': { bg: '#F3F4F6', text: '#6B7280' },
  'In Progress': { bg: '#DBEAFE', text: '#1D4ED8' },
  Completed: { bg: '#DCFCE7', text: '#15803D' },
};

function TaskRow({ task }: { task: FlowchartTask }) {
  const status = deriveStatus(task);
  const statusStyle = STATUS_STYLE[status];
  const delayChip = resolveDelayChip(task);
  const { category, action } = splitTaskName(task.taskName);
  const actualDateRange = formatActualDateRange(task.actualStartDate, task.actualEndDate);
  const plannedDateRange = formatCardDateRange(task.plannedStartDate, task.dueDate);

  return (
    <Pressable
      onPress={() => router.push(`/task/${task.id}`)}
      className="bg-white rounded-xl border border-neutral-100 px-3.5 py-3 mb-2"
    >
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-2xs font-bold text-neutral-400">{task.taskId} · {task.workName}</Text>
        <View className="flex-row items-center gap-1.5">
          {delayChip && (
            <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#FEE2E2' }}>
              <Text className="text-2xs font-bold text-red-600">+{delayChip.days}d</Text>
            </View>
          )}
          <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: statusStyle.bg }}>
            <Text className="text-2xs font-bold" style={{ color: statusStyle.text }}>{status}</Text>
          </View>
        </View>
      </View>
      {category && <Text className="text-2xs text-neutral-400 mb-0.5">{category}</Text>}
      <Text className="text-sm font-semibold text-neutral-900 mb-1">{action}</Text>
      <Text className="text-2xs text-neutral-400">{actualDateRange ?? plannedDateRange}</Text>
    </Pressable>
  );
}

// Checklist completion -> admin notification -> on-site verification —
// the review queue's own row shape (PendingChecklistVerification), NOT a
// FlowchartTask, so it gets its own row component rather than overloading
// TaskRow with fields the "All Tasks" view never has.
function PendingReviewRow({ item }: { item: PendingChecklistVerification }) {
  return (
    <Pressable
      onPress={() => router.push(`/task/${item.id}`)}
      className="bg-white rounded-xl border border-blue-100 px-3.5 py-3 mb-2"
    >
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-2xs font-bold text-neutral-400">{item.taskCode} · {item.workName}</Text>
        <View className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200">
          <Text className="text-2xs font-bold text-blue-700">Pending review</Text>
        </View>
      </View>
      <Text className="text-sm font-semibold text-neutral-900 mb-1">{item.taskName}</Text>
      <Text className="text-2xs text-neutral-400">
        {item.completedByName ?? 'A site engineer'} — {formatTime12h(new Date(item.completedAtISO))}
      </Text>
    </Pressable>
  );
}

export default function TaskListScreen() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isStaff = profile ? appRoleFor(profile.role) === 'staff' : false;
  // Same inline check every other admin/manager-gated screen in this app
  // uses (no shared helper exists).
  const isAdminOrManager = profile != null && (profile.role === 'admin' || profile.role === 'manager');
  const { selectedProjectId } = useProject();

  const [data, setData] = useState<FlowchartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'pending'>('all');
  const [pending, setPending] = useState<PendingChecklistVerification[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);

  const load = useCallback(async (projectId: string) => {
    try {
      setError(null);
      setData(await withTimeout(fetchFlowchartData(projectId), FETCH_TIMEOUT_MS, "Couldn't reach the server — check your connection and try again."));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadPending = useCallback(async (projectId: string) => {
    try {
      setError(null);
      setPending(await fetchPendingChecklistVerifications(projectId));
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

  useEffect(() => {
    if (!selectedProjectId || !isAdminOrManager) return;
    setPendingLoading(true);
    loadPending(selectedProjectId).finally(() => setPendingLoading(false));
  }, [selectedProjectId, isAdminOrManager, loadPending]);

  // Live updates — a checklist reaching 100% (server-side trigger) or an
  // admin action (verify_task_checklist) both write to `tasks`, so a plain
  // UPDATE listener is enough to keep this queue current without a manual
  // refresh. `tasks` has no project_id column of its own (only reachable
  // via work_id -> works.project_id), so this can't be filtered server-side
  // to just this project — the refetch itself is what's project-scoped.
  // Random channel-name suffix (not a fixed topic) — same anti-collision
  // reasoning as critical-alerts.tsx/leave-log.tsx's identical pattern.
  const channelSuffixRef = useRef(Math.random().toString(36).slice(2));
  useEffect(() => {
    if (!selectedProjectId || !isAdminOrManager) return;
    const channel = supabase
      .channel(`task-list-pending-${channelSuffixRef.current}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, () => {
        loadPending(selectedProjectId);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedProjectId, isAdminOrManager, loadPending]);

  function retry() {
    if (!selectedProjectId) return;
    if (viewMode === 'pending') loadPending(selectedProjectId);
    else load(selectedProjectId);
  }

  const filteredTasks = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.tasks;
    return data.tasks.filter((t) => t.taskId.toLowerCase().includes(q) || t.taskName.toLowerCase().includes(q));
  }, [data, query]);

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
          icon="list-outline"
          iconColor="#9CA3AF"
          title={isStaff ? 'No project selected' : 'No project assigned'}
          subtitle={
            isStaff
              ? 'Pick a project from Home to see its task list.'
              : "Your account isn't linked to a project yet. Contact your PMC office to get this set up."
          }
        />
      </View>
    );
  }

  const showPending = isAdminOrManager && viewMode === 'pending';

  return (
    <View className="flex-1 bg-neutral-50">
      {error && (
        <View className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
          <Pressable onPress={retry} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      )}

      {isAdminOrManager && (
        <View className="flex-row gap-2 px-4 pt-4">
          <Pressable
            onPress={() => setViewMode('all')}
            className="px-3.5 py-1.5 rounded-full"
            style={{ backgroundColor: viewMode === 'all' ? '#0F1F33' : '#fff', borderWidth: 1, borderColor: viewMode === 'all' ? '#0F1F33' : '#E5E5E5' }}
          >
            <Text className="text-xs font-bold" style={{ color: viewMode === 'all' ? '#fff' : '#525252' }}>All Tasks</Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('pending')}
            className="px-3.5 py-1.5 rounded-full flex-row items-center gap-1.5"
            style={{ backgroundColor: viewMode === 'pending' ? '#0F1F33' : '#fff', borderWidth: 1, borderColor: viewMode === 'pending' ? '#0F1F33' : '#E5E5E5' }}
          >
            <Text className="text-xs font-bold" style={{ color: viewMode === 'pending' ? '#fff' : '#525252' }}>
              Pending Review{pending.length > 0 ? ` (${pending.length})` : ''}
            </Text>
          </Pressable>
        </View>
      )}

      {showPending ? (
        pendingLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#0F1F33" />
          </View>
        ) : pending.length === 0 ? (
          <EmptyState icon="checkmark-circle-outline" iconColor="#9CA3AF" title="Nothing pending" subtitle="No completed checklists are waiting for review right now." />
        ) : (
          <FlatList
            data={pending}
            keyExtractor={(t) => t.id}
            renderItem={({ item }) => <PendingReviewRow item={item} />}
            contentContainerClassName="px-4 pt-3 pb-8"
          />
        )
      ) : loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : !data || data.tasks.length === 0 ? (
        <EmptyState icon="list-outline" iconColor="#9CA3AF" title="No tasks yet" subtitle="This project doesn't have any tasks yet." />
      ) : (
        <>
          <View className="px-4 pt-4 pb-2">
            <View className="flex-row items-center gap-2 bg-white rounded-xl border border-neutral-200 px-3 py-2.5">
              <Ionicons name="search-outline" size={16} color="#a3a3a3" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by task name or code"
                placeholderTextColor="#a3a3a3"
                className="flex-1 text-sm text-neutral-900"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={16} color="#a3a3a3" />
                </Pressable>
              )}
            </View>
          </View>

          {filteredTasks.length === 0 ? (
            <EmptyState icon="search-outline" iconColor="#9CA3AF" title="No matching tasks" subtitle="Try a different search term." />
          ) : (
            <FlatList
              data={filteredTasks}
              keyExtractor={(t) => t.id}
              renderItem={({ item }) => <TaskRow task={item} />}
              contentContainerClassName="px-4 pb-8"
              ListHeaderComponent={
                <Text className="text-2xs text-neutral-400 mb-2">
                  {filteredTasks.length} of {data.tasks.length} task{data.tasks.length === 1 ? '' : 's'}
                </Text>
              }
            />
          )}
        </>
      )}
    </View>
  );
}
