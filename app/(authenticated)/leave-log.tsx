import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import {
  fetchEngineersForFilter,
  fetchLeaveLog,
  LEAVE_REASON_PRESETS,
  leaveReasonLabelFor,
  type EngineerOption,
  type LeaveLogEntry,
  type LeaveLogFilters,
  type LeaveReasonPresetValue,
} from '../../lib/leaveEvents';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatDateLabel, formatTime12h } from '../../lib/formatTime';

// New admin tab — a rollup of every "Leave" event across every engineer and
// project, so admin doesn't have to open each engineer's own day-timeline
// detail one at a time just to see who left, when, and why. Reuses
// lib/leaveEvents.ts's fetchLeaveLog (a VIEW over the existing leave_events
// table — no new write path, no duplicated data).

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${formatDateLabel(d).split(' ').slice(1).join(' ')}`; // "9 Aug" from "Sun 9 Aug"
}

function LeaveLogRow({ entry }: { entry: LeaveLogEntry }) {
  return (
    <Card className="mb-2.5">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-sm font-bold text-neutral-900">{entry.userName ?? 'Unknown engineer'}</Text>
        <Text className="text-xs text-neutral-400">{shortDate(entry.leftAtISO)}, {formatTime12h(new Date(entry.leftAtISO))}</Text>
      </View>
      {entry.projectName && (
        <Text className="text-xs text-neutral-500 mb-1.5">{entry.projectName}</Text>
      )}
      <Text className="text-sm font-semibold text-brand-navy mb-0.5">{leaveReasonLabelFor(entry.reasonPreset, null)}</Text>
      {entry.reasonNote && <Text className="text-xs text-neutral-500 italic">&quot;{entry.reasonNote}&quot;</Text>}
    </Card>
  );
}

// A single-column pressable list, reused for both the engineer and reason
// pickers inside the filter modal — same vertical-list-of-options pattern
// attendance.tsx's own LeaveReasonSheet already uses, not a native
// <Picker>.
function OptionList<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T | null; label: string }[];
  selected: T | null;
  onSelect: (value: T | null) => void;
}) {
  return (
    <View className="gap-1.5">
      {options.map((opt) => {
        const active = opt.value === selected;
        return (
          <Pressable
            key={opt.value ?? '__all__'}
            onPress={() => onSelect(opt.value)}
            className={`px-3 py-2.5 rounded-lg ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
          >
            <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mb-4">
      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">{title}</Text>
      {children}
    </View>
  );
}

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  engineers: EngineerOption[];
  projects: { id: string; name: string }[];
  filters: LeaveLogFilters;
  onApply: (filters: LeaveLogFilters) => void;
}

