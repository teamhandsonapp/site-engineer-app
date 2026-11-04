import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SubtaskDepartmentPicker } from './SubtaskDepartmentPicker';
import { DateField } from '../ui/DateField';
import { createSubtask, deleteSubtask, updateSubtask, type DprSubtaskItem } from '../../lib/dprEntries';
import type { WorkOption } from '../../lib/flowchart/data';

// A day's full list of subtasks, each independently addable/editable/
// deletable, by explicit request — replaces the old single subtask text +
// department pair. Shared by all 3 subtask surfaces (the DPR form, DPR
// History, and the flowchart's own Subtasks tab/task creation) so the
// add/edit/delete interaction only exists once.
//
// Each action (add/edit-text/edit-department/delete) writes straight to
// dpr_entry_subtasks immediately — there's no separate "Save" step, same
// convention as ChecklistItemRow's own per-item persistence and Reason for
// Delay's own tap-to-toggle chips elsewhere in this app. The parent owns
// the `subtasks` array (already fetched for its own scope — today only,
// or a whole task's history) and is kept in sync via `onChange`.
export function SubtaskListEditor({
  taskId,
  reportDate,
  works,
  subtasks,
  editable,
  onChange,
  showPercent,
  actualStarts,
  taskActualStart,
  onActualStartChange,
}: {
  taskId: string;
  reportDate: string;
  works: WorkOption[];
  subtasks: DprSubtaskItem[];
  editable: boolean;
  onChange: (next: DprSubtaskItem[]) => void;
  // Adds a per-subtask "% complete" input, by explicit request — only
  // meaningful on the DPR form itself (where the task's daily % is now
  // computed from these), not on the flowchart's own planning-time Subtasks
  // tab or task creation, which stay text+department only.
  showPercent?: boolean;
  // Per-subtask Actual Start Date (DPR form only). When `actualStarts` is
  // passed, each subtask gets its own date picker; a subtask with no date of
  // its own shows (and inherits) the task's `taskActualStart`.
  actualStarts?: Record<string, string | null>;
  taskActualStart?: string | null;
  onActualStartChange?: (subtaskId: string, isoDate: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [newWorkId, setNewWorkId] = useState<string | null>(null);
  const [newPercentText, setNewPercentText] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleAdd() {
    const trimmed = newText.trim();
    if (!trimmed) return;
    setAddSaving(true);
    setAddError(null);
    try {
      const trimmedPercent = newPercentText.trim();
      const percentComplete = trimmedPercent === '' ? null : Math.max(0, Math.min(100, Math.round(Number(trimmedPercent))));
      const created = await createSubtask(taskId, reportDate, trimmed, newWorkId, subtasks.length, percentComplete);
      onChange([...subtasks, created]);
      setNewText('');
      setNewWorkId(null);
      setNewPercentText('');
      setAdding(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add this subtask.');
    } finally {
      setAddSaving(false);
    }
  }

  function handleTextChange(item: DprSubtaskItem, text: string) {
    onChange(subtasks.map((s) => (s.id === item.id ? { ...s, text } : s)));
  }

  function handleTextBlur(item: DprSubtaskItem) {
    const current = subtasks.find((s) => s.id === item.id);
    if (!current) return;
    updateSubtask(item.id, { text: current.text }).catch(() => {});
  }

  function handleWorkChange(item: DprSubtaskItem, workId: string | null) {
    onChange(subtasks.map((s) => (s.id === item.id ? { ...s, workId } : s)));
    updateSubtask(item.id, { workId }).catch(() => {});
  }

  function handlePercentChange(item: DprSubtaskItem, text: string) {
    const trimmed = text.trim();
    const percentComplete = trimmed === '' ? null : Math.max(0, Math.min(100, Math.round(Number(trimmed))));
    onChange(subtasks.map((s) => (s.id === item.id ? { ...s, percentComplete } : s)));
    if (trimmed === '' || !Number.isNaN(Number(trimmed))) {
      updateSubtask(item.id, { percentComplete }).catch(() => {});
    }
  }

  function handleDelete(item: DprSubtaskItem) {
    onChange(subtasks.filter((s) => s.id !== item.id));
    deleteSubtask(item.id).catch(() => {});
  }

  // Text on its own row, department + % on the row below — by explicit
  // correction: cramming all three into one row made the % box too small
  // (46px) to visually read as an editable field. It now matches the same
  // size/style as the Targeted/Actual Workforce boxes elsewhere on this page.
  return (
    <View>
      {subtasks.map((item) => (
        <View key={item.id} className="mb-1.5 border border-neutral-200 rounded-lg p-2 gap-1.5">
          <View className="flex-row items-start gap-1.5">
            <TextInput
              value={item.text}
              onChangeText={(v) => handleTextChange(item, v)}
              onBlur={() => handleTextBlur(item)}
              editable={editable}
              multiline
              className="flex-1 text-xs text-neutral-900"
              style={{ textAlignVertical: 'top' }}
            />
            {editable && (
              <Pressable onPress={() => handleDelete(item)} hitSlop={8} className="pt-0.5">
                <Ionicons name="trash-outline" size={16} color="#DC2626" />
              </Pressable>
            )}
          </View>
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <SubtaskDepartmentPicker works={works} value={item.workId} onChange={(workId) => handleWorkChange(item, workId)} editable={editable} compact />
            </View>
            {showPercent && (
              <View className="flex-row items-center gap-1.5">
                <TextInput
                  value={item.percentComplete != null ? String(item.percentComplete) : ''}
                  onChangeText={(v) => handlePercentChange(item, v)}
                  editable={editable}
                  keyboardType="number-pad"
                  className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm text-neutral-900 text-center"
                  style={{ width: 56 }}
                />
                <Text className="text-xs text-neutral-500">%</Text>
              </View>
            )}
          </View>
          {actualStarts && (
            <View>
              <Text className="text-2xs text-neutral-400 mb-1">
                Actual Start
                {!actualStarts[item.id] && taskActualStart ? ' · same as task' : ''}
              </Text>
              <DateField
                value={actualStarts[item.id] ?? taskActualStart ?? null}
                editable={editable}
                maxDate={new Date().toISOString().slice(0, 10)}
                onChange={(d) => onActualStartChange?.(item.id, d)}
              />
            </View>
          )}
        </View>
      ))}

      {!editable ? null : adding ? (
        <View className="mb-1.5 border border-neutral-200 rounded-lg p-2 gap-1.5">
          <TextInput
            value={newText}
            onChangeText={setNewText}
            placeholder="Describe the new subtask…"
            placeholderTextColor="#9CA3AF"
            multiline
            autoFocus
            className="text-xs text-neutral-900"
            style={{ minHeight: 32, textAlignVertical: 'top' }}
          />
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <SubtaskDepartmentPicker works={works} value={newWorkId} onChange={setNewWorkId} editable compact />
            </View>
            {showPercent && (
              <View className="flex-row items-center gap-1.5">
                <TextInput
                  value={newPercentText}
                  onChangeText={setNewPercentText}
                  keyboardType="number-pad"
                  className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm text-neutral-900 text-center"
                  style={{ width: 56 }}
                />
                <Text className="text-xs text-neutral-500">%</Text>
              </View>
            )}
          </View>
          {addError && <Text className="text-2xs text-red-600 mt-1.5">{addError}</Text>}
          <View className="flex-row gap-2 mt-1.5">
            <Pressable
              onPress={() => { setAdding(false); setNewText(''); setNewWorkId(null); setNewPercentText(''); setAddError(null); }}
              className="flex-1 items-center py-1 rounded-lg border border-neutral-200"
            >
              <Text className="text-2xs font-bold text-neutral-500">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleAdd}
              disabled={addSaving || !newText.trim()}
              className="flex-1 flex-row items-center justify-center gap-1 py-1 rounded-lg bg-brand-navy"
              style={{ opacity: newText.trim() ? 1 : 0.5 }}
            >
              {addSaving && <ActivityIndicator size="small" color="#fff" />}
              <Text className="text-2xs font-bold text-white">Add</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setAdding(true)} className="flex-row items-center gap-1.5 py-1">
          <Ionicons name="add-circle-outline" size={16} color="#0F1F33" />
          <Text className="text-xs font-bold text-brand-navy">Add Subtask</Text>
        </Pressable>
      )}
    </View>
  );
}
