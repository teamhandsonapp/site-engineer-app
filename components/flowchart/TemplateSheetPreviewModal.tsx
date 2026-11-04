import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import type { TemplateSheetParseResult } from '../../lib/flowchart/templateSheetParser';

// Shown after a sheet has been picked + parsed, before anything is written —
// same "preview then commit" shape as every other bulk-import flow in this
// app (see admin-web's own template-sheet upload). Warnings are always
// shown when present rather than requiring a tap to reveal them, since
// "don't silently skip a malformed row" was an explicit requirement.
export function TemplateSheetPreviewModal({
  fileName,
  preview,
  committing,
  onConfirm,
  onCancel,
}: {
  fileName: string;
  preview: TemplateSheetParseResult;
  committing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const linkCount = preview.links.length;
  const seriesCount = preview.links.filter((l) => l.type === 'FS').length;
  const parallelCount = linkCount - seriesCount;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onCancel}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 420, maxHeight: '85%' }}>
          <Card>
            <Text className="text-sm font-bold text-neutral-900 mb-1" numberOfLines={1}>{fileName}</Text>
            <Text className="text-xs text-neutral-400 mb-3">Review before adding these to the canvas</Text>

            {preview.tasks.length === 0 ? (
              <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 mb-3">
                <Text className="text-xs text-red-600">No usable rows found — nothing would be created.</Text>
              </View>
            ) : (
              <View className="flex-row gap-2 mb-3">
                <View className="flex-1 rounded-xl bg-neutral-50 px-3 py-2.5 items-center">
                  <Text className="text-lg font-extrabold text-neutral-900">{preview.tasks.length}</Text>
                  <Text className="text-2xs font-semibold text-neutral-400 mt-0.5">Tasks</Text>
                </View>
                <View className="flex-1 rounded-xl bg-neutral-50 px-3 py-2.5 items-center">
                  <Text className="text-lg font-extrabold text-neutral-900">{preview.columnLabels.length}</Text>
                  <Text className="text-2xs font-semibold text-neutral-400 mt-0.5">Columns</Text>
                </View>
                <View className="flex-1 rounded-xl bg-neutral-50 px-3 py-2.5 items-center">
                  <Text className="text-lg font-extrabold text-neutral-900">{linkCount}</Text>
                  <Text className="text-2xs font-semibold text-neutral-400 mt-0.5">Links</Text>
                </View>
              </View>
            )}

            {preview.tasks.length > 0 && (
              <Text className="text-2xs text-neutral-400 mb-3">
                {seriesCount} sequential (FS) link{seriesCount === 1 ? '' : 's'} · {parallelCount} parallel link{parallelCount === 1 ? '' : 's'} · columns: {preview.columnLabels.join(', ')}
              </Text>
            )}

            {preview.warnings.length > 0 && (
              <View className="mb-3">
                <View className="flex-row items-center gap-1.5 mb-1.5">
                  <Ionicons name="warning-outline" size={14} color="#B45309" />
                  <Text className="text-xs font-bold text-amber-700">{preview.warnings.length} warning{preview.warnings.length === 1 ? '' : 's'}</Text>
                </View>
                <ScrollView style={{ maxHeight: 140 }} showsVerticalScrollIndicator={false}>
                  {preview.warnings.map((w, i) => (
                    <Text key={i} className="text-2xs text-amber-700 mb-1">{w}</Text>
                  ))}
                </ScrollView>
              </View>
            )}

            <View className="flex-row justify-end gap-2 mt-1">
              <Pressable onPress={onCancel} disabled={committing} className="px-3.5 py-2 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onConfirm}
                disabled={committing || preview.tasks.length === 0}
                className="px-3.5 py-2 rounded-lg bg-brand-navy flex-row items-center gap-1.5"
                style={{ opacity: preview.tasks.length === 0 ? 0.5 : 1 }}
              >
                {committing && <ActivityIndicator size="small" color="#fff" />}
                <Text className="text-xs font-semibold text-white">Add {preview.tasks.length} Task{preview.tasks.length === 1 ? '' : 's'}</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
