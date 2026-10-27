import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Card } from '../ui/Card';
import { DateField } from '../ui/DateField';
import type { TemplateTask } from '../../lib/flowchart/templateTypes';
import type { TemplateTaskFields } from '../../lib/flowchart/templateData';
import { fetchTaskTypes } from '../../lib/flowchart/data';
import type { AccountabilityType, TaskTypeOption } from '../../lib/flowchart/types';
import { dateToOffset, offsetToDate } from '../../lib/flowchart/templateDates';

// Fixed list per product spec — a template task's trade/category, stored
// as plain text in workName (see templateTypes.ts's own comment on why
// that's text, not a Work FK) but constrained to this exact set here so
// every template uses the same vocabulary.
const WORK_CATEGORIES = [
  'HVAC', 'Electrical', 'Plumbing', 'Civil Works', 'Flooring', 'False Ceiling',
  'Carpentry', 'POP', 'Waterproofing', 'Fabrication', 'Landscaping', 'Painting',
  'Modular Furniture', 'Glass & Mirrors', 'Lighting Vendor',
];

function durationLabel(days: number): string {
  return days === 2 ? '1-2 days' : `${days} days`;
}

// task_types is fetched ordered by default_duration_days ascending (see
// fetchTaskTypes's own .order() call) — so a plain A/B/C.../G letter by
// array index is a stable, deterministic label for however many rows
// exist today (currently 7: 1-2/7/15/30/45/60/90 days), with no separate
// "type code" column needed in the database. Two columns per row in the
// dropdown, per explicit request: the letter on the left, the actual day
// count on the right — the letter alone would be meaningless without it.
function typeLetter(index: number): string {
  return String.fromCharCode(65 + index); // 65 = 'A'
}

