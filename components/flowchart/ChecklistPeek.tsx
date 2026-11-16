import { Pressable, View } from 'react-native';
import { Text } from '../ui/AppText';
import { FormModal } from '../ui/FormModal';
import { CHECKLIST_NOTE_FIELDS, type ChecklistNotes } from '../../lib/flowchart/checklistNotes';
import { ChecklistWheel } from './ChecklistWheel';

// Read-only pop-up from a card's checklist wheel (Flowchart 2, 2026-11-14):
// the client-checklist points (7) for one task, each in its own colour, with
// whatever is written. No editing here — that stays in the task sheet's
// Checklist tab.
export function ChecklistPeek({ taskName, notes, onClose }: { taskName: string; notes: ChecklistNotes | null; onClose: () => void }) {
  return (
    <FormModal visible={!!notes} onRequestClose={onClose}>
      <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 340 }}>
        <View testID="checklist-peek" className="bg-white rounded-2xl p-4">
          <View className="flex-row items-center gap-2 mb-3">
            <ChecklistWheel size={22} filled={CHECKLIST_NOTE_FIELDS.map((f) => !!notes?.[f.key]?.trim())} />
            <Text className="text-sm font-bold text-neutral-900 flex-1" numberOfLines={2}>
              {taskName}
            </Text>
          </View>
          {CHECKLIST_NOTE_FIELDS.map((f) => {
            const value = notes?.[f.key]?.trim() ?? '';
            return (
              <View
                key={f.key}
                className="flex-row items-start gap-2 rounded-lg px-2.5 py-2 mb-1.5"
                style={{ backgroundColor: value ? `${f.color}14` : '#FAFAFA', borderLeftWidth: 3, borderLeftColor: value ? f.color : '#E5E5E5' }}
              >
                <View className="flex-1">
                  <Text className="text-2xs font-semibold" style={{ color: value ? f.color : '#A3A3A3' }}>
                    {f.label}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: value ? '#171717' : '#A3A3A3' }}>
                    {value || 'Not given'}
                  </Text>
                </View>
              </View>
            );
          })}
          <Pressable onPress={onClose} className="self-end mt-1.5 px-3 py-1.5 rounded-lg bg-neutral-100">
            <Text className="text-xs font-semibold text-neutral-700">Close</Text>
          </Pressable>
        </View>
      </Pressable>
    </FormModal>
  );
}
