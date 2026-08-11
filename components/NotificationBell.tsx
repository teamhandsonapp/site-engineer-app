import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { appRoleFor, useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchUnresolvedSiteIssues } from '../lib/siteIssues';
import { fetchUnresolvedGeofenceAlerts } from '../lib/geofenceAlerts';
import { fetchUnresolvedRestrictedZoneAlerts } from '../lib/restrictedZoneAlerts';
import { fetchUnresolvedLocationDisabledAlerts } from '../lib/locationDisabledAlerts';
import { fetchUnresolvedAccountLockouts } from '../lib/accountLockouts';
import { EmptyState } from './ui/EmptyState';

// Re-scoped to ONLY the live Critical Alerts pipeline (site issues, geofence
// exits, restricted-zone entries, location-disabled episodes) — by explicit
// product decision. This previously also merged in fetchUpcomingTasks()/
// fetchAllPendingClientAlerts() (client dependency approvals), but that
// surfaced hundreds of unrelated pending-approval items here, drowning out
// the real-time alerts this bell now exists to surface. That upcoming-
// tasks/client-alerts feature itself is untouched (lib/tasks/upcomingTasks.ts,
// lib/dependencyAlerts.ts) — only this bell's own rendering of it was removed.
//
// ---- Module-level shared singleton, not per-instance state ----
// This bell is rendered via the Drawer's shared `headerRight` (see
// app/(authenticated)/_layout.tsx), and expo-router/React Navigation gives
// EVERY visited drawer screen its own permanently-mounted Header, each of
// which calls headerRight itself — confirmed against expo-router's own
// source (DrawerView.js's `loaded` route list is append-only, never
// evicted). So visiting N of this app's screens in one session previously
// mounted N independent NotificationBell instances at once, each running
// its own 4-query fetch AND its own Supabase Realtime channel, none of
// which ever got cleaned up (the screens never unmount). A single new
// alert then triggered up to N parallel re-fetches instead of one, and left
// N idle WebSocket channels open for the rest of the session. Rather than
// restructure how the Drawer renders headers (a much bigger, riskier
// change touching every screen's header), this keeps exactly ONE fetch
// cycle and ONE realtime channel alive regardless of how many
// NotificationBell instances React has mounted — every instance just
// subscribes to the same shared state.
interface SharedCounts {
  siteIssueCount: number;
  geofenceCount: number;
  zoneCount: number;
  locationOffCount: number;
  lockoutCount: number;
  loading: boolean;
  error: string | null;
}

const INITIAL_SHARED_STATE: SharedCounts = {
  siteIssueCount: 0,
  geofenceCount: 0,
  zoneCount: 0,
  locationOffCount: 0,
  lockoutCount: 0,
  loading: true,
  error: null,
};

let sharedState: SharedCounts = INITIAL_SHARED_STATE;
const listeners = new Set<(s: SharedCounts) => void>();
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

function publish(next: SharedCounts) {
  sharedState = next;
  listeners.forEach((listener) => listener(sharedState));
}

