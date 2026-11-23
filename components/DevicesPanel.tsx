import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { formatDateTimeLabel } from '../lib/formatTime';
import { currentPhoneSessions, STALE_DAYS, type PhoneRow } from '../lib/phoneSessions';
import { fetchTesterDays, type TesterDays } from '../lib/testerActivity';
import { TestersSection } from './TestersSection';

// Settings → Devices & Logins (admin/manager). Reads user_devices, which each
// phone keeps up to date itself (lib/deviceActivity.ts) — see
// admin-web/prisma/add-user-devices.sql. Its RLS lets admin/manager read
// every row (names via the user_profiles join); everyone else only their own.

const ONLINE_MS = 10 * 60 * 1000;

interface DeviceRow extends PhoneRow {
  osVersion: string | null;
  deviceName: string | null;
  appVersion: string | null;
  buildNumber: string | null;
  pushEnabled: boolean;
}

interface UserGroup {
  userId: string;
  name: string;
  email: string;
  role: string;
  devices: DeviceRow[];
  lastSeenAt: Date;
}

type Filter = 'all' | 'online' | 'ios' | 'android';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  senior_site_engineer: 'Senior Site Engineer',
  site_engineer: 'Site Engineer',
  client: 'Client',
};

function relative(d: Date, now: number): string {
  const mins = Math.floor((now - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Phone app logins only, one row per person: the phone they're signed in on
// now (lib/phoneSessions.ts has the rules). Every phone row is read, removed
// accounts too, so a later login by anyone on the same phone counts.
async function fetchDevices(now: number): Promise<UserGroup[]> {
  const { data, error } = await supabase
    .from('user_devices')
    .select(`
      id, user_id, device_id, platform, os_version, manufacturer, model, device_name,
      app_version, build_number, push_enabled, first_seen_at, last_login_at, last_seen_at,
      user:user_profiles!user_devices_user_id_fkey(full_name, email, role, status, deleted_at)
    `)
    .in('platform', ['android', 'ios'])
    .order('last_seen_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);

  type U = { full_name: string; email: string; role: string; status: string | null; deleted_at: string | null };
  const people = new Map<string, U>();
  const rows: DeviceRow[] = [];
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const userRaw = r.user as U | U[] | null;
    const user = Array.isArray(userRaw) ? userRaw[0] : userRaw;
    if (user) people.set(r.user_id as string, user);
    rows.push({
      id: r.id as string,
      userId: r.user_id as string,
      deviceId: r.device_id as string,
      platform: r.platform as string | null,
      osVersion: r.os_version as string | null,
      manufacturer: r.manufacturer as string | null,
      model: r.model as string | null,
      deviceName: r.device_name as string | null,
      appVersion: r.app_version as string | null,
      buildNumber: r.build_number as string | null,
      pushEnabled: r.push_enabled as boolean,
      firstSeenAt: new Date(r.first_seen_at as string),
      lastLoginAt: r.last_login_at ? new Date(r.last_login_at as string) : null,
      lastSeenAt: new Date(r.last_seen_at as string),
    });
  }
  // Removed / deactivated accounts aren't listed.
  const active = new Set([...people].filter(([, u]) => !u.deleted_at && (!u.status || u.status === 'active')).map(([id]) => id));
  return currentPhoneSessions(rows, now, active).map((d) => {
    const u = people.get(d.userId)!;
    return { userId: d.userId, name: u.full_name, email: u.email, role: u.role, devices: [d], lastSeenAt: d.lastSeenAt };
  });
}

function currentDevice(devices: DeviceRow[]): DeviceRow {
  return devices[0];
}


function DeviceLine({ d, now }: { d: DeviceRow; now: number }) {
  const online = now - d.lastSeenAt.getTime() < ONLINE_MS;
  const icon = d.platform === 'ios' ? 'logo-apple' : d.platform === 'android' ? 'logo-android' : 'globe-outline';
  const title = [d.manufacturer && d.platform === 'android' ? d.manufacturer : null, d.model ?? d.deviceName ?? 'Unknown device']
    .filter(Boolean)
    .join(' ');
  const os = d.platform === 'ios' ? `iOS ${d.osVersion ?? ''}` : d.platform === 'android' ? `Android ${d.osVersion ?? ''}` : 'Web';
  return (
    <View className="flex-row gap-3 pt-3 mt-3 border-t border-neutral-100">
      <View className="w-9 h-9 rounded-lg bg-neutral-100 items-center justify-center">
        <Ionicons name={icon} size={18} color="#0F1F33" />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-sm font-semibold text-neutral-900 flex-shrink" numberOfLines={1}>{title}</Text>
          {online && <View className="w-2 h-2 rounded-full bg-green-500" />}
        </View>
        <Text className="text-xs text-neutral-500 mt-0.5">
          {os.trim()} · App {d.appVersion ?? '?'}{d.buildNumber ? ` (${d.buildNumber})` : ''}
        </Text>
        <View className="flex-row flex-wrap gap-x-3 gap-y-0.5 mt-1">
          <Text className="text-2xs text-neutral-500">
            Last used: <Text className="font-semibold text-neutral-700">{online ? 'Active now' : relative(d.lastSeenAt, now)}</Text>
          </Text>
          {d.lastLoginAt && <Text className="text-2xs text-neutral-500">Last login: {formatDateTimeLabel(d.lastLoginAt)}</Text>}
        </View>
      </View>
      <Ionicons
        name={d.pushEnabled ? 'notifications' : 'notifications-off-outline'}
        size={16}
        color={d.pushEnabled ? '#16A34A' : '#9CA3AF'}
      />
    </View>
  );
}

// Who is signed in on a phone now + the closed-testing Testers section.
// Shown in Settings → "Login & Devices" (2026-11-21) and on the old Devices & Logins route.
export function DevicesPanel() {
  const { state } = useAuth();
  const isAdmin = state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');
  const [groups, setGroups] = useState<UserGroup[] | null>(null);
  // Captured per load so "Active now"/"5 min ago" are pure during render.
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Closed-testing testers and their last 14 days (admin only).
  const [testers, setTesters] = useState<TesterDays[] | null>(null);
  const isRealAdmin = state.status === 'signed-in' && state.profile.role === 'admin';

  const load = useCallback(async () => {
    try {
      const t = Date.now();
      const [next, tds] = await Promise.all([fetchDevices(t), isRealAdmin ? fetchTesterDays(t).catch(() => null) : Promise.resolve(null)]);
      setNow(t);
      setGroups(next);
      setTesters(tds);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isRealAdmin]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const visible = useMemo(() => {
    if (!groups) return [];
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        devices: g.devices.filter((d) =>
          filter === 'all' ? true
          : filter === 'online' ? now - d.lastSeenAt.getTime() < ONLINE_MS
          : d.platform === filter,
        ),
      }))
      .filter((g) => g.devices.length > 0)
      .filter((g) => !q || g.name.toLowerCase().includes(q) || g.email.toLowerCase().includes(q));
  }, [groups, query, filter, now]);

  if (!isAdmin) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  const onlineCount = groups?.filter((g) => now - g.lastSeenAt.getTime() < ONLINE_MS).length ?? 0;

  return (
    <View>
        <Pressable
          onPress={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          disabled={refreshing}
          className="self-end flex-row items-center gap-1 mb-2 px-2.5 py-1 rounded-lg border border-neutral-200 bg-white"
        >
          {refreshing ? <ActivityIndicator size="small" color="#0F1F33" /> : <Ionicons name="refresh" size={13} color="#0F1F33" />}
          <Text className="text-2xs font-semibold text-neutral-700">Refresh</Text>
        </Pressable>
        <View className="flex-row gap-3 mb-4">
          <Card className="flex-1">
            <Text className="text-2xl font-bold text-neutral-900">{groups ? groups.length : '–'}</Text>
            <Text className="text-xs text-neutral-500">People</Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-2xl font-bold text-green-600">{groups ? onlineCount : '–'}</Text>
            <Text className="text-xs text-neutral-500">Active now</Text>
          </Card>
        </View>

        {testers ? (
          <TestersSection
            testers={testers}
            phoneOf={(userId) => {
              const g = groups?.find((x) => x.userId === userId);
              const d = g?.devices[0];
              if (!d) return null;
              const online = now - d.lastSeenAt.getTime() < ONLINE_MS;
              const title = [d.platform === 'android' ? d.manufacturer : null, d.model ?? d.deviceName ?? 'Phone'].filter(Boolean).join(' ');
              return { model: title, build: d.buildNumber, lastUsed: relative(d.lastSeenAt, now), online };
            }}
          />
        ) : null}

        <View className="flex-row items-center gap-2 rounded-xl bg-white border border-neutral-200 px-3 mb-3" style={{ minHeight: 44 }}>
          <Ionicons name="search" size={16} color="#9CA3AF" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or email"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            className="flex-1 text-sm text-neutral-900"
          />
        </View>

        <View className="flex-row flex-wrap gap-2 mb-4">
          {([['all', 'All'], ['online', 'Active now'], ['android', 'Android'], ['ios', 'iPhone']] as [Filter, string][]).map(([f, label]) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full border ${filter === f ? 'bg-brand-navy border-brand-navy' : 'bg-white border-neutral-200'}`}
            >
              <Text className={`text-xs font-semibold ${filter === f ? 'text-white' : 'text-neutral-700'}`}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {error ? (
          <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <Text className="text-xs text-red-600">{error}</Text>
          </View>
        ) : !groups ? (
          <ActivityIndicator color="#0F1F33" style={{ marginTop: 32 }} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="phone-portrait-outline"
            iconColor="#9CA3AF"
            title="No one signed in on a phone"
            subtitle={`Shows the phone app only: who is signed in on each phone now. Phones not used for ${STALE_DAYS} days are left out.`}
          />
        ) : (
          visible.map((g) => (
            <Card key={g.userId} className="mb-3">
              <View className="flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-full bg-brand-navy items-center justify-center">
                  <Text className="text-sm font-bold text-white">{g.name.trim().charAt(0).toUpperCase()}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-md font-semibold text-neutral-900">{g.name}</Text>
                  <Text className="text-xs text-neutral-500" numberOfLines={1}>
                    {ROLE_LABEL[g.role] ?? g.role}{g.email ? ` · ${g.email}` : ''}
                  </Text>
                </View>
              </View>
              {/* One row: the phone they use now (2026-11-21) — no old devices / history. */}
              <DeviceLine d={currentDevice(g.devices)} now={now} />
            </Card>
          ))
        )}
    </View>
  );
}

