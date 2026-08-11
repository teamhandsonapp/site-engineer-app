import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Card } from '../ui/Card';
import type { TemplateTask } from '../../lib/flowchart/templateTypes';
import type { TemplateTaskFields } from '../../lib/flowchart/templateData';

// One sheet for both create and edit — a template task has a much smaller
// field set than a real one (no dates, no Task Type, no AC/AV, no mandatory
// dependency link at creation), so unlike the real flowchart's separate
// CreateTaskSheet/TaskDetailSheet there's little duplication to avoid by
// splitting these into two files.
export function TemplateTaskSheet({
  task,
  onClose,
  onSave,
  onDelete,
}: {
  task: TemplateTask | null; // null = create mode
  onClose: () => void;
  onSave: (fields: TemplateTaskFields) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [taskName, setTaskName] = useState(task?.taskName ?? '');
  const [workName, setWorkName] = useState(task?.workName ?? '');
  const [trackLabel, setTrackLabel] = useState(task?.trackLabel ?? '');
  const [dayOffsetStart, setDayOffsetStart] = useState(String(task?.dayOffsetStart ?? 0));
  const [dayOffsetEnd, setDayOffsetEnd] = useState(String(task?.dayOffsetEnd ?? 0));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = Number.parseInt(dayOffsetStart, 10);
  const end = Number.parseInt(dayOffsetEnd, 10);
  const missing: string[] = [];
  if (!taskName.trim()) missing.push('Task Name');
  if (!workName.trim()) missing.push('Trade / Work Name');
  if (!Number.isInteger(start)) missing.push('Day Offset Start');
  if (!Number.isInteger(end)) missing.push('Day Offset End');

  async function handleSave() {
    if (missing.length > 0) {
      setError(`Please fill in: ${missing.join(', ')}`);
      return;
    }
    if (end < start) {
      setError('Day Offset End cannot be before Day Offset Start');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        taskName: taskName.trim(),
        workName: workName.trim(),
        trackLabel: trackLabel.trim() || null,
        dayOffsetStart: start,
        dayOffsetEnd: end,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this task');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this task');
      setDeleting(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 400, maxHeight: '88%' }}>
          <Card>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-sm font-bold text-neutral-900 mb-3">{task ? 'Edit Template Task' : 'New Template Task'}</Text>

              {error && (
                <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
                  <Text className="text-xs text-red-600">{error}</Text>
                </View>
              )}

              <Text className="text-xs text-neutral-400 mb-1">Task Name *</Text>
              <TextInput
                value={taskName}
                onChangeText={setTaskName}
                placeholder="e.g. Column starter casting"
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
              />

              <Text className="text-xs text-neutral-400 mb-1">Trade / Work Name *</Text>
              <TextInput
                value={workName}
                onChangeText={setWorkName}
                placeholder="e.g. Civil Works"
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
              />
              <Text className="text-2xs text-neutral-400 mb-3" style={{ marginTop: -8 }}>
                Plain text, not a real Work — matched to (or used to create) a real Work in whichever project this template is applied to later.
              </Text>

              <Text className="text-xs text-neutral-400 mb-1">Track Label (optional)</Text>
              <TextInput
                value={trackLabel}
                onChangeText={setTrackLabel}
                placeholder="e.g. Track 1"
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
              />

              <View className="flex-row gap-2 mb-1">
                <View className="flex-1">
                  <Text className="text-xs text-neutral-400 mb-1">Day Offset Start *</Text>
                  <TextInput
                    value={dayOffsetStart}
                    onChangeText={setDayOffsetStart}
                    keyboardType="number-pad"
                    className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-neutral-400 mb-1">Day Offset End *</Text>
                  <TextInput
                    value={dayOffsetEnd}
                    onChangeText={setDayOffsetEnd}
                    keyboardType="number-pad"
                    className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900"
                  />
                </View>
              </View>
              <Text className="text-2xs text-neutral-400 mb-3">
                Working days relative to this template&apos;s own day 0 — replayed from whatever anchor date is chosen when this template is applied to a project.
              </Text>
            </ScrollView>

            <View className="flex-row justify-between items-center mt-3">
              {onDelete ? (
                <Pressable onPress={handleDelete} disabled={deleting} className="px-3 py-1.5 rounded-lg bg-red-50 flex-row items-center gap-1.5">
                  {deleting && <ActivityIndicator size="small" color="#DC2626" />}
                  <Text className="text-xs font-semibold text-red-600">Delete</Text>
                </Pressable>
              ) : <View />}
              <View className="flex-row gap-2">
                <Pressable onPress={onClose} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                  <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
                </Pressable>
                <Pressable onPress={handleSave} disabled={saving} className="px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
                  {saving && <ActivityIndicator size="small" color="#fff" />}
                  <Text className="text-xs font-semibold text-white">{task ? 'Save' : 'Create'}</Text>
                </Pressable>
              </View>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