// One sheet for both create and edit. Unlike the real flowchart's separate
// CreateTaskSheet/TaskDetailSheet, a template task's field set is small
// enough that splitting these into two files would just duplicate the form.
export function TemplateTaskSheet({
  task,
  templateCreatedAt,
  onClose,
  onSave,
  onDelete,
}: {
  task: TemplateTask | null; // null = create mode
  templateCreatedAt: string;
  onClose: () => void;
  onSave: (fields: TemplateTaskFields) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [taskName, setTaskName] = useState(task?.taskName ?? '');
  const [workName, setWorkName] = useState(task?.workName ?? '');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [trackLabel, setTrackLabel] = useState(task?.trackLabel ?? '');
  const [accountabilityType, setAccountabilityType] = useState<AccountabilityType | null>(task?.accountabilityType ?? null);

  const [taskTypes, setTaskTypes] = useState<TaskTypeOption[]>([]);
  const [taskTypeId, setTaskTypeId] = useState<string | null>(null);
  const [taskTypeOpen, setTaskTypeOpen] = useState(false);

  const [plannedStartDate, setPlannedStartDate] = useState<string | null>(
    task ? offsetToDate(templateCreatedAt, task.dayOffsetStart) : null
  );
  const [plannedEndDate, setPlannedEndDate] = useState<string | null>(
    task ? offsetToDate(templateCreatedAt, task.dayOffsetEnd) : null
  );
  // Once someone edits End directly, stop overwriting it automatically —
  // "still allow manual override of the end date regardless, since real
  // schedules don't always match the nominal duration exactly" (spec).
  const [endManuallyEdited, setEndManuallyEdited] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTaskTypes()
      .then(setTaskTypes)
      .catch(() => {
        // Non-fatal — Task Type only drives the end-date auto-suggest, the
        // rest of the form still works without it.
      });
  }, []);

  const selectedTaskType = taskTypes.find((t) => t.id === taskTypeId);

  function applyDuration(days: number, fromDate: string | null) {
    if (!fromDate || endManuallyEdited) return;
    setPlannedEndDate(offsetToDate(fromDate, days));
  }

  function handleSelectTaskType(t: TaskTypeOption) {
    setTaskTypeId(t.id);
    setTaskTypeOpen(false);
    applyDuration(t.defaultDurationDays, plannedStartDate);
  }

  function handleStartDateChange(iso: string) {
    setPlannedStartDate(iso);
    if (selectedTaskType) applyDuration(selectedTaskType.defaultDurationDays, iso);
  }

  const missing: string[] = [];
  if (!taskName.trim()) missing.push('Task Name');
  if (!workName.trim()) missing.push('Department');
  if (!plannedStartDate) missing.push('Planned Start Date');
  if (!plannedEndDate) missing.push('Planned End Date');
  if (!accountabilityType) missing.push('AC / AV');

  async function handleSave() {
    if (missing.length > 0 || !plannedStartDate || !plannedEndDate) {
      setError(`Please fill in: ${missing.join(', ')}`);
      return;
    }
    const start = dateToOffset(templateCreatedAt, plannedStartDate);
    const end = dateToOffset(templateCreatedAt, plannedEndDate);
    if (end < start) {
      setError('Planned End Date cannot be before Planned Start Date');
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
        accountabilityType,
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

              <Text className="text-xs text-neutral-400 mb-1">Department *</Text>
              <Pressable
                onPress={() => setCategoryOpen((v) => !v)}
                className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 mb-1"
              >
                <Text className="text-sm text-neutral-900">{workName || 'Select a department'}</Text>
                <Text className="text-neutral-400">{categoryOpen ? '▲' : '▼'}</Text>
              </Pressable>
              {categoryOpen && (
                <ScrollView style={{ maxHeight: 180 }} className="mb-3 border border-neutral-100 rounded-lg">
                  {WORK_CATEGORIES.map((c) => {
                    const active = workName === c;
                    return (
                      <Pressable
                        key={c}
                        onPress={() => { setWorkName(c); setCategoryOpen(false); }}
                        className={`px-3 py-2 ${active ? 'bg-neutral-100' : ''}`}
                      >
                        <Text className="text-xs text-neutral-700">{c}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              <Text className="text-xs text-neutral-400 mb-1">Procurement Duration *</Text>
              <Pressable
                onPress={() => setTaskTypeOpen((v) => !v)}
                className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 mb-1"
              >
                <Text className="text-sm text-neutral-900">
                  {selectedTaskType
                    ? `Type ${typeLetter(taskTypes.indexOf(selectedTaskType))} — ${durationLabel(selectedTaskType.defaultDurationDays)}`
                    : 'Select a type'}
                </Text>
                <Text className="text-neutral-400">{taskTypeOpen ? '▲' : '▼'}</Text>
              </Pressable>
              {taskTypeOpen && (
                <View className="mb-1 border border-neutral-100 rounded-lg overflow-hidden">
                  {/* Two columns per row, per explicit request: the letter
                      (A-G, by ascending duration order — see typeLetter's
                      own comment) on the left, the actual day count on the
                      right, so the letter is never shown without the value
                      it stands for. */}
                  <View className="flex-row px-3 py-1.5 bg-neutral-50">
                    <Text className="flex-1 text-2xs font-bold uppercase tracking-wide text-neutral-400">Type</Text>
                    <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400">Days</Text>
                  </View>
                  {taskTypes.map((t, index) => {
                    const active = taskTypeId === t.id;
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => handleSelectTaskType(t)}
                        className={`flex-row items-center px-3 py-2.5 ${active ? 'bg-brand-navy' : ''} ${index < taskTypes.length - 1 ? 'border-b border-neutral-50' : ''}`}
                      >
                        <Text className={`flex-1 text-xs font-bold ${active ? 'text-white' : 'text-neutral-800'}`}>
                          Type {typeLetter(index)}
                        </Text>
                        <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-neutral-500'}`}>
                          {durationLabel(t.defaultDurationDays)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Text className="text-2xs text-neutral-400 mb-3">
                Auto-suggests Planned End Date from Planned Start Date — Planned End Date can still be changed by hand afterward.
              </Text>

              <View className="flex-row gap-2 mb-3">
                <View className="flex-1">
                  <DateField label="Planned Start Date *" value={plannedStartDate} onChange={handleStartDateChange} />
                </View>
                <View className="flex-1">
                  <DateField
                    label="Planned End Date *"
                    value={plannedEndDate}
                    minDate={plannedStartDate}
                    onChange={(iso) => { setEndManuallyEdited(true); setPlannedEndDate(iso); }}
                  />
                </View>
              </View>

              <Text className="text-xs text-neutral-400 mb-1">AC / AV *</Text>
              <View className="flex-row gap-2 mb-1">
                <Pressable
                  onPress={() => setAccountabilityType('ACC')}
                  className="flex-1 items-center py-2 rounded-lg"
                  style={{ backgroundColor: accountabilityType === 'ACC' ? '#111111' : '#F5F5F5' }}
                >
                  <Text className="text-xs font-bold" style={{ color: accountabilityType === 'ACC' ? '#ffffff' : '#525252' }}>AC</Text>
                </Pressable>
                <Pressable
                  onPress={() => setAccountabilityType('ACV')}
                  className="flex-1 items-center py-2 rounded-lg border"
                  style={{
                    backgroundColor: accountabilityType === 'ACV' ? '#111111' : '#ffffff',
                    borderColor: accountabilityType === 'ACV' ? '#111111' : '#E5E5E5',
                    borderWidth: accountabilityType === 'ACV' ? 2 : 1,
                  }}
                >
                  <Text className="text-xs font-bold" style={{ color: accountabilityType === 'ACV' ? '#ffffff' : '#525252' }}>AV</Text>
                </Pressable>
              </View>
              <Text className="text-2xs text-neutral-400 mb-3">Choosing one deselects the other — required before saving.</Text>

              <Text className="text-xs text-neutral-400 mb-1">Track Label (optional)</Text>
              <TextInput
                value={trackLabel}
                onChangeText={setTrackLabel}
                placeholder="e.g. Track 1"
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-1"
              />
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