function FilterModal({ visible, onClose, engineers, projects, filters, onApply }: FilterModalProps) {
  const [engineerSearch, setEngineerSearch] = useState('');
  const [draft, setDraft] = useState<LeaveLogFilters>(filters);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      setDraft(filters);
      setEngineerSearch('');
    }
  }, [visible, filters]);

  const filteredEngineers = engineers.filter((e) => e.fullName.toLowerCase().includes(engineerSearch.toLowerCase()));

  function handleClearAll() {
    setDraft({});
  }

  function handleApply() {
    onApply(draft);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-neutral-50">
        <View className="flex-row items-center justify-between px-5 pt-5 pb-3 bg-white border-b border-neutral-100">
          <Text className="text-lg font-semibold text-neutral-900">Filters</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color="#111" />
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="px-4 pt-4 pb-8">
          <FilterSection title="Engineer">
            <TextInput
              value={engineerSearch}
              onChangeText={setEngineerSearch}
              placeholder="Search by name"
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-2"
            />
            <OptionList
              options={[{ value: null, label: 'All engineers' }, ...filteredEngineers.map((e) => ({ value: e.id, label: e.fullName }))]}
              selected={draft.userId ?? null}
              onSelect={(value) => setDraft((d) => ({ ...d, userId: value }))}
            />
          </FilterSection>

          <FilterSection title="Project">
            <OptionList
              options={[{ value: null, label: 'All projects' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              selected={draft.projectId ?? null}
              onSelect={(value) => setDraft((d) => ({ ...d, projectId: value }))}
            />
          </FilterSection>

          <FilterSection title="Reason">
            <OptionList
              options={[{ value: null, label: 'All reasons' }, ...LEAVE_REASON_PRESETS.map((r) => ({ value: r.value as LeaveReasonPresetValue, label: r.label }))]}
              selected={draft.reasonPreset ?? null}
              onSelect={(value) => setDraft((d) => ({ ...d, reasonPreset: value }))}
            />
          </FilterSection>

          <FilterSection title="Date range">
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setShowFromPicker(true)}
                className="flex-1 px-3 py-2.5 rounded-lg bg-neutral-50 border border-neutral-200"
              >
                <Text className="text-2xs text-neutral-400 mb-0.5">From</Text>
                <Text className="text-sm font-medium text-neutral-800">
                  {draft.fromISO ? formatDateLabel(new Date(draft.fromISO)) : 'Any'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setShowToPicker(true)}
                className="flex-1 px-3 py-2.5 rounded-lg bg-neutral-50 border border-neutral-200"
              >
                <Text className="text-2xs text-neutral-400 mb-0.5">To</Text>
                <Text className="text-sm font-medium text-neutral-800">
                  {draft.toISO ? formatDateLabel(new Date(draft.toISO)) : 'Any'}
                </Text>
              </Pressable>
            </View>
            {(draft.fromISO || draft.toISO) && (
              <Pressable onPress={() => setDraft((d) => ({ ...d, fromISO: null, toISO: null }))} className="mt-2 self-start">
                <Text className="text-xs font-semibold text-brand-navy">Clear date range</Text>
              </Pressable>
            )}
            {showFromPicker && (
              <DateTimePicker
                value={draft.fromISO ? new Date(draft.fromISO) : new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_event, date) => {
                  setShowFromPicker(Platform.OS === 'ios');
                  if (date) {
                    const start = new Date(date);
                    start.setHours(0, 0, 0, 0);
                    setDraft((d) => ({ ...d, fromISO: start.toISOString() }));
                  }
                }}
              />
            )}
            {showToPicker && (
              <DateTimePicker
                value={draft.toISO ? new Date(draft.toISO) : new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(_event, date) => {
                  setShowToPicker(Platform.OS === 'ios');
                  if (date) {
                    // Exclusive upper bound — the day AFTER the picked date,
                    // so picking "Aug 9" as the To date still includes all
                    // of Aug 9 itself, matching fetchLeaveLog's own
                    // `.lt('left_at', toISO)` semantics.
                    const end = new Date(date);
                    end.setHours(0, 0, 0, 0);
                    end.setDate(end.getDate() + 1);
                    setDraft((d) => ({ ...d, toISO: end.toISOString() }));
                  }
                }}
              />
            )}
          </FilterSection>
        </ScrollView>

        <View className="flex-row gap-2 px-4 py-3 border-t border-neutral-100 bg-white">
          <Pressable onPress={handleClearAll} className="flex-1 items-center py-3 rounded-xl bg-neutral-100">
            <Text className="text-sm font-semibold text-neutral-600">Clear all</Text>
          </Pressable>
          <Pressable onPress={handleApply} className="flex-1 items-center py-3 rounded-xl bg-brand-navy">
            <Text className="text-sm font-bold text-white">Apply</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function activeFilterCount(filters: LeaveLogFilters): number {
  let count = 0;
  if (filters.userId) count++;
  if (filters.projectId) count++;
  if (filters.reasonPreset) count++;
  if (filters.fromISO || filters.toISO) count++;
  return count;
}

export default function LeaveLogScreen() {
  const { state } = useAuth();
  const isAdminOrManager = state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) === 'staff';
  const { projects } = useProject();

  const [entries, setEntries] = useState<LeaveLogEntry[]>([]);
  const [engineers, setEngineers] = useState<EngineerOption[]>([]);
  const [filters, setFilters] = useState<LeaveLogFilters>({});
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdminOrManager) return;
    try {
      setError(null);
      setEntries(await fetchLeaveLog(filters));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isAdminOrManager, filters]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (!isAdminOrManager) return;
    fetchEngineersForFilter()
      .then(setEngineers)
      .catch(() => {});
  }, [isAdminOrManager]);

  // Live updates — same pattern as critical-alerts.tsx's own realtime
  // channel (random suffix per mount, since a fixed topic name across two
  // concurrently-mounted instances of this screen crashes — see that
  // file's own comment on the exact failure mode this avoids).
  const channelSuffixRef = useRef(Math.random().toString(36).slice(2));
  useEffect(() => {
    if (!isAdminOrManager) return;
    const channel = supabase
      .channel(`leave-log-live-${channelSuffixRef.current}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leave_events' }, () => {
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdminOrManager, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!isStaff || state.status !== 'signed-in') {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  if (!isAdminOrManager) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Admin/manager only</Text>
      </View>
    );
  }

  const filterCount = activeFilterCount(filters);

  return (
    <View className="flex-1 bg-neutral-50">
      <View className="px-4 pt-4 pb-3 bg-white border-b border-neutral-100 flex-row items-center justify-between">
        <View>
          <Text className="text-sm text-neutral-400">
            {entries.length} Leave event{entries.length === 1 ? '' : 's'}
          </Text>
        </View>
        <Pressable
          onPress={() => setFilterModalVisible(true)}
          className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-lg bg-neutral-100"
        >
          <Ionicons name="filter" size={14} color="#0F1F33" />
          <Text className="text-xs font-bold text-brand-navy">Filters{filterCount > 0 ? ` (${filterCount})` : ''}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-red-600 text-center mb-3">Couldn&apos;t load the leave log: {error}</Text>
          <Pressable onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }} className="px-4 py-2 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <LeaveLogRow entry={item} />}
          contentContainerClassName="px-4 pt-4 pb-8 flex-grow"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
          ListEmptyComponent={
            <EmptyState
              icon="airplane-outline"
              iconColor="#9CA3AF"
              title="No Leave events"
              subtitle={filterCount > 0 ? 'Try adjusting or clearing your filters.' : 'Nobody has logged a Leave yet.'}
            />
          }
        />
      )}

      <FilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        engineers={engineers}
        projects={projects}
        filters={filters}
        onApply={setFilters}
      />
    </View>
  );
}
