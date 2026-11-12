import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { KeyboardAvoider } from '../../components/ui/KeyboardAvoider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { EmptyState } from '../../components/ui/EmptyState';
import { WorkerFolderCard } from '../../components/workforce/WorkerFolderCard';
import { useAttendanceMarks } from '../../components/workforce/useAttendanceMarks';
import { createWorkforceFolder, fetchWorkforceFolders, folderStats, type WorkforceFolder } from '../../lib/workforce';
import { fetchWorksForProject, type WorkOption } from '../../lib/flowchart/data';
import { addDaysToKey, formatHeaderDate, todayDateKey } from '../../lib/dprEntries';

// Attendance tab — Workers Attendance (2026-11-11). Department folders, each
// with its people (manager | worker); mark present/absent for any day, see
// the day's turnout. The DPR tab marks the same records for the departments
// of today's tasks. Data: lib/workforce.ts (supabase/workforce.sql).

function Stat({ value, label, color }: { value: string | number; label: string; color: string }) {
  return (
    <View className="flex-1 items-center rounded-xl border border-neutral-200 bg-white py-3">
      <Text className="text-xl font-extrabold" style={{ color, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text className="text-2xs text-neutral-400 mt-0.5">{label}</Text>
    </View>
  );
}

export default function TeamAttendanceScreen() {
  const { state } = useAuth();
  const userId = state.status === 'signed-in' ? state.profile.id : null;
  const { selectedProjectId } = useProject();
  const today = todayDateKey();

  const [dateKey, setDateKey] = useState(today);
  const [folders, setFolders] = useState<WorkforceFolder[] | null>(null);
  const [works, setWorks] = useState<WorkOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      setError(null);
      const [f, w] = await Promise.all([fetchWorkforceFolders(selectedProjectId), fetchWorksForProject(selectedProjectId)]);
      setFolders(f);
      setWorks(w);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { marks, savingIds, mark, error: markError } = useAttendanceMarks(folders, dateKey, userId);

  async function handleCreateFolder(workId: string) {
    if (!selectedProjectId) return;
    setCreating(workId);
    try {
      await createWorkforceFolder(selectedProjectId, workId);
      setPickingFolder(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(null);
    }
  }

  if (!selectedProjectId) {
    return <EmptyState icon="people-outline" iconColor="#9CA3AF" title="No project selected" subtitle="Pick a project from Home to see workers attendance." />;
  }

  const totals = (folders ?? []).reduce(
    (acc, f) => {
      const s = folderStats(f, marks);
      return { total: acc.total + s.total, present: acc.present + s.present, absent: acc.absent + s.absent, unmarked: acc.unmarked + s.unmarked };
    },
    { total: 0, present: 0, absent: 0, unmarked: 0 }
  );
  const turnout = totals.total > 0 ? Math.round((totals.present / totals.total) * 100) : 0;
  const folderWorkIds = new Set((folders ?? []).map((f) => f.workId));
  const availableWorks = works.filter((w) => !folderWorkIds.has(w.id));

  return (
    <KeyboardAvoider>
    <ScrollView
      className="flex-1 bg-neutral-50"
      contentContainerClassName="px-4 pt-4 pb-10"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#0F1F33" />}
    >
      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">Workers Attendance</Text>

      {/* Day picker */}
      <View className="flex-row items-center rounded-xl border border-neutral-200 bg-white mb-3">
        <Pressable accessibilityLabel="Previous day" onPress={() => setDateKey((d) => addDaysToKey(d, -1))} className="p-3">
          <Ionicons name="chevron-back" size={18} color="#0F1F33" />
        </Pressable>
        <View className="flex-1 items-center">
          <Text className="text-sm font-bold text-neutral-900">{formatHeaderDate(dateKey)}</Text>
          {dateKey === today ? <Text className="text-2xs text-neutral-400">Today</Text> : (
            <Pressable onPress={() => setDateKey(today)}><Text className="text-2xs font-bold text-brand-navy">Back to today</Text></Pressable>
          )}
        </View>
        <Pressable accessibilityLabel="Next day" disabled={dateKey >= today} onPress={() => setDateKey((d) => addDaysToKey(d, 1))} className="p-3" style={{ opacity: dateKey >= today ? 0.3 : 1 }}>
          <Ionicons name="chevron-forward" size={18} color="#0F1F33" />
        </Pressable>
      </View>

      {/* Analytics for the day */}
      <View className="flex-row gap-2 mb-2">
        <Stat value={totals.total} label="People" color="#0F1F33" />
        <Stat value={totals.present} label="Present" color="#15803D" />
        <Stat value={totals.absent} label="Absent" color="#DC2626" />
        <Stat value={totals.unmarked} label="Not marked" color="#B45309" />
      </View>
      <View className="rounded-xl border border-neutral-200 bg-white p-3 mb-4">
        <View className="flex-row justify-between mb-1.5">
          <Text className="text-xs font-semibold text-neutral-600">Turnout</Text>
          <Text className="text-xs font-bold text-neutral-900">{turnout}%</Text>
        </View>
        <View className="h-2 rounded-full bg-neutral-100 overflow-hidden">
          <View className="h-2 rounded-full" style={{ width: `${turnout}%`, backgroundColor: turnout >= 90 ? '#16A34A' : turnout >= 70 ? '#F0A227' : '#DC2626' }} />
        </View>
      </View>

      {error || markError ? (
        <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-3">
          <Text className="text-sm text-red-600">{error ?? markError}</Text>
        </View>
      ) : null}

      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400">Department folders</Text>
        <Pressable onPress={() => setPickingFolder((v) => !v)} className="flex-row items-center gap-1 rounded-full bg-brand-navy px-3 py-1.5">
          <Ionicons name={pickingFolder ? 'close' : 'add'} size={14} color="#fff" />
          <Text className="text-xs font-bold text-white">{pickingFolder ? 'Close' : 'New folder'}</Text>
        </Pressable>
      </View>

      {pickingFolder && (
        <View className="rounded-xl border border-neutral-200 bg-white p-3 mb-3">
          <Text className="text-xs text-neutral-500 mb-2">Pick a department to make a folder for:</Text>
          {availableWorks.length === 0 ? (
            <Text className="text-xs text-neutral-400">Every department already has a folder.</Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {availableWorks.map((w) => (
                <Pressable key={w.id} disabled={creating !== null} onPress={() => void handleCreateFolder(w.id)} className="flex-row items-center gap-1 rounded-full border border-neutral-200 px-3 py-1.5">
                  {creating === w.id ? <ActivityIndicator size="small" color="#0F1F33" /> : <Ionicons name="folder-outline" size={13} color="#374151" />}
                  <Text className="text-xs font-semibold text-neutral-700">{w.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {folders === null ? (
        <ActivityIndicator color="#0F1F33" />
      ) : folders.length === 0 ? (
        <EmptyState icon="folder-outline" iconColor="#9CA3AF" title="No folders yet" subtitle="Tap New folder to add a department." />
      ) : (
        folders.map((f) => (
          <WorkerFolderCard key={f.id} folder={f} marks={marks} savingIds={savingIds} onMark={(id, s) => void mark(id, s)} manage onChanged={load} defaultOpen={false} />
        ))
      )}
    </ScrollView>
    </KeyboardAvoider>
  );
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
