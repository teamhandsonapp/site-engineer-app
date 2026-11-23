import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { Text, TextInput } from '../../components/ui/AppText';
import { KeyboardAvoider } from '../../components/ui/KeyboardAvoider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchProjectSettings, updateProjectSettings } from '../../lib/projectSettings';
import { createDepartment, deleteDepartment, fetchDepartments, renameDepartment, type Department } from '../../lib/departments';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SiteLocationMapPicker } from '../../components/SiteLocationMapPicker';
import { RedZonesCard } from '../../components/RedZonesCard';
import { LOCATION_FEATURES_ENABLED } from '../../lib/featureFlags';
import { DevicesPanel } from '../../components/DevicesPanel';
import { TesterReminderCard } from '../../components/TesterReminderCard';
import { AppUpdateCard } from '../../components/AppUpdateCard';
import { SendNotificationCard } from '../../components/SendNotificationCard';

const INPUT_CLASS = 'border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900';

// No site location on record yet — same neutral "center of India at a low
// zoom" starting point as admin-web's SiteLocationCard (not a geocoding
// guess from the project's address), so the map has somewhere sensible to
// show before a real pin is ever dropped.
const DEFAULT_LAT = 20.5937;
const DEFAULT_LNG = 78.9629;

// Same local Toast + showToast pattern as components/home/ClientHome.tsx —
// a transient success/error readout for the RESULT of an action (the save
// itself), distinct from the persistent red banner further down which is
// reserved for load failures and pre-submit form validation.
function Toast({ toast }: { toast: { type: 'success' | 'error'; message: string } | null }) {
  // Sits above BottomTabBar, which already clears the inset (batch 5).
  const bottom = 36;
  if (!toast) return null;
  const isSuccess = toast.type === 'success';
  return (
    <View
      className="absolute left-4 right-4 rounded-xl px-4 py-3 flex-row items-center gap-2"
      style={{
        bottom,
        backgroundColor: isSuccess ? '#0F1F33' : '#DC2626',
        elevation: 4,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <Ionicons name={isSuccess ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
      <Text className="text-sm font-semibold text-white flex-1">{toast.message}</Text>
    </View>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-4">
      <Text className="text-xs text-neutral-400 mb-1.5">{label}</Text>
      {children}
    </View>
  );
}

// One row in the new Departments section — rename inline (tap the pencil,
// edit in place, tap the checkmark) or delete (guarded: the trash icon is
// disabled whenever taskCount > 0, since deleting a department out from
// under real tasks would silently null their work_id rather than being
// blocked — see lib/departments.ts's own deleteDepartment comment on why
// this guard lives in the UI, not the DB).
function DepartmentRow({ department, onChanged }: { department: Department; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(department.name);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function handleSaveRename() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === department.name) {
      setEditing(false);
      setNameInput(department.name);
      return;
    }
    setSaving(true);
    setRowError(null);
    try {
      await renameDepartment(department.id, trimmed);
      setEditing(false);
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteDepartment(department.id);
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
      setConfirmDelete(false);
      setDeleting(false);
    }
  }

  const canDelete = department.taskCount === 0;

  return (
    <View className="mb-2">
      <View className="flex-row items-center gap-2.5 rounded-lg bg-neutral-50 px-3 py-2.5">
        <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: department.color }} />
        {editing ? (
          <TextInput
            value={nameInput}
            onChangeText={setNameInput}
            autoFocus
            className="flex-1 border border-neutral-200 rounded-md px-2 py-1.5 text-sm text-neutral-900 bg-white"
          />
        ) : (
          <View className="flex-1">
            <Text className="text-sm font-semibold text-neutral-800">{department.name}</Text>
            <Text className="text-2xs text-neutral-400 mt-0.5">
              {department.code} · {department.taskCount} task{department.taskCount === 1 ? '' : 's'}
            </Text>
          </View>
        )}
        {editing ? (
          <View className="flex-row items-center gap-3">
            {saving ? (
              <ActivityIndicator size="small" color="#0F1F33" />
            ) : (
              <Pressable onPress={handleSaveRename} hitSlop={8}>
                <Ionicons name="checkmark" size={18} color="#16A34A" />
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                setEditing(false);
                setNameInput(department.name);
              }}
              hitSlop={8}
            >
              <Ionicons name="close" size={18} color="#9CA3AF" />
            </Pressable>
          </View>
        ) : (
          <View className="flex-row items-center gap-3">
            <Pressable onPress={() => setEditing(true)} hitSlop={8}>
              <Ionicons name="pencil-outline" size={16} color="#6B7280" />
            </Pressable>
            <Pressable onPress={() => canDelete && setConfirmDelete(true)} hitSlop={8} disabled={!canDelete}>
              <Ionicons name="trash-outline" size={16} color={canDelete ? '#DC2626' : '#D1D5DB'} />
            </Pressable>
          </View>
        )}
      </View>
      {!canDelete && !editing && (
        <Text className="text-2xs text-neutral-400 mt-1 ml-1">Reassign its {department.taskCount} task{department.taskCount === 1 ? '' : 's'} before deleting.</Text>
      )}
      {rowError && <Text className="text-2xs text-red-600 mt-1 ml-1">{rowError}</Text>}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this department?"
          description={`"${department.name}" will be permanently removed from this project.`}
          confirmLabel="Delete"
          variant="danger"
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </View>
  );
}

