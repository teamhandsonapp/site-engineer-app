// Site Groups setup — only for people with "can manage" Site Groups access.
// Two tabs:
//   Groups: every WhatsApp group the connected number is in. New groups
//           arrive switched off; link each to a project and switch it on.
//   People: who can read Site Groups, who can reply, who can manage.
// The server re-checks can_manage on every call (see lib/groupChats/admin.ts).

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { refreshSiteGroupsAccess, useSiteGroupsAccess, useSiteGroupsEnabled } from '../../lib/groupChats/access';
import {
  fetchAccessCandidates,
  fetchAccessList,
  fetchAllGroups,
  removeAccess,
  setAccess,
  updateGroup,
  type AccessCandidate,
  type AccessPerson,
  type SetupGroup,
} from '../../lib/groupChats/admin';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

const NAVY = '#0F1F33';

function timeAgo(iso: string | null): string {
  if (!iso) return 'No messages yet';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Last message just now';
  if (mins < 60) return `Last message ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Last message ${hrs} h ago`;
  return `Last message ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-3">
      <Text className="text-sm text-red-600 mb-2">{message}</Text>
      <Pressable onPress={onRetry} className="self-start px-3 py-1.5 rounded-lg bg-white border border-red-200">
        <Text className="text-xs font-semibold text-red-600">Try again</Text>
      </Pressable>
    </View>
  );
}

// Bottom sheet listing options; used for the project picker and Add person.
function PickerSheet<T>({ visible, title, items, keyOf, labelOf, subOf, onPick, onClose, emptyText }: {
  visible: boolean;
  title: string;
  items: T[];
  keyOf: (t: T) => string;
  labelOf: (t: T) => string;
  subOf?: (t: T) => string | null;
  onPick: (t: T) => void;
  onClose: () => void;
  emptyText: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,31,51,0.35)', justifyContent: 'flex-end' }} onPress={onClose} accessibilityLabel="Close">
        <Pressable onPress={() => {}} className="bg-white rounded-t-2xl pt-5" style={{ maxHeight: '80%' }}>
          <Text className="text-lg font-bold text-neutral-900 px-5 mb-2">{title}</Text>
          <ScrollView contentContainerClassName="px-3 pb-8">
            {items.length === 0 ? <Text className="text-sm text-neutral-400 px-2 py-4">{emptyText}</Text> : null}
            {items.map((it) => {
              const sub = subOf?.(it);
              return (
                <Pressable key={keyOf(it)} onPress={() => onPick(it)} accessibilityRole="button" className="px-2 py-3 rounded-lg active:bg-neutral-100">
                  <Text className="text-base font-semibold text-neutral-900">{labelOf(it)}</Text>
                  {sub ? <Text className="text-xs text-neutral-500 mt-0.5">{sub}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function GroupsTab() {
  const { projects } = useProject();
  const [groups, setGroups] = useState<SetupGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState<SetupGroup | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setGroups(await fetchAllGroups());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(g: SetupGroup, isEnabled: boolean, projectId: string | null) {
    setBusy(g.id);
    try {
      await updateGroup(g.id, isEnabled, projectId);
      setGroups((list) => (list ?? []).map((x) => (x.id === g.id ? { ...x, is_enabled: isEnabled, project_id: projectId } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? 'Unknown project' : null);

  return (
    <ScrollView
      contentContainerClassName="px-4 pt-4 pb-10"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={NAVY} />}
    >
      <Text className="text-xs text-neutral-500 mb-3">
        Groups appear here after their first message reaches PMC Portal. They start switched off. Link each one to a project, then switch it on so people can see it.
      </Text>
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      {groups === null && !error ? <ActivityIndicator color={NAVY} style={{ marginTop: 24 }} /> : null}
      {groups && groups.length === 0 ? (
        <EmptyState icon="chatbubbles-outline" title="No groups yet" subtitle="Add the connected WhatsApp number to a site group and send a message there. The group will show up here." />
      ) : null}
      {(groups ?? []).map((g) => {
        const linked = projectName(g.project_id);
        const canEnable = !!g.project_id;
        return (
          <Card key={g.id} style={{ marginBottom: 12 }}>
            <View className="flex-row items-start gap-3">
              <View className="flex-1">
                <Text className="text-base font-semibold text-neutral-900">{g.name}</Text>
                <Text className="text-xs text-neutral-500 mt-0.5">{timeAgo(g.last_message_at)}</Text>
              </View>
              <View className="items-end">
                {busy === g.id ? (
                  <ActivityIndicator color={NAVY} />
                ) : (
                  <Switch
                    value={g.is_enabled}
                    disabled={!canEnable && !g.is_enabled}
                    onValueChange={(v) => void save(g, v, g.project_id)}
                    accessibilityLabel={`${g.is_enabled ? 'Switch off' : 'Switch on'} ${g.name}`}
                  />
                )}
                <Text className="text-2xs mt-0.5" style={{ color: g.is_enabled ? '#15803D' : '#6B7280' }}>
                  {g.is_enabled ? 'On' : 'Off'}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => setPicking(g)}
              accessibilityRole="button"
              className="flex-row items-center mt-3 rounded-lg border px-3 py-2.5"
              style={{ borderColor: linked ? '#E5E7EB' : '#F0A227', backgroundColor: linked ? '#F9FAFB' : '#FEF5E4' }}
            >
              <Ionicons name="business-outline" size={16} color={linked ? NAVY : '#B45309'} />
              <Text className="flex-1 text-sm ml-2" style={{ color: linked ? '#111827' : '#B45309', fontWeight: linked ? '500' : '600' }}>
                {linked ?? 'Link to a project'}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
            </Pressable>
            {!canEnable && !g.is_enabled ? <Text className="text-2xs text-neutral-400 mt-1.5">Link a project before switching this group on.</Text> : null}
          </Card>
        );
      })}

      <PickerSheet
        visible={!!picking}
        title="Link to project"
        items={[{ id: '', name: 'No project (unlink)' }, ...projects]}
        keyOf={(p) => p.id || 'none'}
        labelOf={(p) => p.name}
        onClose={() => setPicking(null)}
        emptyText="No projects."
        onPick={(p) => {
          const g = picking;
          setPicking(null);
          if (!g) return;
          const projectId = p.id || null;
          // Unlinking also switches the group off: an enabled group with no
          // project would show up nowhere.
          void save(g, projectId ? g.is_enabled : false, projectId);
        }}
      />
    </ScrollView>
  );
}

function PeopleTab() {
  const { state } = useAuth();
  const me = state.status === 'signed-in' ? state.profile.id : null;
  const [people, setPeople] = useState<AccessPerson[] | null>(null);
  const [candidates, setCandidates] = useState<AccessCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setPeople(await fetchAccessList());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function change(userId: string, canSend: boolean, canManage: boolean) {
    setBusy(userId);
    try {
      await setAccess(userId, canSend, canManage);
      await load();
      if (userId === me) refreshSiteGroupsAccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string) {
    setBusy(userId);
    setConfirmRemove(null);
    try {
      await removeAccess(userId);
      await load();
      if (userId === me) refreshSiteGroupsAccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function openAdd() {
    setAdding(true);
    setCandidates(null);
    try {
      setCandidates(await fetchAccessCandidates());
    } catch (e) {
      setAdding(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ScrollView
      contentContainerClassName="px-4 pt-4 pb-10"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={NAVY} />}
    >
      <View className="flex-row items-center mb-3 gap-3">
        <Text className="flex-1 text-xs text-neutral-500">Everyone listed can read every switched-on group. Reply and Manage are extra.</Text>
        <Pressable onPress={openAdd} accessibilityRole="button" className="flex-row items-center rounded-lg px-3 py-2" style={{ backgroundColor: NAVY }}>
          <Ionicons name="person-add-outline" size={15} color="#fff" />
          <Text className="text-xs font-semibold text-white ml-1.5">Add person</Text>
        </Pressable>
      </View>
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      {people === null && !error ? <ActivityIndicator color={NAVY} style={{ marginTop: 24 }} /> : null}
      {(people ?? []).map((p) => (
        <Card key={p.user_id} style={{ marginBottom: 10 }}>
          <View className="flex-row items-center">
            <View className="flex-1 pr-2">
              <Text className="text-base font-semibold text-neutral-900">
                {p.full_name}
                {p.user_id === me ? <Text className="text-xs text-neutral-400"> (you)</Text> : null}
              </Text>
              <Text className="text-xs text-neutral-500 mt-0.5" numberOfLines={1}>
                {p.role.replace(/_/g, ' ')}
                {p.email ? ` · ${p.email}` : ''}
              </Text>
            </View>
            {busy === p.user_id ? <ActivityIndicator color={NAVY} /> : null}
          </View>
          <View className="flex-row items-center mt-3 gap-5">
            <View className="flex-row items-center gap-2">
              <Switch value={p.can_send} disabled={busy === p.user_id} onValueChange={(v) => void change(p.user_id, v, p.can_manage)} accessibilityLabel={`Can reply: ${p.full_name}`} />
              <Text className="text-sm text-neutral-700">Can reply</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Switch value={p.can_manage} disabled={busy === p.user_id} onValueChange={(v) => void change(p.user_id, p.can_send, v)} accessibilityLabel={`Can manage: ${p.full_name}`} />
              <Text className="text-sm text-neutral-700">Can manage</Text>
            </View>
          </View>
          <Pressable
            onPress={() => (confirmRemove === p.user_id ? void remove(p.user_id) : setConfirmRemove(p.user_id))}
            accessibilityRole="button"
            className="self-start mt-3 flex-row items-center rounded-lg px-2.5 py-1.5"
            style={{ backgroundColor: confirmRemove === p.user_id ? '#DC2626' : '#FEE2E2' }}
          >
            <Ionicons name="trash-outline" size={14} color={confirmRemove === p.user_id ? '#fff' : '#DC2626'} />
            <Text className="text-xs font-semibold ml-1" style={{ color: confirmRemove === p.user_id ? '#fff' : '#DC2626' }}>
              {confirmRemove === p.user_id ? 'Tap again to remove' : 'Remove access'}
            </Text>
          </Pressable>
        </Card>
      ))}
      <Text className="text-2xs text-neutral-400 mt-1">At least one person must keep "Can manage". The server blocks removing the last one.</Text>

      <PickerSheet
        visible={adding}
        title="Add person (read only)"
        items={candidates ?? []}
        keyOf={(c) => c.user_id}
        labelOf={(c) => c.full_name}
        subOf={(c) => `${c.role.replace(/_/g, ' ')}${c.email ? ` · ${c.email}` : ''}`}
        onClose={() => setAdding(false)}
        emptyText={candidates === null ? 'Loading…' : 'Everyone already has access.'}
        onPick={(c) => {
          setAdding(false);
          void change(c.user_id, false, false);
        }}
      />
    </ScrollView>
  );
}

export default function SiteGroupsSetupScreen() {
  const enabled = useSiteGroupsEnabled();
  const { canManage, loading } = useSiteGroupsAccess();
  const [tab, setTab] = useState<'groups' | 'people'>('groups');

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: 'Site Groups Setup',
        headerStyle: { backgroundColor: NAVY },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
        headerLeft: () => (
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/site-groups' as never))} hitSlop={8} style={{ padding: 11 }}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
        ),
      }}
    />
  );

  if (!enabled || !canManage) {
    return (
      <View className="flex-1 bg-neutral-50">
        {header}
        {loading ? <ActivityIndicator color={NAVY} style={{ marginTop: 40 }} /> : <EmptyState icon="lock-closed-outline" title="Not available" subtitle="Only Site Groups managers can open setup." />}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      {header}
      <View className="flex-row bg-white border-b border-neutral-200 px-3">
        {(['groups', 'people'] as const).map((t) => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              className="px-3 py-3"
              style={{ borderBottomWidth: 2, borderBottomColor: active ? '#F0A227' : 'transparent' }}
            >
              <Text className={active ? 'text-sm font-semibold text-neutral-900' : 'text-sm text-neutral-400'}>{t === 'groups' ? 'Groups' : 'People'}</Text>
            </Pressable>
          );
        })}
      </View>
      {tab === 'groups' ? <GroupsTab /> : <PeopleTab />}
    </View>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
