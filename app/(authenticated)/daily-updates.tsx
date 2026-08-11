import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DAILY_UPDATE_SLOTS,
  SLOT_LABELS,
  fetchMyDailyUpdates,
  fetchProjectDailyUpdates,
  insertDailyUpdatePhoto,
  isSlotAvailable,
  submitDailyUpdate,
  todayDateString,
  type DailyUpdate,
  type DailyUpdateInput,
  type DailyUpdateSlot,
} from '../../lib/dailyUpdates';
import { uploadDprPhoto } from '../../lib/dprPhotoUpload';
import { DailyUpdateFormModal, type PickedPhoto } from '../../components/DailyUpdateFormModal';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { appRoleFor, isFieldRole, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';

function dateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function UpdateRow({ update }: { update: DailyUpdate }) {
  return (
    <Card accentColor="#1C3358" className="mb-2.5">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-sm font-bold text-neutral-900">{update.workType}</Text>
        <Text className="text-xs text-neutral-400">{dateLabel(update.reportDate)}</Text>
      </View>
      <View className="flex-row items-center gap-1.5 mb-0.5">
        {update.submittedByName && <Text className="text-xs font-semibold text-neutral-500">{update.submittedByName}</Text>}
        {update.slot && (
          <View className="rounded-full bg-brand-navy/8 px-2 py-0.5">
            <Text className="text-2xs font-bold text-brand-navy">{SLOT_LABELS[update.slot]}</Text>
          </View>
        )}
      </View>
      <Text className="text-sm text-neutral-600" numberOfLines={3}>{update.workDescription}</Text>
      {(update.sftCompleted != null || update.workforceCount != null || update.photoCount > 0) && (
        <View className="flex-row items-center flex-wrap gap-x-1.5 mt-1.5">
          {update.sftCompleted != null && <Text className="text-xs text-neutral-400">{update.sftCompleted} sft</Text>}
          {update.workforceCount != null && (
            <Text className="text-xs text-neutral-400">
              {update.sftCompleted != null ? '· ' : ''}
              {update.workforceCount} workers
            </Text>
          )}
          {update.photoCount > 0 && (
            <View className="flex-row items-center gap-1">
              {(update.sftCompleted != null || update.workforceCount != null) && <Text className="text-xs text-neutral-400">·</Text>}
              <Ionicons name="image-outline" size={12} color="#a3a3a3" />
              <Text className="text-xs text-neutral-400">{update.photoCount}</Text>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

// Every submission is dated today (see submitDailyUpdate), with up to
// MAX_PHOTOS photos attached (Take Photo / Choose from Library — see
// DailyUpdateFormModal). Photos upload before the report itself is
// submitted (handleSave below) — if any photo upload fails, nothing is
// saved at all, so a retry never produces a duplicate text-only report.
// Shows the caller's own past updates for context, most recent first — for
// a field role, who is the one actually submitting. Bug fix: admin/manager
// are also "staff" (appRoleFor) and could always reach this screen, but
// fetchMyDailyUpdates(state.profile.id) meant they were always looking at
// THEIR OWN reports, which don't exist — every site engineer's real
// submissions were invisible to them, not because of a permissions gap
// (RLS already allows any staff role to read every row) but because
// nothing ever asked for anyone else's data. Field roles keep the exact
// same self-view + submit flow as before; admin/manager instead get a
// read-only, project-wide review list via fetchProjectDailyUpdates.
export default function DailyUpdatesScreen() {
  const { state } = useAuth();
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) === 'staff';
  const isSubmitter = state.status === 'signed-in' && isFieldRole(state.profile.role);
  const { selectedProjectId } = useProject();

  const [updates, setUpdates] = useState<DailyUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openSlot, setOpenSlot] = useState<DailyUpdateSlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Today's three slots, each matched against the caller's own updates
  // (not filtered again by isSubmitter — this section only ever renders
  // for the field role anyway, see the JSX below). A slot counts as "done"
  // purely by a matching report_date + slot existing, no separate status
  // column to go stale.
  const today = todayDateString();
  const todaySlotStatus = DAILY_UPDATE_SLOTS.map((s) => ({
    ...s,
    update: updates.find((u) => u.reportDate === today && u.slot === s.id) ?? null,
    available: isSlotAvailable(s),
  }));

  // Same "re-evaluate a time-boundary gate while the screen sits open"
  // ticker as attendance.tsx's own Bug 3.4 fix — without this, a slot that
  // crosses into availability (e.g. sitting on this screen right as 3:00 PM
  // arrives) would stay showing "Available at 3:00 PM" until some
  // unrelated state change forced a re-render.
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinuteTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (state.status !== 'signed-in') return;
    try {
      setError(null);
      setUpdates(
        isSubmitter
          ? await fetchMyDailyUpdates(state.profile.id)
          : await fetchProjectDailyUpdates(selectedProjectId)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [state, isSubmitter, selectedProjectId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

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

  async function handleSave(input: DailyUpdateInput, photos: PickedPhoto[]) {
    if (state.status !== 'signed-in' || !openSlot) return;

    // Photos upload FIRST, before the report row even exists — if any one
    // fails, nothing is saved at all (matches the "simple: submission
    // fails, retry" approach chosen over a full offline queue), rather
    // than leaving an orphaned text-only report a retry would duplicate.
    const storagePaths: string[] = [];
    for (const photo of photos) {
      storagePaths.push(await uploadDprPhoto(photo.base64, photo.contentType));
    }

    const reportId = await submitDailyUpdate(state.profile.id, selectedProjectId, openSlot, input);
    for (const storagePath of storagePaths) {
      await insertDailyUpdatePhoto(reportId, storagePath);
    }
    await load();
  }

  return (
    <View className="flex-1 bg-neutral-50">
      {isSubmitter && (
        <View className="px-4 pt-4 pb-2 gap-2">
          {todaySlotStatus.map((s) => {
            const done = s.update != null;
            const locked = !done && !s.available;
            return (
              <Pressable
                key={s.id}
                onPress={() => !done && s.available && setOpenSlot(s.id)}
                disabled={done || !s.available}
                className="flex-row items-center justify-between rounded-2xl px-4 py-3"
                style={{
                  backgroundColor: done ? '#F0FDF4' : locked ? '#F3F4F6' : '#0F1F33',
                  borderWidth: done ? 1 : 0,
                  borderColor: '#BBF7D0',
                }}
              >
                <View className="flex-row items-center gap-2.5">
                  <Ionicons
                    name={done ? 'checkmark-circle' : locked ? 'lock-closed-outline' : 'time-outline'}
                    size={18}
                    color={done ? '#16A34A' : locked ? '#9CA3AF' : '#F0A227'}
                  />
                  <Text className="text-sm font-bold" style={{ color: done ? '#166534' : locked ? '#6B7280' : '#fff' }}>
                    {s.label} Update
                  </Text>
                </View>
                <Text className="text-xs font-semibold" style={{ color: done ? '#16A34A' : locked ? '#9CA3AF' : 'rgba(255,255,255,0.65)' }}>
                  {done ? 'Submitted' : locked ? `Available at ${s.label}` : 'Tap to submit'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="px-4 pt-2 pb-8 flex-grow"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
        >
          {error && (
            <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-4">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          )}

          {updates.length === 0 ? (
            <EmptyState
              title="No updates yet"
              subtitle={isSubmitter ? 'Tap one of the slots above to submit today\'s progress.' : 'No site engineers have submitted updates yet.'}
            />
          ) : (
            updates.map((u) => <UpdateRow key={u.id} update={u} />)
          )}
        </ScrollView>
      )}

      {openSlot && <DailyUpdateFormModal slot={openSlot} onClose={() => setOpenSlot(null)} onSave={handleSave} />}
    </View>
  );
}
