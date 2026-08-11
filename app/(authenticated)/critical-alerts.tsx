import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { fetchUnresolvedSiteIssues, resolveSiteIssue, type SiteIssue } from '../../lib/siteIssues';
import { fetchUnresolvedGeofenceAlerts, resolveGeofenceAlert, type GeofenceAlert } from '../../lib/geofenceAlerts';
import {
  fetchUnresolvedRestrictedZoneAlerts,
  resolveRestrictedZoneAlert,
  type RestrictedZoneAlert,
} from '../../lib/restrictedZoneAlerts';
import {
  fetchUnresolvedLocationDisabledAlerts,
  resolveLocationDisabledAlert,
  type LocationDisabledAlert,
} from '../../lib/locationDisabledAlerts';
import {
  fetchUnresolvedAccountLockouts,
  LOCKOUT_REASON_LABEL,
  reactivateAccountLockout,
  type AccountLockout,
} from '../../lib/accountLockouts';
import { fetchRecentFieldLoginEvents, type FieldLoginEvent } from '../../lib/fieldLoginEvents';
import { fireLocalAlertNotification } from '../../lib/localAlertNotification';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';

// Site Issues call for the literal "Date and time reported" rather than a
// relative "3h ago" granularity — an urgent, individually-reported problem
// reads as more serious with an exact timestamp than a vague relative one.
//
// Computed by hand with plain arithmetic + UTC getters — NOT
// toLocaleDateString/toLocaleTimeString/Intl with a timeZone option, even
// though that looks like the obvious way to force IST. lib/formatTime.ts's
// own header comment documents exactly why that's unsafe on this stack:
// Hermes (React Native's JS engine) can ship without full ICU tzdata, and
// when it does, Intl.DateTimeFormat silently falls back to UTC instead of
// throwing — confirmed live there ("3:42 PM IST rendered as 10:12 am").
// Adding +5:30 directly to the UTC timestamp and reading it back with
// getUTC*() sidesteps Intl entirely, so this can't silently fall back to
// the wrong zone regardless of ICU data or the device's own system
// timezone setting.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function reportedAtLabel(iso: string): string {
  const ist = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  let hours = ist.getUTCHours();
  const minutes = ist.getUTCMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const date = `${MONTH_NAMES_SHORT[ist.getUTCMonth()]} ${ist.getUTCDate()}, ${ist.getUTCFullYear()}`;
  const time = `${hours}:${String(minutes).padStart(2, '0')} ${period}`;
  return `${date} · ${time}`;
}

