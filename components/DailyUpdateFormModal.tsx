import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './ui/Card';
import { SLOT_LABELS, WEATHER_OPTIONS, type DailyUpdateInput, type DailyUpdateSlot, type WeatherCondition } from '../lib/dailyUpdates';

export interface PickedPhoto {
  uri: string;
  base64: string;
  contentType: 'image/jpeg' | 'image/png';
}

const MAX_PHOTOS = 5;
// 0.5 keeps a typical phone photo well under the upload-dpr-photo Edge
// Function's base64 size cap without needing a separate resize step —
// good enough for a progress-documentation photo, not archival quality.
const PHOTO_QUALITY = 0.5;

const WEATHER_LABELS: Record<WeatherCondition, string> = {
  SUNNY: 'Sunny',
  CLOUDY: 'Cloudy',
  RAINY: 'Rainy',
  WINDY: 'Windy',
  OTHER: 'Other',
};

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text className="text-xs text-neutral-400 mb-1">
      {children}
      {required ? ' *' : ' (optional)'}
    </Text>
  );
}

const inputClass = 'border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3';

// reportDate isn't a field here at all: every submission is dated today
// server-side (submitDailyUpdate), matching how this is meant to be filled
// out live from site, not backdated. Photos (Take Photo / Choose from
// Library, up to MAX_PHOTOS) upload at submit time via the parent's onSave
// — a failed photo upload fails the whole submission rather than leaving a
// text-only report behind (the "simple" approach chosen over a full
// offline queue for this pass).
export function DailyUpdateFormModal({
  slot,
  onClose,
  onSave,
}: {
  slot: DailyUpdateSlot;
  onClose: () => void;
  onSave: (input: DailyUpdateInput, photos: PickedPhoto[]) => Promise<void>;
}) {
  const [workType, setWorkType] = useState('');
  const [workDescription, setWorkDescription] = useState('');
  const [sftCompleted, setSftCompleted] = useState('');
  const [workforceCount, setWorkforceCount] = useState('');
  const [weatherCondition, setWeatherCondition] = useState<WeatherCondition | null>(null);
  const [materialsUsed, setMaterialsUsed] = useState('');
  const [equipmentUsed, setEquipmentUsed] = useState('');
  const [siteIssues, setSiteIssues] = useState('');
  const [safetyObservations, setSafetyObservations] = useState('');
  const [visitorsOnSite, setVisitorsOnSite] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addAsset(asset: ImagePicker.ImagePickerAsset) {
    if (!asset.base64) return;
    const contentType: PickedPhoto['contentType'] = asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    setPhotos((prev) => [...prev, { uri: asset.uri, base64: asset.base64!, contentType }].slice(0, MAX_PHOTOS));
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera permission needed', 'Allow camera access to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: PHOTO_QUALITY, base64: true });
    if (!result.canceled) addAsset(result.assets[0]);
  }

  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photo library permission needed', 'Allow photo access to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: PHOTO_QUALITY,
      base64: true,
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
    });
    if (!result.canceled) result.assets.forEach(addAsset);
  }

  function removePhoto(uri: string) {
    setPhotos((prev) => prev.filter((p) => p.uri !== uri));
  }

  async function handleSave() {
    if (!workType.trim() || !workDescription.trim()) {
      setError('Work Type and Work Description are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          workType: workType.trim(),
          workDescription: workDescription.trim(),
          sftCompleted: sftCompleted.trim() ? Number(sftCompleted) : null,
          workforceCount: workforceCount.trim() ? Number.parseInt(workforceCount, 10) : null,
          weatherCondition,
          materialsUsed: materialsUsed.trim() || null,
          equipmentUsed: equipmentUsed.trim() || null,
          siteIssues: siteIssues.trim() || null,
          safetyObservations: safetyObservations.trim() || null,
          visitorsOnSite: visitorsOnSite.trim() || null,
          remarks: remarks.trim() || null,
        },
        photos
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this update');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 420, maxHeight: '88%' }}>
          <Card>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-sm font-bold text-neutral-900 mb-0.5">New Daily Update</Text>
              <Text className="text-xs text-neutral-400 mb-3">{SLOT_LABELS[slot]} update</Text>

              {error && (
                <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
                  <Text className="text-xs text-red-600">{error}</Text>
                </View>
              )}

              <FieldLabel required>Work Type</FieldLabel>
              <TextInput value={workType} onChangeText={setWorkType} placeholder="e.g. Civil Works" className={inputClass} />

              <FieldLabel required>Work Description</FieldLabel>
              <TextInput
                value={workDescription}
                onChangeText={setWorkDescription}
                placeholder="What was done today"
                multiline
                numberOfLines={3}
                className={inputClass}
                style={{ minHeight: 70, textAlignVertical: 'top' }}
              />

              <FieldLabel>Photos</FieldLabel>
              <View className="flex-row flex-wrap gap-2 mb-3">
                {photos.map((p) => (
                  <View key={p.uri} style={{ width: 64, height: 64 }}>
                    <Image source={{ uri: p.uri }} style={{ width: 64, height: 64, borderRadius: 8 }} />
                    <Pressable
                      onPress={() => removePhoto(p.uri)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neutral-900 items-center justify-center"
                    >
                      <Ionicons name="close" size={12} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <>
                    <Pressable
                      onPress={takePhoto}
                      className="w-16 h-16 rounded-lg border border-dashed border-neutral-300 items-center justify-center"
                    >
                      <Ionicons name="camera-outline" size={20} color="#737373" />
                    </Pressable>
                    <Pressable
                      onPress={pickFromLibrary}
                      className="w-16 h-16 rounded-lg border border-dashed border-neutral-300 items-center justify-center"
                    >
                      <Ionicons name="images-outline" size={20} color="#737373" />
                    </Pressable>
                  </>
                )}
              </View>

              <View className="flex-row gap-2">
                <View className="flex-1">
                  <FieldLabel>SFT Completed</FieldLabel>
                  <TextInput value={sftCompleted} onChangeText={setSftCompleted} keyboardType="decimal-pad" className={inputClass} />
                </View>
                <View className="flex-1">
                  <FieldLabel>Workforce Count</FieldLabel>
                  <TextInput value={workforceCount} onChangeText={setWorkforceCount} keyboardType="number-pad" className={inputClass} />
                </View>
              </View>

              <FieldLabel>Weather</FieldLabel>
              <View className="flex-row flex-wrap gap-2 mb-3">
                {WEATHER_OPTIONS.map((w) => (
                  <Pressable
                    key={w}
                    onPress={() => setWeatherCondition((v) => (v === w ? null : w))}
                    className="px-3 py-1.5 rounded-full border"
                    style={{
                      backgroundColor: weatherCondition === w ? '#0F1F33' : '#fff',
                      borderColor: weatherCondition === w ? '#0F1F33' : '#E5E5E5',
                    }}
                  >
                    <Text className="text-xs font-semibold" style={{ color: weatherCondition === w ? '#fff' : '#525252' }}>
                      {WEATHER_LABELS[w]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <FieldLabel>Materials Used</FieldLabel>
              <TextInput value={materialsUsed} onChangeText={setMaterialsUsed} multiline className={inputClass} style={{ minHeight: 50, textAlignVertical: 'top' }} />

              <FieldLabel>Equipment Used</FieldLabel>
              <TextInput value={equipmentUsed} onChangeText={setEquipmentUsed} multiline className={inputClass} style={{ minHeight: 50, textAlignVertical: 'top' }} />

              <FieldLabel>Site Issues</FieldLabel>
              <TextInput value={siteIssues} onChangeText={setSiteIssues} multiline className={inputClass} style={{ minHeight: 50, textAlignVertical: 'top' }} />

              <FieldLabel>Safety Observations</FieldLabel>
              <TextInput value={safetyObservations} onChangeText={setSafetyObservations} multiline className={inputClass} style={{ minHeight: 50, textAlignVertical: 'top' }} />

              <FieldLabel>Visitors On Site</FieldLabel>
              <TextInput value={visitorsOnSite} onChangeText={setVisitorsOnSite} className={inputClass} />

              <FieldLabel>Remarks</FieldLabel>
              <TextInput value={remarks} onChangeText={setRemarks} multiline className={inputClass} style={{ minHeight: 50, textAlignVertical: 'top' }} />
            </ScrollView>

            <View className="flex-row justify-end gap-2 mt-1">
              <Pressable onPress={onClose} disabled={saving} className="px-3.5 py-2 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSave} disabled={saving} className="px-3.5 py-2 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
                {saving && <ActivityIndicator size="small" color="#fff" />}
                <Text className="text-xs font-semibold text-white">Submit</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