// The mobile home for editing Project.name/address/siteLatitude/
// siteLongitude/siteRadiusMeters — the SAME columns admin-web's
// ProjectInfoEditor + SiteLocationCard manage (see
// admin-web/app/(app)/projects/[projectId]/settings/page.tsx), not a
// mobile-only copy. Same draggable-pin + radius-circle map as admin-web
// too (see components/SiteLocationMapPicker.tsx). The pin is placed by hand —
// the app no longer reads the device's own location.
export default function SettingsScreen() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isAdminOrManager = profile != null && (profile.role === 'admin' || profile.role === 'manager');
  const isAdmin = profile?.role === 'admin';
  const { selectedProjectId, projects } = useProject();

  const [loading, setLoading] = useState(true);
  // Settings tabs (2026-11-21, client): project info, and who's logged in + sending notifications.
  const [tab, setTab] = useState<'project' | 'devices'>('project');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(type: 'success' | 'error', message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [floorCountInput, setFloorCountInput] = useState('');
  const [roomCountInput, setRoomCountInput] = useState('');
  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const [radiusInput, setRadiusInput] = useState('');

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  const [newDeptName, setNewDeptName] = useState('');
  const [addingDept, setAddingDept] = useState(false);

  const load = useCallback(async () => {
    if (!isAdminOrManager || !selectedProjectId) return;
    try {
      setError(null);
      const settings = await fetchProjectSettings(selectedProjectId);
      setName(settings.name);
      setAddress(settings.address ?? '');
      setFloorCountInput(settings.floorCount != null ? String(settings.floorCount) : '');
      setRoomCountInput(settings.roomCount != null ? String(settings.roomCount) : '');
      setLatInput(settings.siteLatitude != null ? String(settings.siteLatitude) : '');
      setLngInput(settings.siteLongitude != null ? String(settings.siteLongitude) : '');
      setRadiusInput(settings.siteRadiusMeters != null ? String(settings.siteRadiusMeters) : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isAdminOrManager, selectedProjectId]);

  const loadDepartments = useCallback(async () => {
    if (!isAdminOrManager || !selectedProjectId) return;
    try {
      setDepartmentsError(null);
      setDepartments(await fetchDepartments(selectedProjectId));
    } catch (err) {
      setDepartmentsError(err instanceof Error ? err.message : String(err));
    } finally {
      setDepartmentsLoading(false);
    }
  }, [isAdminOrManager, selectedProjectId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    setDepartmentsLoading(true);
    loadDepartments();
  }, [loadDepartments]);

  async function handleAddDepartment() {
    const trimmed = newDeptName.trim();
    if (!trimmed || !selectedProjectId) return;
    setAddingDept(true);
    setDepartmentsError(null);
    try {
      await createDepartment(selectedProjectId, trimmed);
      setNewDeptName('');
      await loadDepartments();
    } catch (err) {
      setDepartmentsError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingDept(false);
    }
  }


  async function save() {
    if (!selectedProjectId) return;
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }

    const lat = latInput.trim() === '' ? null : Number(latInput);
    const lng = lngInput.trim() === '' ? null : Number(lngInput);
    const radius = radiusInput.trim() === '' ? null : Number(radiusInput);
    const floorCount = floorCountInput.trim() === '' ? null : Number(floorCountInput);
    const roomCount = roomCountInput.trim() === '' ? null : Number(roomCountInput);

    if ((lat != null && Number.isNaN(lat)) || (lng != null && Number.isNaN(lng)) || (radius != null && Number.isNaN(radius))) {
      setError('Latitude, longitude, and radius must be numbers');
      return;
    }
    if ((floorCount != null && (Number.isNaN(floorCount) || floorCount < 0)) || (roomCount != null && (Number.isNaN(roomCount) || roomCount < 0))) {
      setError('No. of Floors and No. of Rooms must be 0 or more');
      return;
    }
    if (lat != null && (lat < -90 || lat > 90)) {
      setError('Latitude must be between -90 and 90');
      return;
    }
    if (lng != null && (lng < -180 || lng > 180)) {
      setError('Longitude must be between -180 and 180');
      return;
    }
    if ((lat == null) !== (lng == null)) {
      setError('Set both latitude and longitude, or leave both blank');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateProjectSettings(selectedProjectId, {
        name: name.trim(),
        address: address.trim() || null,
        floorCount,
        roomCount,
        siteLatitude: lat,
        siteLongitude: lng,
        siteRadiusMeters: radius,
      });
      showToast('success', 'Settings saved');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!isAdminOrManager) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  const projectName = selectedProjectId ? projects.find((p) => p.id === selectedProjectId)?.name : null;

  // Fed to the map so it always has a valid position to show, even while
  // the fields are blank (a brand-new project) or mid-edit (a partial/
  // invalid number) — the map itself is just a live preview of whatever is
  // parseable right now, save() is still the one place that actually
  // validates before writing.
  const mapLat = Number.isFinite(Number(latInput)) && latInput.trim() !== '' ? Number(latInput) : DEFAULT_LAT;
  const mapLng = Number.isFinite(Number(lngInput)) && lngInput.trim() !== '' ? Number(lngInput) : DEFAULT_LNG;
  const mapRadius = Number.isFinite(Number(radiusInput)) && radiusInput.trim() !== '' ? Number(radiusInput) : null;

  return (
    <KeyboardAvoider style={{ backgroundColor: '#FAFAFA' }}>
      <View className="px-5 pt-4 pb-3 bg-white border-b border-neutral-100">
        <Text className="text-lg font-bold text-neutral-900">Settings</Text>
        {projectName && <Text className="text-xs text-neutral-400 mt-0.5">{projectName}</Text>}
      </View>

      {/* Two tabs (2026-11-21, client). */}
      <View className="flex-row gap-2 px-4 py-3 bg-white border-b border-neutral-100">
        {([
          ['project', 'Project Info', 'business-outline'],
          ['devices', 'Login & Devices', 'phone-portrait-outline'],
        ] as const).map(([key, label, icon]) => {
          const on = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl border ${on ? 'bg-brand-navy border-brand-navy' : 'bg-white border-neutral-200'}`}
            >
              <Ionicons name={icon} size={15} color={on ? '#fff' : '#0F1F33'} />
              <Text className={`text-sm font-semibold ${on ? 'text-white' : 'text-neutral-800'}`}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'devices' ? (
        // Who is logged in on a phone + closed-testing testers, then every
        // way to send a notification — all in this one place.
        <ScrollView contentContainerClassName="px-4 pt-4 pb-10" keyboardShouldPersistTaps="handled">
          <DevicesPanel />
          {isAdmin ? (
            <>
              <View className="flex-row items-center mt-2 mb-2">
                <Ionicons name="notifications-outline" size={15} color="#6B7280" />
                <Text className="text-xs font-bold uppercase tracking-wide text-neutral-500 ml-1.5">Send notifications</Text>
              </View>
              <TesterReminderCard onResult={showToast} />
              <AppUpdateCard onResult={showToast} />
              <SendNotificationCard onResult={showToast} />
            </>
          ) : null}
        </ScrollView>
      ) : !selectedProjectId ? (
        <EmptyState
          icon="folder-open-outline"
          iconColor="#9CA3AF"
          title="No project selected"
          subtitle="Pick a project from the Project Dashboard, then come back here to edit its settings."
        />
      ) : loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <ScrollView contentContainerClassName="px-4 pt-4 pb-10" keyboardShouldPersistTaps="handled">
          {error && (
            <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
              <Text className="text-xs text-red-600">{error}</Text>
            </View>
          )}

          <Card className="mb-4">
            <Text className="text-sm font-bold text-neutral-900 mb-3">Project Info</Text>
            <Field label="Project name">
              <TextInput value={name} onChangeText={setName} className={INPUT_CLASS} />
            </Field>
            <Field label="Address">
              <TextInput
                value={address}
                onChangeText={setAddress}
                multiline
                numberOfLines={2}
                className={INPUT_CLASS}
              />
            </Field>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="No. of Floors">
                  <TextInput
                    value={floorCountInput}
                    onChangeText={setFloorCountInput}
                    keyboardType="number-pad"
                    placeholder="e.g. 4"
                    className={INPUT_CLASS}
                  />
                </Field>
              </View>
              <View className="flex-1">
                <Field label="No. of Rooms">
                  <TextInput
                    value={roomCountInput}
                    onChangeText={setRoomCountInput}
                    keyboardType="number-pad"
                    placeholder="e.g. 24"
                    className={INPUT_CLASS}
                  />
                </Field>
              </View>
            </View>
          </Card>

          <Card className="mb-4">
            <Text className="text-sm font-bold text-neutral-900 mb-1">Departments</Text>
            <Text className="text-2xs text-neutral-400 mb-3">
              The trades working on this project — the same list Task creation, the flowchart&apos;s Department filter, and Reports all read from.
            </Text>

            {departmentsError && (
              <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
                <Text className="text-xs text-red-600">{departmentsError}</Text>
              </View>
            )}

            {departmentsLoading ? (
              <ActivityIndicator color="#0F1F33" style={{ alignSelf: 'flex-start', marginBottom: 8 }} />
            ) : departments.length === 0 ? (
              <Text className="text-xs text-neutral-400 mb-3">No departments yet — add the first one below.</Text>
            ) : (
              departments.map((d) => <DepartmentRow key={d.id} department={d} onChanged={loadDepartments} />)
            )}

            <View className="flex-row gap-2 mt-1">
              <TextInput
                value={newDeptName}
                onChangeText={setNewDeptName}
                onSubmitEditing={handleAddDepartment}
                placeholder="e.g. Landscaping"
                className={`flex-1 ${INPUT_CLASS}`}
              />
              <Pressable
                onPress={handleAddDepartment}
                disabled={addingDept || !newDeptName.trim()}
                className="px-3.5 rounded-lg bg-brand-navy items-center justify-center"
                style={{ opacity: addingDept || !newDeptName.trim() ? 0.5 : 1 }}
              >
                {addingDept ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-sm font-semibold text-white">Add</Text>}
              </Pressable>
            </View>
          </Card>

          <Card>
            {LOCATION_FEATURES_ENABLED && (
            <>
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-sm font-bold text-neutral-900">Site Location</Text>
              {/* "Use current location" removed — the app no longer uses device location. */}
            </View>
            <Text className="text-2xs text-neutral-400 mb-3">
              This is the location every location-tracking feature (permission gate, snapshots, geofence
              exit tracking) measures against for site engineers on this project.
            </Text>

            <Text className="text-2xs text-neutral-400 mb-2">
              Drag the pin, tap anywhere on the map, or type exact coordinates below.
            </Text>
            <View className="mb-4">
              <SiteLocationMapPicker
                latitude={mapLat}
                longitude={mapLng}
                radiusMeters={mapRadius}
                onChange={(lat, lng) => {
                  setLatInput(lat.toFixed(7));
                  setLngInput(lng.toFixed(7));
                }}
              />
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="Latitude">
                  <TextInput
                    value={latInput}
                    onChangeText={setLatInput}
                    keyboardType={Platform.select({ ios: 'numbers-and-punctuation', android: 'numeric' })}
                    placeholder="e.g. 12.9715987"
                    className={INPUT_CLASS}
                  />
                </Field>
              </View>
              <View className="flex-1">
                <Field label="Longitude">
                  <TextInput
                    value={lngInput}
                    onChangeText={setLngInput}
                    keyboardType={Platform.select({ ios: 'numbers-and-punctuation', android: 'numeric' })}
                    placeholder="e.g. 77.5945627"
                    className={INPUT_CLASS}
                  />
                </Field>
              </View>
            </View>

            <Field label="Geofence radius (meters)">
              <TextInput
                value={radiusInput}
                onChangeText={setRadiusInput}
                keyboardType="numeric"
                placeholder="e.g. 100"
                className={INPUT_CLASS}
              />
            </Field>

            </>
            )}
            <Pressable
              onPress={save}
              disabled={saving}
              className="mt-1 px-4 py-2.5 rounded-lg bg-brand-navy items-center flex-row justify-center gap-2"
              style={{ opacity: saving ? 0.7 : 1 }}
            >
              {saving && <ActivityIndicator size="small" color="#fff" />}
              <Text className="text-sm font-semibold text-white">{saving ? 'Saving…' : 'Save Settings'}</Text>
            </Pressable>
          </Card>

          {LOCATION_FEATURES_ENABLED && profile && <RedZonesCard projectId={selectedProjectId} userId={profile.id} />}
        </ScrollView>
      )}
      <Toast toast={toast} />
    </KeyboardAvoider>
  );
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
