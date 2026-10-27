import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../lib/AuthContext';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ChecklistItemRow } from '../../components/taskDetail/ChecklistItemRow';
import { DelayPanel } from '../../components/taskDetail/DelayPanel';
import { CATEGORY_LABEL, CATEGORY_LETTER, CATEGORY_COLORS, type CompletionStatus } from '../../lib/taskDetail/constants';
import type { ChecklistItem } from '../../lib/taskDetail/data';
import {
  fetchQualityChecklist,
  fetchSignedChecklistPhotos,
  QUALITY_CATEGORIES,
  QUALITY_DEFAULT_ITEM_LABELS,
  uploadSignedChecklistPhoto,
  type QualityCategory,
  type QualityChecklist,
  type SignedChecklistPhoto,
} from '../../lib/dprChecklist';
import { exportQualityChecklistPdf } from '../../lib/reports/qualityChecklistPdf';
import { fetchGeneralParameterReport, type GeneralParameterReportData } from '../../lib/reports/generalParameterReport';
import { formatDateLabel } from '../../lib/formatTime';

// Placeholder checklist — shown only when the admin hasn't defined any real
// Pre/Construction/Post Construction items for this task yet ("No quality
// checklist defined"), by explicit request, so Generate PDF/Upload Signed
// Checklist have something real to work with in the meantime rather than
// staying disabled. All PENDING (nothing has actually happened yet); the
// fake ids are only ever used locally, never written to the database. No
// on-screen "sample" disclosure, same convention as this app's other dummy
// stand-ins (see GeneralParameterSection.tsx's DUMMY_CONTRACTOR_NAME).

function buildDummyItemsByCategory(): Record<QualityCategory, ChecklistItem[]> {
  const byCategory = {} as Record<QualityCategory, ChecklistItem[]>;
  for (const category of QUALITY_CATEGORIES) {
    byCategory[category] = QUALITY_DEFAULT_ITEM_LABELS[category].map((itemLabel, idx) => ({
      id: `dummy-${category}-${idx}`,
      category,
      itemLabel,
      sortOrder: idx,
      quantityUnit: null,
      quantityValue: null,
      status: 'PENDING' as CompletionStatus,
      hadCompletionRow: false,
      statusChangedAtISO: null,
      issueDate: null,
      isComputedQuantity: false,
      commentCount: 0,
    }));
  }
  return byCategory;
}

