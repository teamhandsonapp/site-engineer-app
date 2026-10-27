import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchPendingEditRequests, reviewEditRequest, type DprEditRequest } from '../../lib/dprEditRequests';
import { formatDateLabel, formatDateTimeLabel } from '../../lib/formatTime';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

// Admin's review queue for the DPR lock's own "Contact Admin" flow — a
// site engineer whose today's DPR is locked (dpr_entries.submitted_at set)
// requests it back here; Approve lifts the lock for that exact (task, day)
// permanently (see requestDprEditAccess/hasApprovedEditGrant's own MVP
// scope note — no re-locking, no single-use consumption). Admin-only
// (DrawerContent.tsx's ADMIN_ONLY_ROUTES).
export default function DprEditRequestsScreen() {
  const { state } = useAuth();
  const { selectedProjectId } = useProject();
  const isAdmin = state.status === 'signed-in' && state.profile.role === 'admin';

  const [requests, setRequests] = useState<DprEditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProjectId) {
      setRequests([]);
      return;
    }
    try {
      setError(null);
      setRequests(await fetchPendingEditRequests(selectedProjectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedProjectId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleReview(request: DprEditRequest, status: 'approved' | 'denied') {
    if (state.status !== 'signed-in') return;
    setActingOnId(request.id);
    try {
      await reviewEditRequest(request.id, status, state.profile.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingOnId(null);
    }
  }

  if (state.status !== 'signed-in' || !isAdmin) {
    return <Redirect href="/home" />;
  }

  return (
    <View className="flex-1 bg-neutral-50">
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="px-4 pt-4 pb-10"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
        >
          {error && (
            <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-4">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          )}

          {!selectedProjectId ? (
            <EmptyState icon="lock-open-outline" iconColor="#9CA3AF" title="No project selected" subtitle="Pick a project from Home to see its edit requests." />
          ) : requests.length === 0 ? (
            <EmptyState icon="checkmark-done-outline" iconColor="#9CA3AF" title="Nothing pending" subtitle="No open DPR edit requests for this project." />
          ) : (
            requests.map((r) => (
              <Card key={r.id} className="mb-3">
                <Text className="text-2xs text-neutral-400 mb-0.5">{r.requestedByName} · {formatDateTimeLabel(new Date(r.createdAtISO))}</Text>
                <Text className="text-sm font-bold text-neutral-900 mb-1">{r.taskCode} — {r.taskName}</Text>
                <Text className="text-xs text-neutral-500 mb-2">DPR date: {formatDateLabel(new Date(`${r.reportDate}T00:00:00Z`))}</Text>
                {r.message && <Text className="text-xs text-neutral-700 mb-3" numberOfLines={4}>{r.message}</Text>}

                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => handleReview(r, 'denied')}
                    disabled={actingOnId === r.id}
                    className="flex-1 items-center py-2 rounded-lg border border-neutral-200"
                    style={{ opacity: actingOnId === r.id ? 0.6 : 1 }}
                  >
                    <Text className="text-xs font-bold text-neutral-500">Deny</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleReview(r, 'approved')}
                    disabled={actingOnId === r.id}
                    className="flex-1 flex-row items-center justify-center gap-1.5 py-2 rounded-lg bg-brand-navy"
                    style={{ opacity: actingOnId === r.id ? 0.6 : 1 }}
                  >
                    {actingOnId === r.id && <ActivityIndicator size="small" color="#fff" />}
                    <Text className="text-xs font-bold text-white">Approve</Text>
                  </Pressable>
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}
