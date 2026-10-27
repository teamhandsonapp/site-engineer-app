import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// The name prompt at the end of FlowchartCanvas's milestoneMode (after
// picking tasks individually or by From → To range) — suggests "Milestone N" but lets
// it be renamed before saving.
export function MilestoneNameModal({
  visible,
  suggestedName,
  taskCount,
  saving,
  error,
  onSave,
  onCancel,
}: {
  visible: boolean;
  suggestedName: string;
  taskCount: number;
  saving: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(suggestedName);

  useEffect(() => {
    if (visible) setName(suggestedName);
  }, [visible, suggestedName]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onCancel}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4 w-full" style={{ maxWidth: 360 }}>
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-md font-bold text-neutral-900">Name this Milestone</Text>
            <Pressable onPress={onCancel} hitSlop={8}>
              <Ionicons name="close" size={20} color="#9CA3AF" />
            </Pressable>
          </View>
          <Text className="text-xs text-neutral-400 mb-3">{taskCount} task{taskCount === 1 ? '' : 's'} will be grouped together. Tasks already in another milestone move to this one.</Text>

          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
          />

          {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}

          <Pressable
            onPress={() => name.trim() && onSave(name.trim())}
            disabled={!name.trim() || saving}
            className="flex-row items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-navy"
            style={{ opacity: !name.trim() || saving ? 0.4 : 1 }}
          >
            {saving && <ActivityIndicator color="#fff" size="small" />}
            <Text className="text-sm font-bold text-white">{saving ? 'Saving…' : 'Create Milestone'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
