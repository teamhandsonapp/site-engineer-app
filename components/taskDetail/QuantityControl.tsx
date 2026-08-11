import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QUANTITY_UNIT_OPTIONS, type QuantityUnit } from '../../lib/taskDetail/constants';

export function QuantityControl({
  unit,
  value,
  readOnly,
  editable,
  onSave,
}: {
  unit: QuantityUnit | null;
  value: number | null;
  readOnly: boolean; // isComputedQuantity — auto-derived, never directly editable
  editable: boolean;
  onSave: (unit: QuantityUnit, value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftUnit, setDraftUnit] = useState<QuantityUnit>(unit ?? 'NO');
  const [draftValue, setDraftValue] = useState(value != null ? String(value) : '');
  const [error, setError] = useState<string | null>(null);
  const unitLabel = QUANTITY_UNIT_OPTIONS.find((u) => u.value === unit)?.label;

  function openPicker() {
    if (!editable || readOnly) return;
    setDraftUnit(unit ?? 'NO');
    setDraftValue(value != null ? String(value) : '');
    setError(null);
    setOpen(true);
  }

  function handleSave() {
    const num = Number(draftValue);
    if (!draftValue || !Number.isFinite(num) || num <= 0) {
      setError('Enter a positive number');
      return;
    }
    setOpen(false);
    onSave(draftUnit, num);
  }

  return (
    <>
      <Pressable onPress={openPicker} className="flex-row items-center gap-1">
        <Ionicons name="resize-outline" size={12} color="#9CA3AF" />
        <Text className="text-2xs text-neutral-500">
          {value != null && unitLabel ? `${value} ${unitLabel}` : 'Not set'}
          {readOnly && ' (auto)'}
        </Text>
      </Pressable>

      {open && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={() => setOpen(false)}>
            <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4" style={{ width: '100%', maxWidth: 340 }}>
              <Text className="text-xs font-bold text-neutral-700 mb-2">Quantity of work</Text>
              {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}
              <View className="flex-row flex-wrap gap-1.5 mb-3">
                {QUANTITY_UNIT_OPTIONS.map((u) => {
                  const active = draftUnit === u.value;
                  return (
                    <Pressable
                      key={u.value}
                      onPress={() => setDraftUnit(u.value)}
                      className={`px-2.5 py-1.5 rounded-full ${active ? 'bg-brand-navy' : 'bg-neutral-100'}`}
                    >
                      <Text className={`text-2xs font-semibold ${active ? 'text-white' : 'text-neutral-600'}`}>{u.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={draftValue}
                onChangeText={setDraftValue}
                keyboardType="decimal-pad"
                placeholder="Enter value"
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
              />
              <View className="flex-row justify-end gap-2">
                <Pressable onPress={() => setOpen(false)} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                  <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
                </Pressable>
                <Pressable onPress={handleSave} className="px-3 py-1.5 rounded-lg bg-brand-navy">
                  <Text className="text-xs font-semibold text-white">Save</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}
