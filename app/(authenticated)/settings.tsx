import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchProjectSettings, updateProjectSettings } from '../../lib/projectSettings';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { SiteLocationMapPicker } from '../../components/SiteLocationMapPicker';
import { RedZonesCard } from '../../components/RedZonesCard';

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
  if (!toast) return null;
  const isSuccess = toast.type === 'success';
  return (
    <View
      className="absolute left-4 right-4 bottom-6 rounded-xl px-4 py-3 flex-row items-center gap-2"
      style={{
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

// The mobile home for editing Project.name/address/siteLatitude/
// siteLongitude/siteRadiusMeters — the SAME columns admin-web's
// ProjectInfoEditor + SiteLocationCard manage (see
// admin-web/app/(app)/projects/[projectId]/settings/page.tsx), not a
// mobile-only copy. Same draggable-pin + radius-circle map as admin-web
// too (see components/SiteLocationMapPicker.tsx), plus a one-shot "Use my
// current location" button as its own affordance since expo-location is
// already a dependency for Parts 2-4 of this same feature.
export default function SettingsScreen() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isAdminOrManager = profile != null && (profile.role === 'admin' || profile.role === 'manager');
  const { selectedProjectId, projects } = useProject();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(type: 'success' | 'error', message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const [radiusInput, setRadiusInput] = useState('');

  const load = useCallback(async () => {
    if (!isAdminOrManager || !selectedProjectId) return;
    try {
      setError(null);
      const settings = await fetchProjectSettings(selectedProjectId);
      setName(settings.name);
      setAddress(settings.address ?? '');
      setLatInput(settings.siteLatitude != null ? String(settings.siteLatitude) : '');
      setLngInput(settings.siteLongitude != null ? String(settings.siteLongitude) : '');
      setRadiusInput(settings.siteRadiusMeters != null ? String(settings.siteRadiusMeters) : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isAdminOrManager, selectedProjectId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function useCurrentLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Allow location access to fill in coordinates automatically.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLatInput(position.coords.latitude.toFixed(7));
      setLngInput(position.coords.longitude.toFixed(7));
    } catch (err) {
      Alert.alert('Could not get location', err instanceof Error ? err.message : String(err));
    } finally {
      setLocating(false);
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

    if ((lat != null && Number.isNaN(lat)) || (lng != null && Number.isNaN(lng)) || (radius != null && Number.isNaN(radius))) {
      setError('Latitude, longitude, and radius must be numbers');
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
    <View className="flex-1 bg-neutral-50">
      <View className="px-5 pt-4 pb-3 bg-white border-b border-neutral-100">
        <Text className="text-lg font-bold text-neutral-900">Settings</Text>
        {projectName && <Text className="text-xs text-neutral-400 mt-0.5">{projectName}</Text>}
      </View>

      {!selectedProjectId ? (
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
          </Card>

          <Card>
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-sm font-bold text-neutral-900">Site Location</Text>
              <Pressable
                onPress={useCurrentLocation}
                disabled={locating}
                className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-50"
              >
                {locating ? (
                  <ActivityIndicator size="small" color="#0F1F33" />
                ) : (
                  <Ionicons name="locate-outline" size={14} color="#0F1F33" />
                )}
                <Text className="text-2xs font-semibold text-neutral-700">Use current location</Text>
              </Pressable>
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

          {profile && <RedZonesCard projectId={selectedProjectId} userId={profile.id} />}
        </ScrollView>
      )}
      <Toast toast={toast} />
    </View>
  );
}
