import { Modal, Pressable, Text, View } from 'react-native';
import { Card } from '../ui/Card';
import { DEPENDENCY_TYPE_FULL_LABEL, type RelationshipType } from '../../lib/flowchart/types';

const OPTIONS: { type: RelationshipType; sublabel: string }[] = [
  { type: 'FS', sublabel: 'The other task starts only once this one finishes' },
  { type: 'SS', sublabel: 'The other task starts when this one starts' },
  { type: 'SF', sublabel: 'The other task finishes when this one starts' },
  { type: 'FF', sublabel: 'The other task finishes when this one finishes' },
  { type: 'PARALLEL', sublabel: 'Runs alongside — no blocking order between them' },
];

// Shown after tapping two tasks in a row (source, then target) — the
// second tap no longer creates a link on its own with whatever type
// happened to be pre-selected on a toolbar; it opens this instead, so a
// link's type is always an explicit choice, never a silent default. A
// simple list, per spec — one tap selects and confirms, no separate
// "Save" step (Cancel is the only other action needed).
export function LinkTypeModal({
  onSelect,
  onCancel,
}: {
  onSelect: (type: RelationshipType) => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onCancel}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 360 }}>
          <Card>
            <Text className="text-sm font-bold text-neutral-900 mb-0.5">How are these tasks related?</Text>
            <Text className="text-2xs text-neutral-400 mb-3">Choose the dependency type for this link.</Text>
            <View className="gap-1.5">
              {OPTIONS.map((opt) => (
                <Pressable
                  key={opt.type}
                  onPress={() => onSelect(opt.type)}
                  className="px-3 py-2.5 rounded-lg bg-neutral-50"
                >
                  <Text className="text-sm font-semibold text-neutral-800">
                    {opt.type === 'PARALLEL' ? 'Parallel' : DEPENDENCY_TYPE_FULL_LABEL[opt.type]}
                    <Text className="text-2xs font-bold text-neutral-400">  ({opt.type === 'PARALLEL' ? '∥' : opt.type})</Text>
                  </Text>
                  <Text className="text-2xs text-neutral-400 mt-0.5">{opt.sublabel}</Text>
                </Pressable>
              ))}
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
