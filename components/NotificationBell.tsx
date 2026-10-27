import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchUnresolvedSiteIssues } from '../lib/siteIssues';
import { fetchUnresolvedGeofenceAlerts } from '../lib/geofenceAlerts';
import { fetchUnresolvedRestrictedZoneAlerts } from '../lib/restrictedZoneAlerts';
import { fetchUnresolvedLocationDisabledAlerts } from '../lib/locationDisabledAlerts';
import { fetchUnresolvedAccountLockouts } from '../lib/accountLockouts';

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
export interface SharedCounts {
  siteIssueCount: number;
  geofenceCount: number;
  zoneCount: number;
  locationOffCount: number;
  lockoutCount: number;
  loading: boolean;
  error: string | null;
}

// Exported so App Home's own "Notifications" quick-link badge can show the
// exact same total this bell shows, without starting a second independent
// fetch cycle + Realtime channel — see subscribeToCounts below for why that
// matters (every existing subscriber, bell or otherwise, shares the one).
export function totalUnresolvedCount(counts: SharedCounts): number {
  return counts.siteIssueCount + counts.geofenceCount + counts.zoneCount + counts.locationOffCount + counts.lockoutCount;
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
export function subscribeToCounts(listener: (s: SharedCounts) => void): () => void {
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

// Tapping the bell used to open its OWN small popup (a "Critical Alerts"
// count summary + a single "View All Notifications" button leading to a
// second screen) — a two-step detour to see anything. Now it navigates
// straight to the real destination (app/(authenticated)/notifications.tsx),
// which is itself organized into the 7 category tabs. The badge count here
// is untouched/still real (the same 5-source shared-counts pipeline as
// before) — only the notifications screen's own CONTENT is dummy-data-only
// for this pass (see notifications.tsx's own comment), so the badge number
// and what you see after tapping won't match for now; that's expected
// during this review pass, not a bug.
//
// Admin/manager-only, matching notifications.tsx's own gate — that screen
// is a team-wide/admin-perspective view, not something a site_engineer
// should reach. A site_engineer still has their own real-time critical
// alerts via the separate Critical Alerts drawer item; this bell isn't
// their only path to that.
export function NotificationBell() {
  const { state } = useAuth();
  const isAdminOrManager =
    state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');

  const [counts, setCounts] = useState<SharedCounts>(sharedState);

  useEffect(() => {
    if (!isAdminOrManager) return;
    return subscribeToCounts(setCounts);
  }, [isAdminOrManager]);

  // The bell itself renders nothing for a non-admin/manager account.
  if (!isAdminOrManager) return null;

  const totalCount = totalUnresolvedCount(counts);

  return (
    <Pressable onPress={() => router.push('/notifications')} hitSlop={10} className="mr-4">
      <View>
        <Ionicons name="notifications-outline" size={22} color="#fff" />
        {totalCount > 0 && (
          <View className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-600 items-center justify-center">
            <Text className="text-2xs font-bold text-white">{totalCount > 99 ? '99+' : totalCount}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}
