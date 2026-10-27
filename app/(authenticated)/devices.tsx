import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatDateTimeLabel } from '../../lib/formatTime';

// Settings → Devices & Logins (admin/manager). Reads user_devices, which each
// phone keeps up to date itself (lib/deviceActivity.ts) — see
// admin-web/prisma/add-user-devices.sql. Its RLS lets admin/manager read
// every row (names via the user_profiles join); everyone else only their own.

const ONLINE_MS = 10 * 60 * 1000;

interface DeviceRow {
  id: string;
  platform: string | null;
  osVersion: string | null;
  manufacturer: string | null;
  model: string | null;
  deviceName: string | null;
  appVersion: string | null;
  buildNumber: string | null;
  pushEnabled: boolean;
  firstSeenAt: Date;
  lastLoginAt: Date | null;
  lastSeenAt: Date;
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

async function fetchDevices(): Promise<UserGroup[]> {
  const { data, error } = await supabase
    .from('user_devices')
    .select(`
      id, user_id, platform, os_version, manufacturer, model, device_name,
      app_version, build_number, push_enabled, first_seen_at, last_login_at, last_seen_at,
      user:user_profiles!user_devices_user_id_fkey(full_name, email, role)
    `)
    .order('last_seen_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const groups = new Map<string, UserGroup>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const userRaw = r.user as { full_name: string; email: string; role: string } | { full_name: string; email: string; role: string }[] | null;
    const user = Array.isArray(userRaw) ? userRaw[0] : userRaw;
    const device: DeviceRow = {
      id: r.id as string,
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
    };
    const userId = r.user_id as string;
    const g = groups.get(userId) ?? {
      userId,
      name: user?.full_name ?? 'Unknown user',
      email: user?.email ?? '',
      role: user?.role ?? '',
      devices: [],
      lastSeenAt: device.lastSeenAt,
    };
    g.devices.push(device);
    if (device.lastSeenAt > g.lastSeenAt) g.lastSeenAt = device.lastSeenAt;
    groups.set(userId, g);
  }
  return [...groups.values()].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
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
          {d.lastLoginAt && <Text className="text-2xs text-neutral-500">Logged in: {formatDateTimeLabel(d.lastLoginAt)}</Text>}
          <Text className="text-2xs text-neutral-500">First seen: {formatDateTimeLabel(d.firstSeenAt)}</Text>
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

export default function DevicesScreen() {
  const { state } = useAuth();
  const isAdmin = state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');
  const [groups, setGroups] = useState<UserGroup[] | null>(null);
  // Captured per load so "Active now"/"5 min ago" are pure during render.
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      const next = await fetchDevices();
      setNow(Date.now());
      setGroups(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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

  const deviceCount = groups?.reduce((n, g) => n + g.devices.length, 0) ?? 0;
  const onlineCount = groups?.reduce((n, g) => n + g.devices.filter((d) => now - d.lastSeenAt.getTime() < ONLINE_MS).length, 0) ?? 0;

  return (
    <View className="flex-1 bg-neutral-50">
      <ScrollView
        contentContainerClassName="px-4 pt-4 pb-10"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row gap-3 mb-4">
          <Card className="flex-1">
            <Text className="text-2xl font-bold text-neutral-900">{groups ? groups.length : '–'}</Text>
            <Text className="text-xs text-neutral-500">People signed in</Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-2xl font-bold text-neutral-900">{groups ? deviceCount : '–'}</Text>
            <Text className="text-xs text-neutral-500">Devices</Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-2xl font-bold text-green-600">{groups ? onlineCount : '–'}</Text>
            <Text className="text-xs text-neutral-500">Active now</Text>
          </Card>
        </View>

        <View className="flex-row items-center gap-2 rounded-xl bg-white border border-neutral-200 px-3 mb-3" style={{ height: 44 }}>
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

        <View className="flex-row gap-2 mb-4">
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
            title="No devices yet"
            subtitle="Devices appear here once people open the latest version of the app."
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
                <Text className="text-2xs font-semibold text-neutral-400">
                  {g.devices.length} device{g.devices.length === 1 ? '' : 's'}
                </Text>
              </View>
              {g.devices.map((d) => <DeviceLine key={d.id} d={d} now={now} />)}
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}
