import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { appRoleFor, roleLabel, useAuth, type UserRole } from '../../lib/AuthContext';
import { changeUserRole, changeUserStatus, createUser, fetchAllUsers, resetUserPassword, sendInvite, type ManagedUser } from '../../lib/accessRoles';
import { fetchStaffProjects, type ProjectOption } from '../../lib/projects';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { INITIAL_PASSWORD_STATE, PasswordModeField, resolvePasswordField, type PasswordFieldState } from '../../components/PasswordModeField';

const ROLES: UserRole[] = ['admin', 'manager', 'senior_site_engineer', 'site_engineer', 'client'];

const ROLE_BADGE_COLOR: Record<UserRole, string> = {
  admin: '#111111',
  manager: '#0E7490',
  senior_site_engineer: '#4338CA',
  site_engineer: '#6B7280',
  client: '#A21CAF',
};

const STATUS_LABEL: Record<ManagedUser['status'], string> = {
  active: 'Active',
  invited: 'Invited',
  disabled: 'Disabled',
};

function Avatar({ name, role }: { name: string; role: UserRole }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <View
      className="w-10 h-10 rounded-full items-center justify-center"
      style={{ backgroundColor: ROLE_BADGE_COLOR[role] }}
    >
      <Text className="text-sm font-bold text-white">{initial}</Text>
    </View>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  const color = ROLE_BADGE_COLOR[role];
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}1A` }}>
      <Text className="text-2xs font-semibold" style={{ color }}>{roleLabel(role)}</Text>
    </View>
  );
}

function UserRow({ user, onChangeRole }: { user: ManagedUser; onChangeRole: (u: ManagedUser) => void }) {
  return (
    <Pressable onPress={() => onChangeRole(user)}>
      <Card className="mb-2.5 flex-row items-center gap-3">
        <Avatar name={user.fullName} role={user.role} />
        <View className="flex-1">
          <Text className="text-sm font-semibold text-neutral-900" numberOfLines={1}>{user.fullName}</Text>
          <Text className="text-xs text-neutral-400" numberOfLines={1}>{user.email}</Text>
        </View>
        <View className="items-end gap-1">
          <RoleBadge role={user.role} />
          <Text className="text-2xs text-neutral-400">{STATUS_LABEL[user.status]}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

function ChangeRoleSheet({
  user,
  isAdmin,
  onClose,
  onChanged,
  onResetPassword,
  onStatusChanged,
}: {
  user: ManagedUser | null;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: (userId: string, role: UserRole) => void;
  onResetPassword: (user: ManagedUser) => void;
  onStatusChanged: (userId: string, status: ManagedUser['status']) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  if (!user) return null;

  async function pickRole(role: UserRole) {
    if (!user || role === user.role) return;
    setSaving(true);
    setError(null);
    try {
      await changeUserRole(user.id, role);
      onChanged(user.id, role);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change role');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    if (!user) return;
    const nextStatus = user.status === 'disabled' ? 'active' : 'disabled';
    setStatusSaving(true);
    setError(null);
    try {
      await changeUserStatus(user.id, nextStatus);
      onStatusChanged(user.id, nextStatus);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status');
    } finally {
      setStatusSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380 }}>
          <Card>
            <Text className="text-md font-bold text-neutral-900">{user.fullName}</Text>
            <Text className="text-xs text-neutral-400 mb-3">{user.email}</Text>
            {error && (
              <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-2">
                <Text className="text-xs text-red-600">{error}</Text>
              </View>
            )}
            <Text className="text-xs text-neutral-400 mb-1.5">Change role to</Text>
            <View className="gap-1.5">
              {ROLES.map((r) => {
                const active = r === user.role;
                return (
                  <Pressable
                    key={r}
                    disabled={saving}
                    onPress={() => pickRole(r)}
                    className={`px-3 py-2.5 rounded-lg flex-row items-center justify-between ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                  >
                    <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{roleLabel(r)}</Text>
                    {active && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </Pressable>
                );
              })}
            </View>
            {/* Deactivate/Reactivate + Reset Password — admin-only, hidden
                (not just disabled) for a manager viewing this sheet, since
                the Edge Function rejects both server-side regardless (see
                its own ADMIN_ONLY_ACTIONS). Change Role above stays
                available to manager too. */}
            {isAdmin && (
              <View className="flex-row items-center gap-2 mt-3">
                <Pressable
                  disabled={statusSaving}
                  onPress={toggleStatus}
                  className={`px-3 py-2 rounded-lg flex-row items-center gap-1.5 ${user.status === 'disabled' ? 'bg-green-50' : 'bg-amber-50'}`}
                >
                  {statusSaving && <ActivityIndicator size="small" color={user.status === 'disabled' ? '#16a34a' : '#b45309'} />}
                  <Text className={`text-xs font-semibold ${user.status === 'disabled' ? 'text-green-700' : 'text-amber-700'}`}>
                    {user.status === 'disabled' ? 'Reactivate' : 'Deactivate'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => { onClose(); onResetPassword(user); }}
                  className="px-3 py-2 rounded-lg bg-red-50"
                >
                  <Text className="text-xs font-semibold text-red-600">Reset Password</Text>
                </Pressable>
              </View>
            )}
            <View className="flex-row items-center justify-end mt-2">
              <Pressable onPress={onClose} className="px-3 py-2 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">Close</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Admin-initiated — never asks for (or needs) the user's old password.