// Periodic attention-grabbing shake rather than continuous motion — a short
// wobble, then a hold, then repeat — so it reads as "this needs a look" and
// not as a distracting nonstop animation running the whole time the screen
// is open.
function ShakingWarningIcon() {
  const rotate = useSharedValue(0);

  useEffect(() => {
    rotate.value = withRepeat(
      withSequence(
        withTiming(-10, { duration: 80 }),
        withTiming(10, { duration: 80 }),
        withTiming(-8, { duration: 80 }),
        withTiming(8, { duration: 80 }),
        withTiming(-4, { duration: 80 }),
        withTiming(0, { duration: 80 }),
        withTiming(0, { duration: 1600 })
      ),
      -1
    );
  }, [rotate]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotate.value}deg` }] }));

  return (
    <Animated.View style={style}>
      <Ionicons name="warning" size={30} color="#DC2626" />
    </Animated.View>
  );
}

// A serious problem a site engineer reported directly, live from the site
// (see lib/siteIssues.ts). Styled to read as a literal warning: a solid
// red-tinted fill and full red border, a bold "SITE ISSUE" tag, and a solid
// (not tinted) Resolve button. No reporting flow yet by deliberate scope
// decision, so this only ever reads + resolves existing rows.
function SiteIssueRow({
  issue,
  resolving,
  onResolve,
}: {
  issue: SiteIssue;
  resolving: boolean;
  onResolve: (issueId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <View
      className="rounded-2xl p-4 mb-3"
      style={{ backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: '#FECACA' }}
    >
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-row items-center gap-2.5 flex-1">
          <ShakingWarningIcon />
          <Text className="text-md font-extrabold text-neutral-900 flex-1">{issue.title}</Text>
        </View>
        <View className="px-2 py-0.5 rounded-full bg-status-urgent flex-shrink-0">
          <Text className="text-2xs font-extrabold text-white tracking-wide">SITE ISSUE</Text>
        </View>
      </View>

      <Text className="text-sm text-neutral-700 mb-2.5">{issue.description}</Text>

      <View className="flex-row items-center gap-1.5 mb-1">
        <Ionicons name="person-circle-outline" size={14} color="#7F1D1D" />
        <Text className="text-xs font-semibold text-red-900">{issue.reportedByName ?? 'A site engineer'}</Text>
      </View>
      <View className="flex-row items-center gap-1.5 mb-3">
        <Ionicons name="time-outline" size={14} color="#B91C1C" />
        <Text className="text-xs text-red-700">{reportedAtLabel(issue.reportedAtISO)}</Text>
      </View>

      <Pressable
        onPress={() => setConfirming(true)}
        disabled={resolving}
        className="self-start px-4 py-2 rounded-lg bg-status-urgent"
        style={{ opacity: resolving ? 0.6 : 1 }}
      >
        <Text className="text-xs font-bold text-white">Resolve</Text>
      </Pressable>

      {confirming && (
        <ConfirmDialog
          title="Resolve this site issue?"
          description={`Mark "${issue.title}" as resolved. It will be removed from this list.`}
          confirmLabel="Resolve"
          variant="warning"
          busy={resolving}
          onConfirm={() => onResolve(issue.id)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </View>
  );
}

// "Xh Ym outside" / "12m outside" — from confirmedAt (when the 3-minute
// no-return window elapsed) up to returnedAt if the engineer is back, or
// now if they're still outside, so an unresolved-but-returned alert reads
// as a fixed duration rather than a number that keeps climbing forever.
function durationOutsideLabel(exitAtISO: string, returnedAtISO: string | null): string {
  const end = returnedAtISO ? new Date(returnedAtISO) : new Date();
  const minutesTotal = Math.max(0, Math.round((end.getTime() - new Date(exitAtISO).getTime()) / 60_000));
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return returnedAtISO ? `Outside for ${label}` : `Outside for ${label} (still outside)`;
}

// A confirmed geofence exit (see lib/geofenceAlerts.ts) — system-generated
// from the mobile app's own native geofencing, distinct from a Site Issue a
// site engineer reports themselves. Same red-alert visual language as
// SiteIssueRow (this is equally urgent), tagged "LOCATION ALERT" instead of
// "SITE ISSUE" so admin can tell the two apart at a glance, with a location
// icon instead of the shaking warning icon (nothing here is a live-flagged
// hazard, just a fact about where someone was).
function GeofenceAlertRow({
  alert,
  resolving,
  onResolve,
}: {
  alert: GeofenceAlert;
  resolving: boolean;
  onResolve: (alertId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <View
      className="rounded-2xl p-4 mb-3"
      style={{ backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: '#FECACA' }}
    >
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-row items-center gap-2.5 flex-1">
          <Ionicons name="location" size={26} color="#DC2626" />
          <Text className="text-md font-extrabold text-neutral-900 flex-1">
            {alert.userName ?? 'A site engineer'} left the site boundary
          </Text>
        </View>
        <View className="px-2 py-0.5 rounded-full bg-status-urgent flex-shrink-0">
          <Text className="text-2xs font-extrabold text-white tracking-wide">LOCATION ALERT</Text>
        </View>
      </View>

      <Text className="text-sm text-neutral-700 mb-2.5">{durationOutsideLabel(alert.exitAtISO, alert.returnedAtISO)}</Text>

      <View className="flex-row items-center gap-1.5 mb-1">
        <Ionicons name="exit-outline" size={14} color="#7F1D1D" />
        <Text className="text-xs font-semibold text-red-900">{reportedAtLabel(alert.exitAtISO)}</Text>
      </View>
      {alert.returnedAtISO && (
        <View className="flex-row items-center gap-1.5 mb-3">
          <Ionicons name="checkmark-circle-outline" size={14} color="#16A34A" />
          <Text className="text-xs font-semibold text-green-700">Returned {reportedAtLabel(alert.returnedAtISO)}</Text>
        </View>
      )}

      <Pressable
        onPress={() => setConfirming(true)}
        disabled={resolving}
        className="self-start px-4 py-2 rounded-lg bg-status-urgent mt-2"
        style={{ opacity: resolving ? 0.6 : 1 }}
      >
        <Text className="text-xs font-bold text-white">Resolve</Text>
      </Pressable>

      {confirming && (
        <ConfirmDialog
          title="Resolve this location alert?"
          description="Mark this as acknowledged. It will be removed from this list."
          confirmLabel="Resolve"
          variant="warning"
          busy={resolving}
          onConfirm={() => onResolve(alert.id)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </View>
  );
}

// "Xh Ym inside" / "12m inside" — the mirror image of durationOutsideLabel
// above: from enteredAt up to exitedAt if they've left, or now if they're
// still inside, so an unresolved-but-exited alert reads as a fixed
// duration rather than a number that keeps climbing forever.
function durationInsideLabel(enteredAtISO: string, exitedAtISO: string | null): string {
  const end = exitedAtISO ? new Date(exitedAtISO) : new Date();
  const minutesTotal = Math.max(0, Math.round((end.getTime() - new Date(enteredAtISO).getTime()) / 60_000));
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return exitedAtISO ? `Inside for ${label}` : `Inside for ${label} (still inside)`;
}

// A confirmed restricted-zone ENTRY (see lib/restrictedZoneAlerts.ts) — the
// mirror image of GeofenceAlertRow (that one alerts on LEAVING the site
// boundary; this alerts on ENTERING a zone that was specifically marked
// off-limits). Same red-alert visual language, tagged "RESTRICTED ZONE" to
// tell it apart from a plain site-boundary exit at a glance.
function RestrictedZoneAlertRow({
  alert,
  resolving,
  onResolve,
}: {
  alert: RestrictedZoneAlert;
  resolving: boolean;
  onResolve: (alertId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <View
      className="rounded-2xl p-4 mb-3"
      style={{ backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: '#FECACA' }}
    >
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-row items-center gap-2.5 flex-1">
          <Ionicons name="alert-circle" size={26} color="#DC2626" />
          <Text className="text-md font-extrabold text-neutral-900 flex-1">
            {alert.userName ?? 'A site engineer'} entered {alert.zoneName ?? 'a restricted zone'}
          </Text>
        </View>
        <View className="px-2 py-0.5 rounded-full bg-status-urgent flex-shrink-0">
          <Text className="text-2xs font-extrabold text-white tracking-wide">RESTRICTED ZONE</Text>
        </View>
      </View>

      <Text className="text-sm text-neutral-700 mb-2.5">{durationInsideLabel(alert.enteredAtISO, alert.exitedAtISO)}</Text>

      {/* Bug 3.6 — context only, never a reason to skip rendering this
          alert at all; see restrictedZoneAlerts.ts's own comment on why
          this never suppresses. */}
      {alert.statedLeaveReason && (
        <View className="flex-row items-center gap-1.5 mb-2">
          <Ionicons name="walk-outline" size={14} color="#7F1D1D" />
          <Text className="text-xs text-red-900">Stated reason: {alert.statedLeaveReason}</Text>
        </View>
      )}

      <View className="flex-row items-center gap-1.5 mb-1">
        <Ionicons name="enter-outline" size={14} color="#7F1D1D" />
        <Text className="text-xs font-semibold text-red-900">{reportedAtLabel(alert.enteredAtISO)}</Text>
      </View>
      {alert.exitedAtISO && (
        <View className="flex-row items-center gap-1.5 mb-3">
          <Ionicons name="checkmark-circle-outline" size={14} color="#16A34A" />
          <Text className="text-xs font-semibold text-green-700">Left {reportedAtLabel(alert.exitedAtISO)}</Text>
        </View>
      )}

      <Pressable
        onPress={() => setConfirming(true)}
        disabled={resolving}
        className="self-start px-4 py-2 rounded-lg bg-status-urgent mt-2"
        style={{ opacity: resolving ? 0.6 : 1 }}
      >
        <Text className="text-xs font-bold text-white">Resolve</Text>
      </Pressable>

      {confirming && (
        <ConfirmDialog
          title="Resolve this restricted zone alert?"
          description="Mark this as acknowledged. It will be removed from this list."
          confirmLabel="Resolve"
          variant="warning"
          busy={resolving}
          onConfirm={() => onResolve(alert.id)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </View>
  );
}

const REASON_LABEL: Record<string, string> = {
  permission: 'Location permission turned off',
  services: 'Device location services turned off',
  // Section 5's Case A — permission/services are fine, just no GPS fix for
  // a while (a real dead zone, not a toggle-off) — never locks the account,
  // see gpsLockout.ts.
  no_fix_timeout: 'No GPS signal for a while (weak signal / dead zone)',
};

// One continuous "location gate is blocking this user" episode (Part 2 —
// see lib/locationTracking/useLocationDisabledAlertTracking.ts). Same
// visual language as GeofenceAlertRow/SiteIssueRow (equally urgent — a
// field role who's turned off location can't be tracked at all right now),
// tagged distinctly so admin can tell the three apart at a glance.
function LocationDisabledAlertRow({
  alert,
  resolving,
  onResolve,
}: {
  alert: LocationDisabledAlert;
  resolving: boolean;
  onResolve: (alertId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <View
      className="rounded-2xl p-4 mb-3"
      style={{ backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: '#FECACA' }}
    >
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-row items-center gap-2.5 flex-1">
          <Ionicons name="location-outline" size={26} color="#DC2626" />
          <Text className="text-md font-extrabold text-neutral-900 flex-1">
            {alert.userName ?? 'A site engineer'} can&apos;t be tracked right now
          </Text>
        </View>
        <View className="px-2 py-0.5 rounded-full bg-status-urgent flex-shrink-0">
          <Text className="text-2xs font-extrabold text-white tracking-wide">LOCATION OFF</Text>
        </View>
      </View>

      <Text className="text-sm text-neutral-700 mb-2.5">{REASON_LABEL[alert.reason] ?? alert.reason}</Text>

      <View className="flex-row items-center gap-1.5 mb-1">
        <Ionicons name="close-circle-outline" size={14} color="#7F1D1D" />
        <Text className="text-xs font-semibold text-red-900">{reportedAtLabel(alert.disabledAtISO)}</Text>
      </View>
      {alert.enabledAtISO && (
        <View className="flex-row items-center gap-1.5 mb-3">
          <Ionicons name="checkmark-circle-outline" size={14} color="#16A34A" />
          <Text className="text-xs font-semibold text-green-700">Back on {reportedAtLabel(alert.enabledAtISO)}</Text>
        </View>
      )}

      <Pressable
        onPress={() => setConfirming(true)}
        disabled={resolving}
        className="self-start px-4 py-2 rounded-lg bg-status-urgent mt-2"
        style={{ opacity: resolving ? 0.6 : 1 }}
      >
        <Text className="text-xs font-bold text-white">Resolve</Text>
      </Pressable>

      {confirming && (
        <ConfirmDialog
          title="Resolve this alert?"
          description="Mark this as acknowledged. It will be removed from this list."
          confirmLabel="Resolve"
          variant="warning"
          busy={resolving}
          onConfirm={() => onResolve(alert.id)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </View>
  );
}

const BANNER_LABEL: Record<'zone' | 'lockout' | 'boundary-exit', string> = {
  zone: 'RED ZONE ALERT',
  lockout: 'ACCOUNT LOCKED',
  'boundary-exit': 'BOUNDARY EXIT',
};

// Section 5 — a GPS lockout is a contained state, not an active danger the
// way the four row types above are (the account is already locked out; the
// engineer isn't currently doing anything unsafe) — styled distinctly (blue,
// not red) and with a confirm dialog before the action, since "Reactivate"
// grants access back rather than just acknowledging/dismissing a past
// event.
function AccountLockoutRow({
  lockout,
  reactivating,
  onReactivate,
}: {
  lockout: AccountLockout;
  reactivating: boolean;
  onReactivate: (lockoutId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <View
      className="rounded-2xl p-4 mb-3"
      style={{ backgroundColor: '#EFF6FF', borderWidth: 1.5, borderColor: '#BFDBFE' }}
    >
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-row items-center gap-2.5 flex-1">
          <Ionicons name="lock-closed" size={26} color="#1D4ED8" />
          <Text className="text-md font-extrabold text-neutral-900 flex-1">
            {lockout.userName ?? 'A site engineer'}&apos;s account is locked
          </Text>
        </View>
        <View className="px-2 py-0.5 rounded-full bg-blue-700 flex-shrink-0">
          <Text className="text-2xs font-extrabold text-white tracking-wide">ACCOUNT LOCKED</Text>
        </View>
      </View>

      <Text className="text-sm text-neutral-700 mb-2.5">{LOCKOUT_REASON_LABEL[lockout.reason] ?? lockout.reason}</Text>

      <View className="flex-row items-center gap-1.5 mb-3">
        <Ionicons name="time-outline" size={14} color="#1E40AF" />
        <Text className="text-xs font-semibold text-blue-900">{reportedAtLabel(lockout.lockedAtISO)}</Text>
      </View>

      <Pressable
        onPress={() => setConfirming(true)}
        disabled={reactivating}
        className="self-start px-4 py-2 rounded-lg bg-blue-700 mt-2"
        style={{ opacity: reactivating ? 0.6 : 1 }}
      >
        <Text className="text-xs font-bold text-white">Reactivate account</Text>
      </Pressable>

      {confirming && (
        <ConfirmDialog
          title="Reactivate this account?"
          description={`${lockout.userName ?? 'This engineer'} will be able to log in again. This is logged against your account.`}
          confirmLabel="Reactivate"
          variant="warning"
          busy={reactivating}
          onConfirm={() => onReactivate(lockout.id)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </View>
  );
}

// Deliberately calm/neutral (gray, not red) — this is a routine log entry,
// not something that needs triage, unlike every row type above it.
function RecentLoginRow({ event }: { event: FieldLoginEvent }) {
  return (
    <View className="rounded-xl px-4 py-3 mb-2 bg-white border border-neutral-100">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-sm font-semibold text-neutral-800">{event.userName ?? 'Unknown user'}</Text>
        <Text className="text-xs text-neutral-400">{reportedAtLabel(event.loggedInAtISO)}</Text>
      </View>
      <View className="flex-row items-center flex-wrap gap-x-3">
        {event.deviceModel && (
          <View className="flex-row items-center gap-1">
            <Ionicons name="phone-portrait-outline" size={12} color="#a3a3a3" />
            <Text className="text-xs text-neutral-400">
              {event.deviceModel}
              {event.deviceOs ? ` · ${event.deviceOs}` : ''}
            </Text>
          </View>
        )}
        {event.latitude != null && event.longitude != null && (
          <View className="flex-row items-center gap-1">
            <Ionicons name="location-outline" size={12} color="#a3a3a3" />
            <Text className="text-xs text-neutral-400 font-mono">
              {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// Critical Alerts shows Site Issues (a site engineer's own live problem
// reports) and, as of this pass, Location Alerts (system-generated geofence
// exits — see lib/geofenceAlerts.ts) side by side, both staff-only. Flagged
// Issues / Needs a Response / Behind Schedule / Comments (the pending-
// checklist-derived sections this screen used to also show) were removed
// by deliberate product decision, not merged in here — those are routine/
// awaiting-decision items, a different concept from either feed above.
export default function CriticalAlertsScreen() {
  const { state } = useAuth();
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) === 'staff';
  // Critical Alerts is reachable by field engineers too (they're "staff"),
  // and RLS lets any staff account read restricted_zone_alerts/
  // geofence_alerts (current_app_role() <> 'client') — meaning an engineer
  // with this screen mounted would otherwise get notified about their OWN
  // red-zone-entry/boundary-exit events. These two are system-generated
  // monitoring alerts meant for admin/manager only; gated below. Does NOT
  // apply to account lockouts (already RLS-scoped to admin/manager only, so
  // this check would be redundant there) or to the tracking-degraded
  // reminder (lib/locationTracking/trackingStatus.ts — a completely
  // separate, correctly self-directed notification, deliberately untouched).
  const isAdminOrManager = state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');
  const { selectedProjectId, projects } = useProject();

  const [siteIssues, setSiteIssues] = useState<SiteIssue[]>([]);
  const [geofenceAlerts, setGeofenceAlerts] = useState<GeofenceAlert[]>([]);
  const [restrictedZoneAlerts, setRestrictedZoneAlerts] = useState<RestrictedZoneAlert[]>([]);
  const [locationDisabledAlerts, setLocationDisabledAlerts] = useState<LocationDisabledAlert[]>([]);
  const [accountLockouts, setAccountLockouts] = useState<AccountLockout[]>([]);
  const [recentLogins, setRecentLogins] = useState<FieldLoginEvent[]>([]);
  const [resolvingIssueId, setResolvingIssueId] = useState<string | null>(null);
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null);
  const [resolvingZoneAlertId, setResolvingZoneAlertId] = useState<string | null>(null);
  const [resolvingLocationAlertId, setResolvingLocationAlertId] = useState<string | null>(null);
  const [reactivatingLockoutId, setReactivatingLockoutId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In-app visual banner for a newly-detected zone alert OR account lockout
  // — separate from fireLocalAlertNotification's OS-level sound+banner
  // because that one no-ops on web (expo-notifications has no real
  // implementation there, same as everywhere else in this app). This banner
  // works on every platform since it's just a React element, so it's what
  // actually proves the realtime path fired when testing via
  // `expo start --web`. Stays up until manually dismissed (no auto-hide
  // timer) so it can't be missed by bad timing. `kind` picks the label/color
  // so a lockout doesn't misleadingly read as a "RED ZONE ALERT".
  const [newAlertBanner, setNewAlertBanner] = useState<{ kind: 'zone' | 'lockout' | 'boundary-exit'; message: string } | null>(null);

  function showNewZoneAlertBanner(message: string) {
    setNewAlertBanner({ kind: 'zone', message });
  }

  function showNewLockoutBanner(message: string) {
    setNewAlertBanner({ kind: 'lockout', message });
  }

  function showNewBoundaryExitBanner(message: string) {
    setNewAlertBanner({ kind: 'boundary-exit', message });
  }

  // Which restricted_zone_alerts ids this screen has already shown —
  // null until the first load completes, so opening the screen with
  // existing unresolved alerts never fires a notification for alerts that
  // aren't actually new, only for ones that appear after that baseline.
  const seenZoneAlertIdsRef = useRef<Set<string> | null>(null);
  // Same "only notify for what's genuinely new" baseline, for Section 5's
  // account lockouts.
  const seenLockoutIdsRef = useRef<Set<string> | null>(null);
  // Same again, for geofence_alerts (boundary exits) — this feed never had
  // a notification-firing path at all before (confirmed: only zone alerts
  // and lockouts were diffed here), so this is genuinely new, not a copy
  // of an existing bug.
  const seenGeofenceAlertIdsRef = useRef<Set<string> | null>(null);

  // All staff-wide, unscoped queries (see siteIssues.ts / geofenceAlerts.ts /
  // locationDisabledAlerts.ts) — filtered down to just the currently-
  // selected project client-side where a project scope even applies (recent
  // logins aren't tied to one project). fieldLoginEvents fetch failures are
  // swallowed rather than surfaced as the screen's own error banner — it's
  // an informational log, not something that should block the alert feeds
  // above it from loading.
  const load = useCallback(async () => {
    if (!isStaff) return;
    try {
      setError(null);
      const [s, g, z, l, k] = await Promise.all([
        fetchUnresolvedSiteIssues(),
        fetchUnresolvedGeofenceAlerts(),
        fetchUnresolvedRestrictedZoneAlerts(),
        fetchUnresolvedLocationDisabledAlerts(),
        fetchUnresolvedAccountLockouts(),
      ]);
      const filteredZ = selectedProjectId ? z.filter((a) => a.projectId === selectedProjectId) : z;
      const filteredG = selectedProjectId ? g.filter((a) => a.projectId === selectedProjectId) : g;

      // Diffed here (not in the realtime handler below) so this fires
      // consistently regardless of what triggered the reload — the
      // restricted_zone_alerts realtime channel, pull-to-refresh, or the
      // initial mount — instead of duplicating "what's actually new" logic
      // per trigger source.
      // Admin/manager only (isAdminOrManager) — these are system-generated
      // monitoring alerts ABOUT a site engineer, not FOR them; see this
      // component's own isAdminOrManager comment for why a field role must
      // never get this local notification/banner for their own event.
      if (seenZoneAlertIdsRef.current) {
        const seen = seenZoneAlertIdsRef.current;
        for (const alert of filteredZ) {
          if (!seen.has(alert.id) && isAdminOrManager) {
            // Bug 3.6 — the stated Leave reason (if any) rides along on the
            // notification/banner too, not just the row's own display —
            // still never gates whether this fires at all.
            const message = `${alert.userName ?? 'A site engineer'} has entered ${alert.zoneName ?? 'a restricted zone'}${
              alert.statedLeaveReason ? ` — stated reason: ${alert.statedLeaveReason}` : ''
            }`;
            // Distinct, sharper sound than a boundary exit — red zone is
            // the higher-severity event and should sound more alarming.
            fireLocalAlertNotification('Red zone alert', message, { kind: 'zone-alert', alertId: alert.id }, 'redzone_entry.wav');
            showNewZoneAlertBanner(message);
          }
        }
      }
      seenZoneAlertIdsRef.current = new Set(filteredZ.map((a) => a.id));

      // Boundary exits (geofence_alerts) never had a notification-firing
      // path here before — this is the missing half of the same pattern
      // zone alerts already had, not a copy of an existing bug.
      if (seenGeofenceAlertIdsRef.current) {
        const seen = seenGeofenceAlertIdsRef.current;
        for (const alert of filteredG) {
          if (!seen.has(alert.id) && isAdminOrManager) {
            const message = `${alert.userName ?? 'A site engineer'} left the site boundary`;
            fireLocalAlertNotification('Boundary exit', message, { kind: 'geofence-alert', alertId: alert.id }, 'boundary_exit.wav');
            showNewBoundaryExitBanner(message);
          }
        }
      }
      seenGeofenceAlertIdsRef.current = new Set(filteredG.map((a) => a.id));

      // account_lockouts is admin/manager-only via RLS — for a field role
      // `k` is always empty, so this is naturally a no-op for them.
      if (seenLockoutIdsRef.current) {
        const seen = seenLockoutIdsRef.current;
        for (const lockout of k) {
          if (!seen.has(lockout.id)) {
            const message = `${lockout.userName ?? 'A site engineer'}'s account was locked`;
            fireLocalAlertNotification('Account locked', message, { kind: 'account-lockout', lockoutId: lockout.id });
            showNewLockoutBanner(message);
          }
        }
      }
      seenLockoutIdsRef.current = new Set(k.map((l) => l.id));

      setSiteIssues(selectedProjectId ? s.filter((i) => i.projectId === selectedProjectId) : s);
      setGeofenceAlerts(selectedProjectId ? g.filter((a) => a.projectId === selectedProjectId) : g);
      setRestrictedZoneAlerts(filteredZ);
      setLocationDisabledAlerts(selectedProjectId ? l.filter((a) => a.projectId === selectedProjectId) : l);
      setAccountLockouts(k);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    fetchRecentFieldLoginEvents(10)
      .then(setRecentLogins)
      .catch(() => {});
  }, [isStaff, selectedProjectId, isAdminOrManager]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Live update, independent of push notifications entirely — the moment a
  // confirmed red-zone entry OR boundary exit is inserted, this refetches
  // immediately rather than waiting for the user to pull-to-refresh.
  // geofence_alerts was NOT previously in the supabase_realtime
  // publication (confirmed directly against the DB) — added alongside
  // this feature so boundary exits get the same live path zone alerts
  // already had.
  //
  // Channel name has a random suffix, not a fixed string — a fixed topic
  // name across two concurrently-mounted instances of this same screen
  // (e.g. a fast remount during drawer navigation) throws "cannot add
  // `postgres_changes` listener" and crashes the whole screen (this exact
  // failure mode is what broke NotificationBell.tsx, which has the
  // identical pattern — fixed there the same way).
  const zoneChannelSuffixRef = useRef(Math.random().toString(36).slice(2));

  useEffect(() => {
    if (!isStaff) return;
    const channel = supabase
      .channel(`critical-alerts-zone-live-${zoneChannelSuffixRef.current}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'restricted_zone_alerts' }, () => {
        load();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'geofence_alerts' }, () => {
        load();
      })
      // Section 5 — account_lockouts was added to the supabase_realtime
      // publication alongside this feature (add-gps-lockout.sql); a lockout
      // written by lock_own_account_for_gps still fires a normal INSERT
      // event despite going through a SECURITY DEFINER function rather than
      // a plain client insert.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'account_lockouts' }, () => {
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isStaff, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleResolveSiteIssue(issueId: string) {
    if (state.status !== 'signed-in') return;
    setResolvingIssueId(issueId);
    try {
      await resolveSiteIssue(issueId, state.profile.id);
      setSiteIssues((prev) => prev.filter((i) => i.id !== issueId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingIssueId(null);
    }
  }

  async function handleResolveGeofenceAlert(alertId: string) {
    if (state.status !== 'signed-in') return;
    setResolvingAlertId(alertId);
    try {
      await resolveGeofenceAlert(alertId, state.profile.id);
      setGeofenceAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingAlertId(null);
    }
  }

  async function handleResolveRestrictedZoneAlert(alertId: string) {
    if (state.status !== 'signed-in') return;
    setResolvingZoneAlertId(alertId);
    try {
      await resolveRestrictedZoneAlert(alertId, state.profile.id);
      setRestrictedZoneAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingZoneAlertId(null);
    }
  }

  async function handleResolveLocationDisabledAlert(alertId: string) {
    if (state.status !== 'signed-in') return;
    setResolvingLocationAlertId(alertId);
    try {
      await resolveLocationDisabledAlert(alertId, state.profile.id);
      setLocationDisabledAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingLocationAlertId(null);
    }
  }

  async function handleReactivateLockout(lockoutId: string) {
    setReactivatingLockoutId(lockoutId);
    try {
      await reactivateAccountLockout(lockoutId);
      setAccountLockouts((prev) => prev.filter((l) => l.id !== lockoutId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReactivatingLockoutId(null);
    }
  }

  // Same staff-only convention as the rest of this app — both feeds above are staff-only.
  if (!isStaff) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  const projectName = selectedProjectId ? projects.find((p) => p.id === selectedProjectId)?.name : null;
  const totalCount =
    siteIssues.length + geofenceAlerts.length + restrictedZoneAlerts.length + locationDisabledAlerts.length + accountLockouts.length;

  // A single SectionList, not four separate ScrollView + .map() blocks —
  // every one of these four feeds is an unresolved-only query with no
  // query limit (deliberately, so a real open issue is never silently
  // truncated), which on a neglected project can realistically reach
  // dozens+. Each section supplies its own renderItem (a real SectionList
  // feature — it overrides the top-level one below for just that section)
  // so each alert type keeps its own row component and resolve handler,
  // while only the rows actually on screen ever render. Empty feeds are
  // filtered out rather than rendered as empty sections.
  const sections = (
    [
      { key: 'locationDisabled', data: locationDisabledAlerts, renderItem: ({ item }: { item: LocationDisabledAlert }) => (
        <LocationDisabledAlertRow alert={item} resolving={resolvingLocationAlertId === item.id} onResolve={handleResolveLocationDisabledAlert} />
      ) },
      { key: 'geofence', data: geofenceAlerts, renderItem: ({ item }: { item: GeofenceAlert }) => (
        <GeofenceAlertRow alert={item} resolving={resolvingAlertId === item.id} onResolve={handleResolveGeofenceAlert} />
      ) },
      { key: 'zone', data: restrictedZoneAlerts, renderItem: ({ item }: { item: RestrictedZoneAlert }) => (
        <RestrictedZoneAlertRow alert={item} resolving={resolvingZoneAlertId === item.id} onResolve={handleResolveRestrictedZoneAlert} />
      ) },
      { key: 'siteIssues', data: siteIssues, renderItem: ({ item }: { item: SiteIssue }) => (
        <SiteIssueRow issue={item} resolving={resolvingIssueId === item.id} onResolve={handleResolveSiteIssue} />
      ) },
      // Last among the alert feeds, not first — a GPS lockout is a
      // contained state (the account is already blocked from doing
      // anything, unlike the other four feeds' ongoing/active conditions),
      // so it reads as lower urgency despite still needing admin action.
      { key: 'accountLockouts', data: accountLockouts, renderItem: ({ item }: { item: AccountLockout }) => (
        <AccountLockoutRow lockout={item} reactivating={reactivatingLockoutId === item.id} onReactivate={handleReactivateLockout} />
      ) },
    ] as unknown as { key: string; data: { id: string }[]; renderItem: (info: { item: { id: string } }) => ReactElement }[]
  ).filter((s) => s.data.length > 0);

  if (recentLogins.length > 0) {
    sections.push({
      key: 'recentLogins',
      data: recentLogins,
      renderItem: ({ item }) => <RecentLoginRow event={item as FieldLoginEvent} />,
    });
  }

  return (
    <View className="flex-1 bg-neutral-50">
      {newAlertBanner && (
        <Pressable
          onPress={() => setNewAlertBanner(null)}
          className="px-4 py-3 flex-row items-center gap-2"
          style={{ backgroundColor: newAlertBanner.kind === 'lockout' ? '#1D4ED8' : '#DC2626' }}
        >
          <Ionicons name="alert-circle" size={18} color="#ffffff" />
          <Text className="text-sm font-extrabold text-white flex-1">
            {BANNER_LABEL[newAlertBanner.kind]} — {newAlertBanner.message}
          </Text>
          <Ionicons name="close" size={18} color="#ffffff" />
        </Pressable>
      )}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-neutral-100">
        {projectName && <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1">{projectName}</Text>}
        <Text className="text-sm text-neutral-400">
          {siteIssues.length} site issue{siteIssues.length === 1 ? '' : 's'} · {geofenceAlerts.length} location alert
          {geofenceAlerts.length === 1 ? '' : 's'} · {restrictedZoneAlerts.length} restricted zone
          {restrictedZoneAlerts.length === 1 ? '' : 's'} · {locationDisabledAlerts.length} location off
          {accountLockouts.length > 0 ? ` · ${accountLockouts.length} locked account${accountLockouts.length === 1 ? '' : 's'}` : ''}
        </Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-red-600 text-center mb-3">Couldn&apos;t load critical alerts: {error}</Text>
          <Pressable
            onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }}
            className="px-4 py-2 rounded-lg bg-white border border-red-200"
          >
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={(info) => info.section.renderItem(info)}
          renderSectionHeader={({ section }) =>
            section.key === 'recentLogins' ? (
              // Informational, not an alert — deliberately below the fold
              // of whatever's actually urgent above, own header so it
              // doesn't get mistaken for another alert type.
              <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5 mt-2 bg-neutral-50">Recent Logins</Text>
            ) : null
          }
          contentContainerClassName="px-4 pt-4 pb-8 flex-grow"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
          // A header, not ListEmptyComponent — ListEmptyComponent only
          // shows when `sections` is fully empty, but recentLogins can
          // still be non-empty while every actual alert feed is (the same
          // independent-conditions behavior the original two separate
          // blocks had): "nothing critical" plus a Recent Logins section
          // both visible at once is a real, valid state to preserve.
          ListHeaderComponent={
            totalCount === 0 ? (
              <EmptyState
                title="Nothing critical right now"
                subtitle="No site issues or location alerts have been reported."
              />
            ) : null
          }
        />
      )}
    </View>
  );
}
