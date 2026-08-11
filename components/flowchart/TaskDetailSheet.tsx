import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Card } from '../ui/Card';
import { DateField } from '../ui/DateField';
import { resolveDelayChip, formatCardDateRange, splitTaskName } from '../../lib/flowchart/delay';
import { applyTaskFieldChanges, editableFieldsEqual, type EditableTaskFields } from '../../lib/flowchart/undo';
import type { AccountabilityType, PositionedTask, TaskTypeOption } from '../../lib/flowchart/types';

interface EditableFields {
  // Read-only display, same as admin-web's Edit Task dialog — this is the
  // "{category} — {taskName}" prefix parsed back OUT of the task's own name
  // string (splitTaskName), not an independently editable field or a
  // Work/Trade picker. Only shown at all when the name actually has that
  // prefix (bulk-imported tasks) — null otherwise, same as admin-web.
  category: string | null;
  taskName: string; // the "action" part only — category re-glued on save
  description: string;
  plannedStartDate: string;
  dueDate: string;
  actualStartDate: string;
  actualEndDate: string;
  taskTypeId: string | null;
  // The per-task override — null means "no override, inherit from the
  // Work's own default" (see task.workAccountabilityType, the resolved
  // value shown elsewhere; this field is the raw override itself). Auto-
  // set by keyword match at creation (see createTask); this is where a
  // wrong guess or a no-match task gets corrected manually.
  accountabilityType: AccountabilityType | null;
}

function toEditable(task: PositionedTask): EditableFields {
  const { category, action } = splitTaskName(task.taskName);
  return {
    category,
    taskName: action,
    description: task.description ?? '',
    plannedStartDate: task.plannedStartDate ?? '',
    dueDate: task.dueDate ?? '',
    actualStartDate: task.actualStartDate ?? '',
    actualEndDate: task.actualEndDate ?? '',
    taskTypeId: task.taskTypeId,
    accountabilityType: task.accountabilityType,
  };
}