async function loadSharedCounts(): Promise<void> {
  try {
    const [s, g, z, l, k] = await Promise.all([
      fetchUnresolvedSiteIssues(),
      fetchUnresolvedGeofenceAlerts(),
      fetchUnresolvedRestrictedZoneAlerts(),
      fetchUnresolvedLocationDisabledAlerts(),
      // account_lockouts is admin/manager-only via RLS — always [] for a
      // field role, same "let RLS do the real narrowing" as elsewhere.
      fetchUnresolvedAccountLockouts(),
    ]);
    publish({
      siteIssueCount: s.length,
      geofenceCount: g.length,
      zoneCount: z.length,
      locationOffCount: l.length,
      lockoutCount: k.length,
      loading: false,
      error: null,
    });
  } catch (err) {
    publish({ ...sharedState, loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// Subscribes one component instance to the shared counts, lazily starting
// the fetch cycle + Realtime channel on the FIRST subscriber and tearing
// both down on the LAST one leaving — a plain reference-counted singleton,
// same shape as any shared-resource pub-sub. restricted_zone_alerts is
// already in the supabase_realtime publication (confirmed directly against
// the DB); geofence_alerts/site_issues are not, so only this table is
// subscribed.
function subscribeToCounts(listener: (s: SharedCounts) => void): () => void {
  listeners.add(listener);
  listener(sharedState);

  if (listeners.size === 1) {
    loadSharedCounts();
    realtimeChannel = supabase
      .channel(`notification-bell-zone-live-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'restricted_zone_alerts' }, () => {
        loadSharedCounts();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'account_lockouts' }, () => {
        loadSharedCounts();
      })
      .subscribe();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
      sharedState = INITIAL_SHARED_STATE;
    }
  };
}

export function NotificationBell() {
  const { state } = useAuth();
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) === 'staff';

  const [counts, setCounts] = useState<SharedCounts>(sharedState);
  const [refreshing, setRefreshing] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isStaff) return;
    return subscribeToCounts(setCounts);
  }, [isStaff]);

  // The bell itself renders nothing for a client — this whole feed is
  // staff-only critical-alert data.
  if (!isStaff) return null;

  async function onRefresh() {
    setRefreshing(true);
    await loadSharedCounts();
    setRefreshing(false);
  }

  const { siteIssueCount, geofenceCount, zoneCount, locationOffCount, lockoutCount, loading, error } = counts;
  const totalCount = siteIssueCount + geofenceCount + zoneCount + locationOffCount + lockoutCount;

  return (
    <>
      <Pressable onPress={() => setVisible(true)} hitSlop={10} className="mr-4">
        <View>
          <Ionicons name="notifications-outline" size={22} color="#fff" />
          {totalCount > 0 && (
            <View className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-600 items-center justify-center">
              <Text className="text-2xs font-bold text-white">{totalCount > 99 ? '99+' : totalCount}</Text>
            </View>
          )}
        </View>
      </Pressable>

      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVisible(false)}>
        <View className="flex-1 bg-neutral-50">
          <View className="flex-row items-center justify-between px-5 pt-5 pb-3 bg-white border-b border-neutral-100">
            <View>
              <Text className="text-lg font-semibold text-neutral-900">Critical Alerts</Text>
              <Text className="text-sm text-neutral-400 mt-0.5">
                {zoneCount} restricted zone{zoneCount === 1 ? '' : 's'} · {geofenceCount} location alert{geofenceCount === 1 ? '' : 's'} · {siteIssueCount} site issue{siteIssueCount === 1 ? '' : 's'} · {locationOffCount} location off
                {lockoutCount > 0 ? ` · ${lockoutCount} locked account${lockoutCount === 1 ? '' : 's'}` : ''}
              </Text>
            </View>
            <Pressable onPress={() => setVisible(false)} hitSlop={10}>
              <Ionicons name="close" size={24} color="#111" />
            </Pressable>
          </View>

          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color="#0F1F33" />
            </View>
          ) : error ? (
            <View className="flex-1 items-center justify-center px-6">
              <Text className="text-sm text-red-600 text-center mb-3">Couldn&apos;t load notifications: {error}</Text>
              <Pressable
                onPress={() => loadSharedCounts()}
                className="px-4 py-2 rounded-lg bg-white border border-red-200"
              >
                <Text className="text-xs font-semibold text-red-600">Retry</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              contentContainerClassName="px-4 pt-4 pb-8 flex-grow"
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
            >
              {totalCount === 0 ? (
                <EmptyState
                  title="Nothing critical right now"
                  subtitle="No site issues or location alerts have been reported."
                />
              ) : (
                <Pressable
                  onPress={() => { setVisible(false); router.push('/critical-alerts'); }}
                  className="flex-row items-center justify-between p-4 rounded-2xl"
                  style={{ backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: '#FECACA' }}
                >
                  <View className="flex-row items-center gap-2.5">
                    <Ionicons name="alert-circle" size={20} color="#DC2626" />
                    <Text className="text-lg font-bold text-status-urgent">
                      View Critical Alerts ({totalCount})
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#DC2626" />
                </Pressable>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
    </>
  );
}
