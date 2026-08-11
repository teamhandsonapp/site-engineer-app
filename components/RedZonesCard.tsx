import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createRestrictedZone,
  fetchRestrictedZonesForAdmin,
  setRestrictedZoneActive,
  updateRestrictedZone,
  type AdminRestrictedZone,
  type RestrictedZoneInput,
} from '../lib/locationTracking/restrictedZones';
import { Card } from './ui/Card';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { SiteLocationMapPicker } from './SiteLocationMapPicker';

const INPUT_CLASS = 'border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900';
// Same neutral default center as SettingsScreen's own Site Location map —
// nothing site-specific to seed a brand-new zone's pin with.
const DEFAULT_LAT = 20.5937;
const DEFAULT_LNG = 78.9629;
// Matches UpdateProjectLocationSchema's own radius ceiling (admin-web's
// Site Location save) — a "restricted zone" bigger than this reads as a
// data-entry mistake (a typo'd extra digit), not a real no-go area, so this
// flags rather than silently accepting it.
const MAX_RADIUS_METERS = 5000;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mb-3">
      <Text className="text-xs text-neutral-400 mb-1.5">{label}</Text>
      {children}
    </View>
  );
}

const SEVERITY_OPTIONS: { value: 'warning' | 'critical'; label: string; color: string }[] = [
  { value: 'warning', label: 'Warning', color: '#B45309' },
  { value: 'critical', label: 'Critical', color: '#DC2626' },
];

