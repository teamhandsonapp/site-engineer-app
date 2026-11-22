import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '../ui/AppText';
import { FormModal, useBackdropGuard } from '../ui/FormModal';
import {
  CHECKLIST_NOTE_FIELDS,
  CHECKLIST_STAGE_LABEL,
  notePointsText,
  STAGED_NOTE_FIELDS,
  type ChecklistNotes,
  type ChecklistStage,
} from '../../lib/flowchart/checklistNotes';
import { ChecklistWheel } from './ChecklistWheel';

const STAGES: ChecklistStage[] = ['preConstruction', 'construction'];
const written = (n: ChecklistNotes | null | undefined, fields: typeof CHECKLIST_NOTE_FIELDS) => fields.filter((f) => !!n?.[f.key]?.trim()).length;

// Read-only pop-up from a card's checklist wheel (Flowchart 2, 2026-11-14):
// the client-checklist points for one task, each in its own colour, with
// whatever is written. No editing here — that stays in the task sheet's
// Checklist tab.
// `stages` (Past Tasks, 2026-11-21): Pre-construction / Construction tabs,
// each with Equipment delays too — same as the task sheet's Checklist tab.
export function ChecklistPeek({
  taskName,
  notes,
  constructionNotes,
  stages = false,
  onClose,
}: {
  taskName: string;
  notes: ChecklistNotes | null;
  constructionNotes?: ChecklistNotes | null;
  stages?: boolean;
  onClose: () => void;
}) {
  // Same click-through guard as the DPR / PR pop-up (see useBackdropGuard).
  const guardedClose = useBackdropGuard(!!notes, onClose);
  const fields = stages ? STAGED_NOTE_FIELDS : CHECKLIST_NOTE_FIELDS;
  // Opens on the tab that has something written (Pre-construction first).
  const [stage, setStage] = useState<ChecklistStage>('preConstruction');
  useEffect(() => {
    setStage(!written(notes, fields) && written(constructionNotes, fields) ? 'construction' : 'preConstruction');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskName]);
  const shown = stages && stage === 'construction' ? constructionNotes ?? null : notes;
  const wheel = fields.map((f) => !!notes?.[f.key]?.trim() || (stages && !!constructionNotes?.[f.key]?.trim()));

  return (
    <FormModal visible={!!notes} onRequestClose={onClose} onBackdropPress={guardedClose}>
      <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 340, maxHeight: '90%' }}>
        <View testID="checklist-peek" className="bg-white rounded-2xl p-4" style={{ maxHeight: '100%' }}>
          <View className="flex-row items-center gap-2 mb-3">
            <ChecklistWheel size={22} filled={wheel} fields={fields} />
            <Text className="text-sm font-bold text-neutral-900 flex-1" numberOfLines={2}>
              {taskName}
            </Text>
          </View>
          {stages ? (
            <View className="flex-row rounded-xl p-1 mb-2.5" style={{ backgroundColor: '#F1F3F6' }}>
              {STAGES.map((s) => {
                const on = stage === s;
                const n = written(s === 'construction' ? constructionNotes : notes, fields);
                return (
                  <Pressable
                    key={s}
                    testID={`checklist-peek-stage-${s}`}
                    onPress={() => setStage(s)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    className="flex-1 items-center justify-center rounded-lg"
                    style={{ minHeight: 32, backgroundColor: on ? '#fff' : 'transparent' }}
                  >
                    <Text className="text-2xs font-bold" style={{ color: on ? '#0F1F33' : '#9CA3AF' }}>
                      {CHECKLIST_STAGE_LABEL[s]}{n ? ` (${n})` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <ScrollView style={{ flexShrink: 1 }}>
            {fields.map((f) => {
              // Several points (Past Works) show as a "• " list.
              const value = notePointsText(shown ?? undefined, f.key);
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
          </ScrollView>
          <Pressable onPress={onClose} className="self-end mt-1.5 px-3 py-1.5 rounded-lg bg-neutral-100">
            <Text className="text-xs font-semibold text-neutral-700">Close</Text>
          </Pressable>
        </View>
      </Pressable>
    </FormModal>
  );
}