// Same two password modes as CreateUserSheet, via the shared
// PasswordModeField, and the same "show it once" success view. Submitting
// immediately invalidates the target's existing sessions server-side (see
// accessRoles.ts's resetUserPassword / the Edge Function's own
// resetPassword action) — this screen doesn't need to do anything extra
// for that itself.
function ResetPasswordSheet({
  user,
  onClose,
}: {
  user: ManagedUser | null;
  onClose: () => void;
}) {
  const [passwordState, setPasswordState] = useState<PasswordFieldState>(INITIAL_PASSWORD_STATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function reset() {
    setPasswordState(INITIAL_PASSWORD_STATE);
    setError(null);
    setResult(null);
  }

  if (!user) return null;

  async function submit() {
    const resolved = resolvePasswordField(passwordState);
    if ('error' in resolved) {
      setError(resolved.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { password } = await resetUserPassword(user!.id, resolved);
      setResult(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { reset(); onClose(); }}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={() => { reset(); onClose(); }}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380 }}>
          <Card>
            {result ? (
              <View>
                <Text className="text-md font-bold text-neutral-900 mb-1">Password reset</Text>
                <Text className="text-sm text-neutral-600 mb-3">
                  Password set. Make sure to share it with {user.fullName} now — it won&apos;t be shown again unless reset.
                  Their existing sessions have been signed out.
                </Text>
                <View className="rounded-lg bg-neutral-50 px-3 py-2.5 mb-3">
                  <Text className="text-xs text-neutral-400">New password</Text>
                  <Text className="text-sm font-mono text-neutral-900">{result}</Text>
                </View>
                <Pressable onPress={() => { reset(); onClose(); }} className="px-3 py-2.5 rounded-lg bg-brand-navy items-center">
                  <Text className="text-sm font-semibold text-white">Done</Text>
                </Pressable>
              </View>
            ) : (
              <View>
                <Text className="text-md font-bold text-neutral-900">{user.fullName}</Text>
                <Text className="text-xs text-neutral-400 mb-3">{user.email}</Text>
                {error && (
                  <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-2">
                    <Text className="text-xs text-red-600">{error}</Text>
                  </View>
                )}
                <Text className="text-xs text-neutral-400 mb-1.5">New password for this account</Text>
                <PasswordModeField state={passwordState} onChange={setPasswordState} />
                <View className="flex-row justify-end gap-2 mt-3">
                  <Pressable onPress={() => { reset(); onClose(); }} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                    <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
                  </Pressable>
                  <Pressable onPress={submit} disabled={saving} className="px-3 py-1.5 rounded-lg bg-status-urgent flex-row items-center gap-1.5">
                    {saving && <ActivityIndicator size="small" color="#fff" />}
                    <Text className="text-xs font-semibold text-white">Reset Password</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CreateUserSheet({
  visible,
  projects,
  onClose,
  onCreated,
}: {
  visible: boolean;
  projects: ProjectOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [createMode, setCreateMode] = useState<'password' | 'invite'>('password');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('site_engineer');
  const [clientProjectId, setClientProjectId] = useState<string | null>(null);
  const [passwordState, setPasswordState] = useState<PasswordFieldState>(INITIAL_PASSWORD_STATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [inviteResult, setInviteResult] = useState<{ email: string; emailSent: boolean } | null>(null);

  function reset() {
    setCreateMode('password');
    setFullName('');
    setEmail('');
    setPhone('');
    setRole('site_engineer');
    setClientProjectId(null);
    setPasswordState(INITIAL_PASSWORD_STATE);
    setError(null);
    setResult(null);
    setInviteResult(null);
  }

  async function submit() {
    if (!fullName.trim() || !email.trim()) {
      setError('Name and email are required');
      return;
    }
    if (role === 'client' && !clientProjectId) {
      setError('Pick a project for this client account');
      return;
    }

    if (createMode === 'invite') {
      setSaving(true);
      setError(null);
      try {
        const { emailSent } = await sendInvite({
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          role,
          clientProjectId: role === 'client' ? clientProjectId ?? undefined : undefined,
        });
        setInviteResult({ email: email.trim(), emailSent });
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send the invite');
      } finally {
        setSaving(false);
      }
      return;
    }

    const resolvedPassword = resolvePasswordField(passwordState);
    if ('error' in resolvedPassword) {
      setError(resolvedPassword.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { temporaryPassword } = await createUser({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        role,
        clientProjectId: role === 'client' ? clientProjectId ?? undefined : undefined,
        ...resolvedPassword,
      });
      setResult({ email: email.trim(), temporaryPassword });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => { reset(); onClose(); }}
    >
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={() => { reset(); onClose(); }}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380, maxHeight: '85%' }}>
          <Card>
            <ScrollView showsVerticalScrollIndicator={false}>
              {result ? (
                <View>
                  <Text className="text-md font-bold text-neutral-900 mb-1">Account created</Text>
                  <Text className="text-sm text-neutral-600 mb-3">
                    Password set. Make sure to share it with {result.email} now through a secure channel — it won&apos;t be shown again unless reset.
                  </Text>
                  <View className="rounded-lg bg-neutral-50 px-3 py-2.5 mb-3">
                    <Text className="text-xs text-neutral-400">Email</Text>
                    <Text className="text-sm font-mono text-neutral-900 mb-2">{result.email}</Text>
                    <Text className="text-xs text-neutral-400">Temporary password</Text>
                    <Text className="text-sm font-mono text-neutral-900">{result.temporaryPassword}</Text>
                  </View>
                  <Pressable onPress={() => { reset(); onClose(); }} className="px-3 py-2.5 rounded-lg bg-brand-navy items-center">
                    <Text className="text-sm font-semibold text-white">Done</Text>
                  </Pressable>
                </View>
              ) : inviteResult ? (
                <View>
                  <Text className="text-md font-bold text-neutral-900 mb-1">
                    {inviteResult.emailSent ? 'Invite sent' : 'Account created'}
                  </Text>
                  <Text className="text-sm text-neutral-600 mb-3">
                    {inviteResult.emailSent
                      ? `An email with a link to set their password was sent to ${inviteResult.email}. It expires in 7 days.`
                      : `Account created for ${inviteResult.email}, but the invite email failed to send. Use Resend Invite from admin-web once the issue is fixed.`}
                  </Text>
                  <Pressable onPress={() => { reset(); onClose(); }} className="px-3 py-2.5 rounded-lg bg-brand-navy items-center">
                    <Text className="text-sm font-semibold text-white">Done</Text>
                  </Pressable>
                </View>
              ) : (
                <View>
                  <Text className="text-md font-bold text-neutral-900 mb-3">Create User</Text>
                  {error && (
                    <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-2">
                      <Text className="text-xs text-red-600">{error}</Text>
                    </View>
                  )}
                  <View className="flex-row gap-1.5 bg-neutral-100 rounded-lg p-1 mb-3">
                    {([
                      { key: 'password' as const, label: 'Create now' },
                      { key: 'invite' as const, label: 'Send email invite' },
                    ]).map((m) => {
                      const active = createMode === m.key;
                      return (
                        <Pressable
                          key={m.key}
                          onPress={() => setCreateMode(m.key)}
                          className={`flex-1 py-1.5 rounded-md items-center ${active ? 'bg-brand-navy' : ''}`}
                        >
                          <Text className={`text-xs font-semibold ${active ? 'text-white' : 'text-neutral-600'}`}>{m.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text className="text-xs text-neutral-400 mb-1">Full name</Text>
                  <TextInput
                    value={fullName}
                    onChangeText={setFullName}
                    className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
                  />
                  <Text className="text-xs text-neutral-400 mb-1">Email</Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
                  />
                  <Text className="text-xs text-neutral-400 mb-1">Phone (optional)</Text>
                  <TextInput
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
                  />
                  <Text className="text-xs text-neutral-400 mb-1.5">Role</Text>
                  <View className="flex-row flex-wrap gap-1.5 mb-3">
                    {ROLES.map((r) => {
                      const active = r === role;
                      return (
                        <Pressable
                          key={r}
                          onPress={() => setRole(r)}
                          className={`px-3 py-1.5 rounded-full ${active ? 'bg-brand-navy' : 'bg-neutral-100'}`}
                        >
                          <Text className={`text-xs font-semibold ${active ? 'text-white' : 'text-neutral-600'}`}>{roleLabel(r)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {role === 'client' && (
                    <View className="mb-3">
                      <Text className="text-xs text-neutral-400 mb-1.5">Project</Text>
                      <View className="gap-1.5">
                        {projects.map((p) => {
                          const active = p.id === clientProjectId;
                          return (
                            <Pressable
                              key={p.id}
                              onPress={() => setClientProjectId(p.id)}
                              className={`px-3 py-2 rounded-lg ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                            >
                              <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{p.name}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {createMode === 'password' && (
                    <>
                      <Text className="text-xs text-neutral-400 mb-1.5">Password</Text>
                      <PasswordModeField state={passwordState} onChange={setPasswordState} />
                    </>
                  )}

                  <View className="flex-row justify-end gap-2 mt-3">
                    <Pressable onPress={() => { reset(); onClose(); }} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                      <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
                    </Pressable>
                    <Pressable onPress={submit} disabled={saving} className="px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
                      {saving && <ActivityIndicator size="small" color="#fff" />}
                      <Text className="text-xs font-semibold text-white">{createMode === 'invite' ? 'Send Invite' : 'Create'}</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </ScrollView>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Mobile port of admin-web's Access Management page (components/access/
// AccessManagement.tsx) — list every user, create a real account (a genuine
// Supabase Auth user + UserProfile, via the manage-user Edge Function, not
// just a local-only row), and change an existing user's role. Gated to
// admin/manager both by the drawer (DrawerContent.tsx hides this route for
// anyone else) and, for real enforcement, by manage-user's own server-side
// check — see that function's header for why a client-side-only gate isn't
// enough here.
export default function AccessRolesScreen() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isAdminOrManager = profile != null && (profile.role === 'admin' || profile.role === 'manager');
  const isAdmin = profile != null && profile.role === 'admin';

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changeRoleUser, setChangeRoleUser] = useState<ManagedUser | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<ManagedUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!isAdminOrManager) return;
    try {
      setError(null);
      const [u, p] = await Promise.all([fetchAllUsers(), fetchStaffProjects()]);
      setUsers(u);
      setProjects(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isAdminOrManager]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const counts = useMemo(() => {
    const byRole: Record<string, number> = {};
    for (const u of users) byRole[u.role] = (byRole[u.role] ?? 0) + 1;
    return byRole;
  }, [users]);

  if (!isAdminOrManager) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <View className="px-5 pt-4 pb-3 bg-white border-b border-neutral-100 flex-row items-center justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-lg font-bold text-neutral-900">Access & Roles</Text>
          <Text className="text-xs text-neutral-400 mt-0.5">
            {users.length} user{users.length === 1 ? '' : 's'}
            {Object.entries(counts).map(([r, c]) => ` · ${c} ${roleLabel(r as UserRole)}`).join('')}
          </Text>
        </View>
        <Pressable onPress={() => setCreateOpen(true)} className="w-9 h-9 rounded-full bg-brand-navy items-center justify-center">
          <Ionicons name="add" size={20} color="#fff" />
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-red-600 text-center mb-3">Couldn&apos;t load users: {error}</Text>
          <Pressable
            onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }}
            className="px-4 py-2 rounded-lg bg-white border border-red-200"
          >
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      ) : (
        // FlatList, not a ScrollView + .map() — fetchAllUsers() returns
        // every account in the org via an edge function with no
        // pagination (unbounded by design, so no real user is ever
        // silently hidden), so this only renders the rows actually on
        // screen instead of the whole org roster at once.
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          contentContainerClassName="px-4 pt-4 pb-8 flex-grow"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
          ListEmptyComponent={<EmptyState title="No users yet" subtitle="Create the first account with the + button above." />}
          renderItem={({ item }) => <UserRow user={item} onChangeRole={setChangeRoleUser} />}
        />
      )}

      <ChangeRoleSheet
        user={changeRoleUser}
        isAdmin={isAdmin}
        onClose={() => setChangeRoleUser(null)}
        onChanged={(userId, role) => setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)))}
        onResetPassword={setResetPasswordUser}
        onStatusChanged={(userId, status) => setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, status, isActive: status === 'active' } : u)))}
      />
      <ResetPasswordSheet
        user={resetPasswordUser}
        onClose={() => setResetPasswordUser(null)}
      />
      <CreateUserSheet
        visible={createOpen}
        projects={projects}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
      />
    </View>
  );
}