// Point 7 — view the admin-defined quality checklist for a task (the same
// dependency_items/dependency_completions data /task/[taskId] already
// shows, just filtered to the 3 quality_* categories and read-only here —
// editing a checklist item's status stays on that screen, this one's job
// is print + signed-photo attach), generate a printable PDF of it, and
// upload a photo of the physically signed copy. Reached from a task's DPR
// row (components/dpr/DprTaskRow.tsx), not from the drawer.
export default function DprChecklistScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  // Same inline check app/project-dashboard.tsx already uses — narrower
  // than "staff" (which also includes senior_site_engineer/site_engineer).
  const isAdminOrManager = profile != null && (profile.role === 'admin' || profile.role === 'manager');

  const [checklist, setChecklist] = useState<QualityChecklist | null>(null);
  const [photos, setPhotos] = useState<SignedChecklistPhoto[]>([]);
  const [delay, setDelay] = useState<GeneralParameterReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    try {
      setError(null);
      const [c, p] = await Promise.all([fetchQualityChecklist(taskId), fetchSignedChecklistPhotos(taskId)]);
      const hasRealItems = QUALITY_CATEGORIES.some((cat) => c.itemsByCategory[cat].length > 0);
      setChecklist(hasRealItems ? c : { ...c, itemsByCategory: buildDummyItemsByCategory() });
      setPhotos(p);
      // Cumulative Pre + Construction delay — admin/manager oversight only
      // (see the Post Construction category's own card below), reusing the
      // existing General Parameter Report calculation for this one task
      // rather than a new formula. Needs the task's projectId, which only
      // fetchQualityChecklist's result carries — fetched as a follow-up,
      // not in the Promise.all above, and skipped entirely for anyone who
      // won't see it.
      setDelay(isAdminOrManager && c.task.projectId ? await fetchGeneralParameterReport(taskId, c.task.projectId) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [taskId, isAdminOrManager]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleExportPdf() {
    if (!checklist) return;
    setExporting(true);
    setExportNote(null);
    setError(null);
    try {
      const savedTo = await exportQualityChecklistPdf(checklist);
      setExportNote(savedTo ? `Saved to ${savedTo}` : 'Opened the share sheet — choose where to save.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  async function handlePickedAsset(asset: ImagePicker.ImagePickerAsset) {
    if (!asset.base64 || !taskId) return;
    setUploading(true);
    setError(null);
    try {
      const contentType = asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      await uploadSignedChecklistPhoto(taskId, asset.base64, contentType, profile?.id ?? null);
      setPhotos(await fetchSignedChecklistPhotos(taskId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleTakePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Allow camera access to photograph the signed checklist.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 });
    if (!result.canceled && result.assets[0]) await handlePickedAsset(result.assets[0]);
  }

  async function handleChooseFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Allow photo library access to attach the signed checklist.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 });
    if (!result.canceled && result.assets[0]) await handlePickedAsset(result.assets[0]);
  }

  function handleUploadSignedChecklist() {
    if (Platform.OS === 'web') {
      handleChooseFromLibrary();
      return;
    }
    Alert.alert('Upload Signed Checklist', undefined, [
      { text: 'Take Photo', onPress: handleTakePhoto },
      { text: 'Choose from Library', onPress: handleChooseFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const totalItems = checklist ? QUALITY_CATEGORIES.reduce((sum, cat) => sum + checklist.itemsByCategory[cat].length, 0) : 0;

  return (
    <View className="flex-1 bg-white">
      <Stack.Screen
        options={{
          headerShown: true,
          title: checklist ? `${checklist.task.taskCode} — Quality Checklist` : 'Quality Checklist',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <ScrollView className="bg-neutral-50" contentContainerClassName="px-4 py-4 pb-10">
          {error && (
            <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-3.5">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          )}

          {!checklist ? (
            <EmptyState icon="document-text-outline" iconColor="#9CA3AF" title="Task not found" />
          ) : (
            <>
              <Text className="text-lg font-extrabold text-neutral-900">{checklist.task.taskName}</Text>
              <Text className="text-xs text-neutral-400 mt-1 mb-3.5">{checklist.task.workName}</Text>

              {totalItems === 0 ? (
                <EmptyState
                  icon="checkmark-done-outline"
                  iconColor="#9CA3AF"
                  title="No quality checklist defined"
                  subtitle="The admin hasn't added Pre/Construction/Post Construction checklist items for this task yet."
                />
              ) : (
                QUALITY_CATEGORIES.map((cat) => {
                  const items = checklist.itemsByCategory[cat];
                  if (items.length === 0) return null;
                  const colors = CATEGORY_COLORS[cat];
                  const done = items.filter((i) => i.status === 'YES' || i.status === 'PROCEED').length;
                  return (
                    <Card key={cat} accentColor={colors.dot} className="mb-3.5 p-0 overflow-hidden">
                      <View className="flex-row items-center justify-between px-3.5 py-3">
                        <View className="flex-row items-center gap-2">
                          <View className="w-6 h-6 rounded-full items-center justify-center" style={{ backgroundColor: colors.dot }}>
                            <Text className="text-2xs font-bold text-white">{CATEGORY_LETTER[cat]}</Text>
                          </View>
                          <Text className="text-sm font-bold text-neutral-900">{CATEGORY_LABEL[cat]}</Text>
                        </View>
                        <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: colors.badge }}>
                          <Text className="text-2xs font-mono font-bold" style={{ color: colors.text }}>
                            {done}/{items.length}
                          </Text>
                        </View>
                      </View>
                      {cat === 'quality_post_construction' && isAdminOrManager && delay && (
                        <DelayPanel delay={delay} />
                      )}
                      <View className="px-3.5">
                        {items.map((item, idx) => (
                          <ChecklistItemRow
                            key={item.id}
                            item={item}
                            taskId={taskId}
                            editable={false}
                            userId={profile?.id ?? null}
                            onChanged={() => {}}
                            onDeleted={() => {}}
                            isLast={idx === items.length - 1}
                          />
                        ))}
                      </View>
                    </Card>
                  );
                })
              )}

              <Pressable
                onPress={handleExportPdf}
                disabled={exporting || totalItems === 0}
                className="py-3 rounded-xl bg-brand-navy items-center mt-1"
                style={{ opacity: exporting || totalItems === 0 ? 0.5 : 1 }}
              >
                {exporting ? <ActivityIndicator color="#fff" /> : <Text className="text-sm font-bold text-white">Generate PDF</Text>}
              </Pressable>
              {exportNote && <Text className="text-2xs text-neutral-400 mt-2 text-center">{exportNote}</Text>}

              <Pressable
                onPress={handleUploadSignedChecklist}
                disabled={uploading}
                className="py-3 rounded-xl border border-brand-navy items-center mt-3"
                style={{ opacity: uploading ? 0.5 : 1 }}
              >
                {uploading ? (
                  <ActivityIndicator color="#0F1F33" />
                ) : (
                  <Text className="text-sm font-bold text-brand-navy">Upload Signed Checklist</Text>
                )}
              </Pressable>

              {photos.length > 0 && (
                <View className="mt-4">
                  <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-2">Signed copies on file</Text>
                  <View className="flex-row flex-wrap gap-2.5">
                    {photos.map((photo) => (
                      <View key={photo.id} className="items-center">
                        {photo.signedUrl ? (
                          <Image source={{ uri: photo.signedUrl }} style={{ width: 92, height: 92, borderRadius: 10 }} />
                        ) : (
                          <View className="w-[92px] h-[92px] rounded-xl bg-neutral-200 items-center justify-center">
                            <Text className="text-2xs text-neutral-400">Unavailable</Text>
                          </View>
                        )}
                        <Text className="text-2xs text-neutral-400 mt-1">{formatDateLabel(new Date(photo.createdAtISO))}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