// Same field set as admin-web's Quick Edit dialog (Task Name, Description,
// Planned Start/End, Task Type, Actual Start/End) — held in local state and
// saved together via one "Save Changes" button, matching admin-web's own
// batched submitEditForm rather than each field auto-saving on its own.
export function TaskDetailSheet({
  task,
  taskTypes,
  canEdit,
  onClose,
  onTaskEdited,
}: {
  task: PositionedTask | null;
  taskTypes: TaskTypeOption[];
  // A client-role account has no write access at all here (RLS rejects
  // every mutation this sheet calls — see lib/flowchart/data.ts's own
  // comment on the staff-only write policies) — rendering an editable form
  // anyway would just produce a raw Postgres error on Save for a client, so
  // the fields render as plain read-only text and Save Changes is hidden
  // entirely rather than relying on the server rejection alone.
  canEdit: boolean;
  onClose: () => void;
  // Reports the FULL before/after field pair (not just a partial diff) —
  // the canvas both merges `after` into its local task list AND pushes
  // { before, after } onto its undo stack, so undo/redo can later replay
  // this exact edit in either direction via the same applyTaskFieldChanges
  // this sheet itself uses to save.
  onTaskEdited: (taskId: string, before: EditableTaskFields, after: EditableTaskFields) => void;
}) {
  const [form, setForm] = useState<EditableFields | null>(task ? toEditable(task) : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setForm(task ? toEditable(task) : null);
    setError(null);
    setPickerOpen(false);
  }, [task?.id]);

  if (!task || !form) return null;

  const delayChip = resolveDelayChip(task);
  const selectedType = taskTypes.find((t) => t.id === form.taskTypeId);

  async function handleSave() {
    if (!task || !form) return;
    setSaving(true);
    setError(null);
    // Re-glue the category prefix back on before saving — the form only
    // ever edits the "action" part, same convention as admin-web's own
    // submitEditForm (splits on load, re-joins with the same " — " on save).
    const fullTaskName = form.category ? `${form.category} — ${form.taskName}` : form.taskName;
    const before: EditableTaskFields = {
      taskName: task.taskName,
      description: task.description,
      plannedStartDate: task.plannedStartDate,
      dueDate: task.dueDate,
      actualStartDate: task.actualStartDate,
      actualEndDate: task.actualEndDate,
      taskTypeId: task.taskTypeId,
      accountabilityType: task.accountabilityType,
    };
    const after: EditableTaskFields = {
      taskName: fullTaskName,
      description: form.description || null,
      plannedStartDate: form.plannedStartDate || null,
      dueDate: form.dueDate || null,
      actualStartDate: form.actualStartDate || null,
      actualEndDate: form.actualEndDate || null,
      taskTypeId: form.taskTypeId,
      accountabilityType: form.accountabilityType,
    };
    try {
      await applyTaskFieldChanges(task.id, before, after);
      // A no-op save (opened the sheet, changed nothing) still reports
      // through onClose below, just without an undo-stack entry — pushing
      // an identical before/after pair would let Undo "revert" an edit
      // that never actually happened.
      if (!editableFieldsEqual(before, after)) onTaskEdited(task.id, before, after);
      onClose();
    } catch (err) {
      // Deliberately does NOT report a partial before/after here (unlike
      // this function's previous per-field try/catch, which surfaced
      // whichever fields DID save before a later one threw) — undo
      // correctness needs an atomic, accurate before/after pair, and a
      // partially-applied multi-field edit can't cleanly produce one
      // without instrumenting applyTaskFieldChanges to report progress.
      // The canvas's own task list simply stays at its pre-save values;
      // whatever individual fields did reach the DB are still there next
      // time this task is fetched fresh.
      setError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380, maxHeight: '85%' }}>
          <Card>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-2xs font-mono font-bold text-neutral-400">{task.taskId}</Text>

              <View className="flex-row items-center gap-2 my-1.5">
                <View className="px-2 py-0.5 rounded-full bg-yellow-100">
                  <Text className="text-2xs font-semibold text-yellow-900">
                    {formatCardDateRange(task.plannedStartDate, task.dueDate)}
                  </Text>
                </View>
                {delayChip && (
                  <View className="px-2 py-0.5 rounded-full bg-red-100">
                    <Text className="text-2xs font-semibold text-red-700">
                      +{delayChip.days}d {delayChip.isOwnDelay ? '(actual)' : '(cascaded)'}
                    </Text>
                  </View>
                )}
              </View>

              {error && (
                <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-2">
                  <Text className="text-xs text-red-600">{error}</Text>
                </View>
              )}

              {form.category && (
                <>
                  <Text className="text-xs text-neutral-400 mb-1">Category</Text>
                  <View className="border border-neutral-100 bg-neutral-50 rounded-lg px-3 py-2 mb-3">
                    <Text className="text-sm text-neutral-500">{form.category}</Text>
                  </View>
                </>
              )}

              <Text className="text-xs text-neutral-400 mb-1">Task Name</Text>
              <TextInput
                value={form.taskName}
                onChangeText={(v) => setForm((f) => (f ? { ...f, taskName: v } : f))}
                editable={canEdit}
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
              />

              <Text className="text-xs text-neutral-400 mb-1">Description</Text>
              <TextInput
                value={form.description}
                onChangeText={(v) => setForm((f) => (f ? { ...f, description: v } : f))}
                placeholder="Describe the scope of work…"
                editable={canEdit}
                multiline
                numberOfLines={3}
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
                style={{ minHeight: 64, textAlignVertical: 'top' }}
              />

              <View className="flex-row gap-2 mb-3">
                <View className="flex-1">
                  <DateField
                    label="Planned Start"
                    value={form.plannedStartDate || null}
                    editable={canEdit}
                    onChange={(iso) => setForm((f) => (f ? { ...f, plannedStartDate: iso } : f))}
                  />
                </View>
                <View className="flex-1">
                  <DateField
                    label="Planned End"
                    value={form.dueDate || null}
                    minDate={form.plannedStartDate || null}
                    editable={canEdit}
                    onChange={(iso) => setForm((f) => (f ? { ...f, dueDate: iso } : f))}
                  />
                </View>
              </View>

              <Text className="text-xs text-neutral-400 mb-1">Task Type</Text>
              <Pressable
                onPress={() => canEdit && setPickerOpen((v) => !v)}
                className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 mb-1"
              >
                <Text className="text-sm text-neutral-900">
                  {selectedType ? `${selectedType.name} — ${selectedType.defaultDurationDays} working days` : 'No type'}
                </Text>
                {canEdit && <Text className="text-neutral-400">{pickerOpen ? '▲' : '▼'}</Text>}
              </Pressable>
              {canEdit && pickerOpen && (
                <View className="mb-3">
                  <Pressable
                    onPress={() => { setForm((f) => (f ? { ...f, taskTypeId: null } : f)); setPickerOpen(false); }}
                    className={`px-3 py-2 rounded-lg mb-1 ${form.taskTypeId == null ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                  >
                    <Text className={`text-xs font-medium ${form.taskTypeId == null ? 'text-white' : 'text-neutral-600'}`}>No type</Text>
                  </Pressable>
                  {taskTypes.map((t) => {
                    const active = form.taskTypeId === t.id;
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => { setForm((f) => (f ? { ...f, taskTypeId: t.id } : f)); setPickerOpen(false); }}
                        className={`px-3 py-2 rounded-lg mb-1 ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                      >
                        <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-neutral-600'}`}>
                          {t.name} — {t.defaultDurationDays} working days
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Text className="text-xs text-neutral-400 mb-1">AC / AV</Text>
              <View className="flex-row gap-2 mb-1">
                <Pressable
                  testID="accountability-ac-button"
                  onPress={() => canEdit && setForm((f) => (f ? { ...f, accountabilityType: f.accountabilityType === 'ACC' ? null : 'ACC' } : f))}
                  disabled={!canEdit}
                  className="flex-1 items-center py-2 rounded-lg"
                  style={{ backgroundColor: form.accountabilityType === 'ACC' ? '#111111' : '#F5F5F5' }}
                >
                  <Text className="text-xs font-bold" style={{ color: form.accountabilityType === 'ACC' ? '#ffffff' : '#525252' }}>AC</Text>
                </Pressable>
                <Pressable
                  testID="accountability-av-button"
                  onPress={() => canEdit && setForm((f) => (f ? { ...f, accountabilityType: f.accountabilityType === 'ACV' ? null : 'ACV' } : f))}
                  disabled={!canEdit}
                  className="flex-1 items-center py-2 rounded-lg border"
                  style={{ backgroundColor: '#ffffff', borderColor: form.accountabilityType === 'ACV' ? '#111111' : '#E5E5E5', borderWidth: form.accountabilityType === 'ACV' ? 2 : 1 }}
                >
                  <Text className="text-xs font-bold text-neutral-700">AV</Text>
                </Pressable>
              </View>
              <Text className="text-2xs text-neutral-400 mb-3">
                {form.accountabilityType ? 'Tap the highlighted one again to clear the override.' : 'Auto-classified from the task name — tap to set manually.'}
              </Text>

              <View className="flex-row gap-2 mb-1 pt-2 border-t border-neutral-100">
                <View className="flex-1 pt-2">
                  <DateField
                    label="Actual Start"
                    value={form.actualStartDate || null}
                    editable={canEdit}
                    onChange={(iso) => setForm((f) => (f ? { ...f, actualStartDate: iso } : f))}
                  />
                </View>
                <View className="flex-1 pt-2">
                  <DateField
                    label="Actual End"
                    value={form.actualEndDate || null}
                    editable={canEdit}
                    onChange={(iso) => setForm((f) => (f ? { ...f, actualEndDate: iso } : f))}
                  />
                </View>
              </View>
            </ScrollView>

            <View className="flex-row justify-end gap-2 mt-3">
              {canEdit ? (
                <>
                  <Pressable onPress={onClose} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                    <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
                  </Pressable>
                  <Pressable onPress={handleSave} disabled={saving} className="px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
                    {saving && <ActivityIndicator size="small" color="#fff" />}
                    <Text className="text-xs font-semibold text-white">Save Changes</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable onPress={onClose} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                  <Text className="text-xs font-semibold text-neutral-600">Close</Text>
                </Pressable>
              )}
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
