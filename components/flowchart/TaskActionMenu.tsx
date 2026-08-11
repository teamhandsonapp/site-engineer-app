import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';

// Only shown when UNLOCKED (see FlowchartCanvas's handleTap) — a locked
// canvas's tap goes straight to a read-only peek instead, per Part 1/6's
// own "at most a lightweight read-only peek" wording.
export function TaskActionMenu({
  taskCode,
  onOpen,
  onEdit,
  editLabel = 'Edit',
  editIcon = 'create-outline',
  onDelete,
  onCancel,
}: {
  taskCode: string;
  // Optional — the Flowchart Template canvas has no separate "full detail"
  // screen for a template task to open (unlike a real Task's checklist), so
  // it omits this row entirely rather than passing a no-op.
  onOpen?: () => void;
  onEdit: () => void;
  // The templates LIST screen repurposes this middle slot for "Apply to
  // Project" (Open now goes to that template's own canvas there — see its
  // own fix comment — so Edit and Open would otherwise both point at the
  // same destination, and Apply would have nowhere left to be reached
  // from). Defaults to the original "Edit" label/icon for every other
  // caller (the real flowchart's own task action menus), unchanged.
  editLabel?: string;
  editIcon?: keyof typeof Ionicons.glyphMap;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onCancel}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 320 }}>
          <Card>
            <Text className="text-2xs font-mono font-bold text-neutral-400 mb-2">{taskCode}</Text>
            <View className="gap-1.5">
              {onOpen && (
                <Pressable onPress={onOpen} className="flex-row items-center gap-3 px-3 py-3 rounded-lg bg-neutral-50">
                  <Ionicons name="document-text-outline" size={18} color="#0F1F33" />
                  <Text className="text-sm font-semibold text-neutral-800">Open</Text>
                </Pressable>
              )}
              <Pressable onPress={onEdit} className="flex-row items-center gap-3 px-3 py-3 rounded-lg bg-neutral-50">
                <Ionicons name={editIcon} size={18} color="#0F1F33" />
                <Text className="text-sm font-semibold text-neutral-800">{editLabel}</Text>
              </Pressable>
              <Pressable onPress={onDelete} className="flex-row items-center gap-3 px-3 py-3 rounded-lg bg-red-50">
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
                <Text className="text-sm font-semibold text-red-600">Delete</Text>
              </Pressable>
            </View>
            <Pressable onPress={onCancel} className="self-end mt-2.5 px-3 py-1.5 rounded-lg bg-neutral-100">
              <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
            </Pressable>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
