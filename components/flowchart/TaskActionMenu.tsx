import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';

// Shown on every tap, locked or not (see FlowchartCanvas's handleTap) — a
// locked canvas passes only onOpen/onEdit (no onLink/onDelete), so
// structural changes stay gated behind unlocking while Edit is reachable
// either way, by explicit request.
export function TaskActionMenu({
  taskCode,
  onOpen,
  onEdit,
  editLabel = 'Edit',
  editIcon = 'create-outline',
  onLink,
  onCopy,
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
  // Optional — omitted by the templates LIST screen's own reuse of this
  // menu (that one isn't a canvas, there's no second task to link to).
  // Starts the tap-this-task-then-tap-another link flow (see
  // FlowchartCanvas/TemplateCanvas's own pendingSourceId) — replaces the
  // old always-visible bottom "Link type" toolbar, which used to eat
  // permanent screen space and was itself one of the recurring
  // off-screen-clipping offenders.
  onLink?: () => void;
  // Optional — same lock-gating as onLink/onDelete below (a locked canvas's
  // tap-to-edit menu offers Open/Edit only). Creates a new task row, so it's
  // gated the same way Link/Delete are — a structural change, not a
  // read-only action like Open.
  onCopy?: () => void;
  // Optional — omitted for a locked canvas's own tap-to-edit menu (see
  // FlowchartCanvas's handleTap), which offers Open/Edit only. Deleting a
  // task is a structural, hard-to-reverse change the lock toggle exists to
  // gate, same reasoning as onLink being withheld there too.
  onDelete?: () => void;
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
              {onLink && (
                <Pressable onPress={onLink} className="flex-row items-center gap-3 px-3 py-3 rounded-lg bg-neutral-50">
                  <Ionicons name="git-network-outline" size={18} color="#0F1F33" />
                  <Text className="text-sm font-semibold text-neutral-800">Link to Task</Text>
                </Pressable>
              )}
              {onCopy && (
                <Pressable onPress={onCopy} className="flex-row items-center gap-3 px-3 py-3 rounded-lg bg-neutral-50">
                  <Ionicons name="copy-outline" size={18} color="#0F1F33" />
                  <Text className="text-sm font-semibold text-neutral-800">Copy</Text>
                </Pressable>
              )}
              {onDelete && (
                <Pressable onPress={onDelete} className="flex-row items-center gap-3 px-3 py-3 rounded-lg bg-red-50">
                  <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  <Text className="text-sm font-semibold text-red-600">Delete</Text>
                </Pressable>
              )}
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