function SeverityPicker({ value, onChange }: { value: 'warning' | 'critical'; onChange: (v: 'warning' | 'critical') => void }) {
  return (
    <View className="flex-row gap-2">
      {SEVERITY_OPTIONS.map((opt) => (
        <Pressable
          key={opt.value}
          onPress={() => onChange(opt.value)}
          className="flex-1 py-2.5 rounded-lg border items-center"
          style={{
            backgroundColor: value === opt.value ? opt.color : '#fff',
            borderColor: value === opt.value ? opt.color : '#E5E7EB',
          }}
        >
          <Text className="text-xs font-bold" style={{ color: value === opt.value ? '#fff' : '#6B7280' }}>{opt.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

interface ZoneFormState {
  name: string;
  latInput: string;
  lngInput: string;
  radiusInput: string;
  severity: 'warning' | 'critical';
}

function blankForm(): ZoneFormState {
  return { name: '', latInput: '', lngInput: '', radiusInput: '', severity: 'warning' };
}

function formFromZone(zone: AdminRestrictedZone): ZoneFormState {
  return {
    name: zone.name,
    latInput: String(zone.latitude),
    lngInput: String(zone.longitude),
    radiusInput: String(zone.radiusMeters),
    severity: zone.severity,
  };
}

// Validates + parses a ZoneFormState into a RestrictedZoneInput, or returns
// an error string — same bounds as admin-web's UpdateProjectLocationSchema
// (lat/lng ranges, sane radius ceiling), since this is the same kind of
// geofence-circle data, just a different table.
function parseForm(form: ZoneFormState): { input: RestrictedZoneInput } | { error: string } {
  if (!form.name.trim()) return { error: 'Zone name is required.' };
  const lat = Number(form.latInput);
  const lng = Number(form.lngInput);
  const radius = Number(form.radiusInput);
  if (form.latInput.trim() === '' || Number.isNaN(lat)) return { error: 'Latitude must be a number.' };
  if (form.lngInput.trim() === '' || Number.isNaN(lng)) return { error: 'Longitude must be a number.' };
  if (form.radiusInput.trim() === '' || Number.isNaN(radius)) return { error: 'Radius must be a number.' };
  if (lat < -90 || lat > 90) return { error: 'Latitude must be between -90 and 90.' };
  if (lng < -180 || lng > 180) return { error: 'Longitude must be between -180 and 180.' };
  if (radius <= 0) return { error: 'Radius must be a positive number.' };
  if (radius > MAX_RADIUS_METERS) return { error: `Radius must be ${MAX_RADIUS_METERS}m or less — double-check this isn't a typo.` };
  return { input: { name: form.name.trim(), latitude: lat, longitude: lng, radiusMeters: Math.round(radius), severity: form.severity } };
}

function ZoneRow({
  zone,
  onEdit,
  onToggleActive,
  toggling,
}: {
  zone: AdminRestrictedZone;
  onEdit: () => void;
  onToggleActive: () => void;
  toggling: boolean;
}) {
  const severityColor = zone.severity === 'critical' ? '#DC2626' : '#B45309';
  return (
    <View className={`py-3 border-b border-neutral-100 ${zone.active ? '' : 'opacity-50'}`}>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-sm font-bold text-neutral-900 flex-1" numberOfLines={1}>{zone.name}</Text>
        <View className="flex-row items-center gap-1.5">
          <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${severityColor}1A` }}>
            <Text className="text-2xs font-bold" style={{ color: severityColor }}>{zone.severity === 'critical' ? 'Critical' : 'Warning'}</Text>
          </View>
          {!zone.active && (
            <View className="px-2 py-0.5 rounded-full bg-neutral-100">
              <Text className="text-2xs font-bold text-neutral-500">Inactive</Text>
            </View>
          )}
        </View>
      </View>
      <Text className="text-2xs text-neutral-400 mb-2">
        {zone.latitude.toFixed(6)}, {zone.longitude.toFixed(6)} · {zone.radiusMeters}m radius
      </Text>
      <View className="flex-row gap-2">
        <Pressable onPress={onEdit} className="px-3 py-1.5 rounded-lg bg-neutral-50 flex-row items-center gap-1">
          <Ionicons name="pencil-outline" size={12} color="#0F1F33" />
          <Text className="text-2xs font-semibold text-neutral-700">Edit</Text>
        </Pressable>
        <Pressable onPress={onToggleActive} disabled={toggling} className="px-3 py-1.5 rounded-lg bg-neutral-50 flex-row items-center gap-1" style={{ opacity: toggling ? 0.6 : 1 }}>
          {toggling ? <ActivityIndicator size="small" color="#0F1F33" /> : (
            <Ionicons name={zone.active ? 'close-circle-outline' : 'refresh-outline'} size={12} color="#0F1F33" />
          )}
          <Text className="text-2xs font-semibold text-neutral-700">{zone.active ? 'Deactivate' : 'Reactivate'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Mobile-native equivalent of admin-web's RestrictedZonesCard — same
// restricted_zones table, same fields (name, lat/lng, radius, severity),
// same soft-delete-via-active convention, gated by the same admin/manager
// RLS write policies (see add-restricted-zones-mobile-write-rls.sql) rather
// than admin-web's direct-Prisma bypass. Placed directly below Site
// Location on the Settings screen — a red zone is a per-project concept
// exactly like the site boundary, just inverted (don't-enter instead of
// stay-inside) and unbounded in count.
export function RedZonesCard({ projectId, userId }: { projectId: string; userId: string }) {
  const [zones, setZones] = useState<AdminRestrictedZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AdminRestrictedZone | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<AdminRestrictedZone | null>(null);
  const [form, setForm] = useState<ZoneFormState>(blankForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setZones(await fetchRestrictedZonesForAdmin(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  function openAddForm() {
    setEditingZone(null);
    setForm(blankForm());
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(zone: AdminRestrictedZone) {
    setEditingZone(zone);
    setForm(formFromZone(zone));
    setFormError(null);
    setFormOpen(true);
  }

  async function saveForm() {
    const parsed = parseForm(form);
    if ('error' in parsed) {
      setFormError(parsed.error);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingZone) {
        await updateRestrictedZone(editingZone.id, parsed.input);
      } else {
        await createRestrictedZone(projectId, userId, parsed.input);
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function confirmToggleActive() {
    if (!deactivateTarget) return;
    const zone = deactivateTarget;
    setDeactivateTarget(null);
    setTogglingId(zone.id);
    try {
      await setRestrictedZoneActive(zone.id, !zone.active);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingId(null);
    }
  }

  function handleToggleActive(zone: AdminRestrictedZone) {
    // Deactivating is the one-way, "stops protecting this area" action —
    // worth a confirm. Reactivating is harmless (just resumes protection),
    // so it goes straight through.
    if (zone.active) {
      setDeactivateTarget(zone);
    } else {
      setTogglingId(zone.id);
      setRestrictedZoneActive(zone.id, true)
        .then(load)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setTogglingId(null));
    }
  }

  const mapLat = Number.isFinite(Number(form.latInput)) && form.latInput.trim() !== '' ? Number(form.latInput) : DEFAULT_LAT;
  const mapLng = Number.isFinite(Number(form.lngInput)) && form.lngInput.trim() !== '' ? Number(form.lngInput) : DEFAULT_LNG;
  const mapRadius = Number.isFinite(Number(form.radiusInput)) && form.radiusInput.trim() !== '' ? Number(form.radiusInput) : null;

  return (
    <Card className="mt-4">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-sm font-bold text-neutral-900">Red Zones</Text>
        {!formOpen && (
          <Pressable onPress={openAddForm} className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-50">
            <Ionicons name="add" size={14} color="#0F1F33" />
            <Text className="text-2xs font-semibold text-neutral-700">Add Red Zone</Text>
          </Pressable>
        )}
      </View>
      <Text className="text-2xs text-neutral-400 mb-3">
        Areas a site engineer on this project should never enter (a blasting area, a neighboring
        property line). Any number allowed — separate from the single Site Location boundary above.
      </Text>

      {error && (
        <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
          <Text className="text-xs text-red-600">{error}</Text>
        </View>
      )}

      {formOpen && (
        <View className="rounded-xl border border-neutral-200 p-3 mb-3">
          <Text className="text-xs font-bold text-neutral-900 mb-3">{editingZone ? 'Edit Red Zone' : 'New Red Zone'}</Text>
          {formError && (
            <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
              <Text className="text-xs text-red-600">{formError}</Text>
            </View>
          )}
          <Field label="Zone name">
            <TextInput value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="e.g. Istana Villas" className={INPUT_CLASS} />
          </Field>

          <Text className="text-2xs text-neutral-400 mb-2">Drag the pin, tap anywhere on the map, or type exact coordinates below.</Text>
          <View className="mb-3">
            <SiteLocationMapPicker
              latitude={mapLat}
              longitude={mapLng}
              radiusMeters={mapRadius}
              height={200}
              onChange={(lat, lng) => setForm((f) => ({ ...f, latInput: lat.toFixed(7), lngInput: lng.toFixed(7) }))}
            />
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field label="Latitude">
                <TextInput
                  value={form.latInput}
                  onChangeText={(v) => setForm((f) => ({ ...f, latInput: v }))}
                  keyboardType={Platform.select({ ios: 'numbers-and-punctuation', android: 'numeric' })}
                  placeholder="e.g. 17.3757712"
                  className={INPUT_CLASS}
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Longitude">
                <TextInput
                  value={form.lngInput}
                  onChangeText={(v) => setForm((f) => ({ ...f, lngInput: v }))}
                  keyboardType={Platform.select({ ios: 'numbers-and-punctuation', android: 'numeric' })}
                  placeholder="e.g. 78.3234603"
                  className={INPUT_CLASS}
                />
              </Field>
            </View>
          </View>

          <Field label="Radius (meters)">
            <TextInput
              value={form.radiusInput}
              onChangeText={(v) => setForm((f) => ({ ...f, radiusInput: v }))}
              keyboardType="numeric"
              placeholder="e.g. 250"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Severity">
            <SeverityPicker value={form.severity} onChange={(v) => setForm((f) => ({ ...f, severity: v }))} />
          </Field>

          <View className="flex-row gap-2 mt-1">
            <Pressable onPress={() => setFormOpen(false)} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-neutral-100 items-center">
              <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
            </Pressable>
            <Pressable onPress={saveForm} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-brand-navy items-center flex-row justify-center gap-2" style={{ opacity: saving ? 0.7 : 1 }}>
              {saving && <ActivityIndicator size="small" color="#fff" />}
              <Text className="text-xs font-semibold text-white">{saving ? 'Saving…' : 'Save Zone'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {loading ? (
        <View className="py-6 items-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : zones.length === 0 ? (
        !formOpen && <Text className="text-xs text-neutral-400 py-2">No red zones set for this project yet.</Text>
      ) : (
        zones.map((zone) => (
          <ZoneRow
            key={zone.id}
            zone={zone}
            onEdit={() => openEditForm(zone)}
            onToggleActive={() => handleToggleActive(zone)}
            toggling={togglingId === zone.id}
          />
        ))
      )}

      {deactivateTarget && (
        <ConfirmDialog
          title="Deactivate this red zone?"
          description={`"${deactivateTarget.name}" will stop being monitored — engineers can enter it without triggering an alert. Its past alert history stays intact, and you can reactivate it any time.`}
          confirmLabel="Deactivate"
          variant="danger"
          onConfirm={confirmToggleActive}
          onCancel={() => setDeactivateTarget(null)}
        />
      )}
    </Card>
  );
}
