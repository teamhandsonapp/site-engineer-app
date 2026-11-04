import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchDrawingRevisions, uploadDrawingRevision, type DrawingRevisionRow } from '../../lib/taskDetail/data';
import { MAX_DRAWING_REVISIONS } from '../../lib/taskDetail/constants';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Upload here is a filename prompt, not a real file picker — matching
// admin-web exactly, where fileUrl is a documented placeholder string and
// only the browser-reported file NAME is ever persisted (no real bytes
// stored anywhere yet on either platform). Adding a native document-picker
// dependency for a feature that wouldn't store real files either way isn't
// worth the extra native module.
export function DrawingRevisionDrawer({
  itemId,
  itemLabel,
  uploadedBy,
  onClose,
}: {
  itemId: string;
  itemLabel: string;
  uploadedBy: string;
  onClose: () => void;
}) {
  const [revisions, setRevisions] = useState<DrawingRevisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);

  function load() {
    setLoading(true);
    fetchDrawingRevisions(itemId)
      .then(setRevisions)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [itemId]);

  // 0-indexed (2026-08-17): first revision is R0, not R1 — see this
  // change's mirror in lib/taskDetail/data.ts and admin-web's own
  // drawing-revisions action, since all three read/write the same table.
  const currentMax = revisions[0]?.revisionNumber ?? -1;
  const atCap = currentMax >= MAX_DRAWING_REVISIONS - 1;

  async function handleUpload() {
    if (!fileName.trim()) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDrawingRevision(itemId, fileName.trim(), uploadedBy, currentMax);
      setFileName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4" style={{ width: '100%', maxWidth: 400, maxHeight: '75%' }}>
          <Text className="text-sm font-bold text-neutral-900">Drawing revisions</Text>
          <Text className="text-xs text-neutral-400 mb-3">{itemLabel}</Text>

          {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}

          {atCap ? (
            <View className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              <Text className="text-xs text-amber-700">Maximum 5 revisions reached for this item.</Text>
            </View>
          ) : (
            <View className="flex-row items-center gap-2 mb-3">
              <TextInput
                value={fileName}
                onChangeText={setFileName}
                placeholder="File name (e.g. plan-r2.pdf)"
                className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900"
              />
              <Pressable onPress={handleUpload} disabled={uploading || !fileName.trim()} className="px-3 py-2.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
                {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="cloud-upload-outline" size={14} color="#fff" />}
                <Text className="text-xs font-semibold text-white">Upload (R{currentMax + 1})</Text>
              </Pressable>
            </View>
          )}

          {loading ? (
            <ActivityIndicator color="#0F1F33" />
          ) : (
            <ScrollView style={{ maxHeight: 260 }}>
              {revisions.length === 0 ? (
                <Text className="text-xs text-neutral-400 py-2">No revisions uploaded yet.</Text>
              ) : (
                revisions.map((r) => (
                  <View key={r.id} className="flex-row items-center gap-2 py-2 border-b border-neutral-50">
                    <View className="px-1.5 py-0.5 rounded bg-neutral-100">
                      <Text className="text-2xs font-bold text-neutral-600">R{r.revisionNumber}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-xs font-medium text-neutral-800" numberOfLines={1}>{r.fileName}</Text>
                      <Text className="text-2xs text-neutral-400">
                        {r.uploaderName ?? 'Unknown'} · {formatDate(r.uploadedAtISO)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          )}

          <Pressable onPress={onClose} className="self-end mt-3 px-3 py-1.5 rounded-lg bg-neutral-100">
            <Text className="text-xs font-semibold text-neutral-600">Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
