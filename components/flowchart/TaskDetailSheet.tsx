import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Card } from '../ui/Card';
import { DateField } from '../ui/DateField';
import { ChecklistItemRow } from '../taskDetail/ChecklistItemRow';
import { SubtaskListEditor } from '../dpr/SubtaskListEditor';
import { resolveDelayChip, formatCardDateRange, splitTaskName } from '../../lib/flowchart/delay';
import { applyTaskFieldChanges, editableFieldsEqual, type EditableTaskFields } from '../../lib/flowchart/undo';
import { fetchWorksForProject, type WorkOption } from '../../lib/flowchart/data';
import { fetchTaskDetail, type ChecklistItem } from '../../lib/taskDetail/data';
import { CATEGORIES, CATEGORY_LABEL } from '../../lib/taskDetail/constants';
import { addDaysToKey, fetchSubtasksForTask, type DprSubtaskItem } from '../../lib/dprEntries';
import { FLOOR_LEVEL_PRESETS, ROOM_TYPE_PRESETS, type AccountabilityType, type PositionedTask, type TaskTypeOption } from '../../lib/flowchart/types';

const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function formatDateKeyLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${FULL_MONTHS[m - 1].slice(0, 3)} ${y}`;
}

type DetailTab = 'edit' | 'subtasks' | 'prerequisites';

// taskTypes (prop) is fetched ordered by default_duration_days ascending —
// same deterministic A/B/C.../G-by-index labeling as CreateTaskSheet.tsx/
// TemplateTaskSheet.tsx's identical typeLetter, kept consistent across all
// three task-type pickers rather than showing letters on some and the DB's
// own raw "Type 1".."Type 7" names on others.
function typeLetter(index: number): string {
  return String.fromCharCode(65 + index); // 65 = 'A'
}

// Shared collapsed dropdown — replaces Department/Room Type/Floor Level's
// old always-expanded chip walls, by explicit request ("save a lot of
// space"): this form (Category through Actual End) was tall enough that,
// combined with a React Native Web layout gap (see the ScrollView's own
// minHeight:0 fix below), the Save button could end up genuinely
// unreachable while scrolled down. Own local `open` state per instance —
// each dropdown opens/closes independently, same expand-a-bordered-list-
// below pattern Procurement Duration already used before this pass (now
// itself rebuilt on this same shared component, not a fourth copy of the
// same markup).
function DropdownPicker<T extends string>({
  label,
  required,
  value,
  valueLabel,
  options,
  onSelect,
  editable,
  clearable,
  clearLabel,
}: {
  label: string;
  required?: boolean;
  value: T | null;
  valueLabel: string;
  options: { value: T; label: string; sublabel?: string }[];
  onSelect: (value: T | null) => void;
  editable: boolean;
  // Room Type/Floor Level are optional (tapping the active option again
  // used to clear it to null) — Department/Procurement Duration aren't
  // (Department is mandatory; Procurement Duration already had its own
  // explicit "No type" row, reused here as the clear option instead).
  clearable?: boolean;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="mb-3">
      <Text className="text-xs text-neutral-400 mb-1">
        {label}
        {required && <Text style={{ color: '#DC2626' }}> *</Text>}
      </Text>
      <Pressable
        onPress={() => editable && setOpen((v) => !v)}
        className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5"
      >
        <Text className="text-sm text-neutral-900">{valueLabel}</Text>
        {editable && <Text className="text-neutral-400">{open ? '▲' : '▼'}</Text>}
      </Pressable>
      {editable && open && (
        <View className="mt-1 border border-neutral-100 rounded-lg overflow-hidden">
          {clearable && (
            <Pressable
              onPress={() => {
                onSelect(null);
                setOpen(false);
              }}
              className="px-3 py-2 border-b border-neutral-50"
              style={{ backgroundColor: value == null ? '#0F1F33' : undefined }}
            >
              <Text className={`text-xs font-medium ${value == null ? 'text-white' : 'text-neutral-600'}`}>{clearLabel ?? 'None'}</Text>
            </Pressable>
          )}
          {options.map((opt, index) => {
            const active = value === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
                className={`flex-row items-center px-3 py-2.5 ${active ? 'bg-brand-navy' : ''} ${index < options.length - 1 ? 'border-b border-neutral-50' : ''}`}
              >
                <Text className={`flex-1 text-xs font-bold ${active ? 'text-white' : 'text-neutral-800'}`}>{opt.label}</Text>
                {opt.sublabel && <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-neutral-500'}`}>{opt.sublabel}</Text>}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

interface EditableFields {
  // Read-only display, same as admin-web's Edit Task dialog — this is the
  // "{category} — {taskName}" prefix parsed back OUT of the task's own name
  // string (splitTaskName), not an independently editable field or a
  // Work/Trade picker. Only shown at all when the name actually has that
  // prefix (bulk-imported tasks) — null otherwise, same as admin-web.
  category: string | null;
  taskName: string; // the "action" part only — category re-glued on save
  // Department (the task's real Work assignment) — mandatory, same as
  // CreateTaskSheet's own "Work *" field; null only transiently, if this
  // task somehow has no work_id set when the sheet opens.
  workId: string | null;
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
  roomType: string | null;
  floorLevel: string | null;
}

function toEditable(task: PositionedTask): EditableFields {
  const { category, action } = splitTaskName(task.taskName);
  return {
    category,
    taskName: action,
    workId: task.workId,
    plannedStartDate: task.plannedStartDate ?? '',
    dueDate: task.dueDate ?? '',
    actualStartDate: task.actualStartDate ?? '',
    actualEndDate: task.actualEndDate ?? '',
    taskTypeId: task.taskTypeId,
    accountabilityType: task.accountabilityType,
    roomType: task.roomType,
    floorLevel: task.floorLevel,
  };
}

// Same field set as admin-web's Quick Edit dialog (Task Name, Description,
// Planned Start/End, Task Type, Actual Start/End) — held in local state and
// saved together via one "Save Changes" button, matching admin-web's own
// batched submitEditForm rather than each field auto-saving on its own.
export function TaskDetailSheet({
  task,
  taskTypes,
  projectId,
  canEdit,
  canEditChecklist,
  userId,
  initialTab = 'edit',
  onClose,
  onTaskEdited,
}: {
  task: PositionedTask | null;
  taskTypes: TaskTypeOption[];
  projectId: string;
  // A client-role account has no write access at all here (RLS rejects
  // every mutation this sheet calls — see lib/flowchart/data.ts's own
  // comment on the staff-only write policies) — rendering an editable form
  // anyway would just produce a raw Postgres error on Save for a client, so
  // the fields render as plain read-only text and Save Changes is hidden
  // entirely rather than relying on the server rejection alone.
  canEdit: boolean;
  // Prerequisites' checklist items follow the SAME rule /task/[taskId].tsx's
  // own full page already uses (canEdit = role === 'staff') — deliberately
  // NOT the same value as `canEdit` above, which reflects whether THIS tap
  // chose "Edit" specifically (tied to the flowchart's lock toggle). Day-to-
  // day checklist completion is normal site work, not a structural task
  // edit, so any staff member can do it here the moment they open a task,
  // the same as they always could on that full page.
  canEditChecklist: boolean;
  // Current signed-in user — threaded through to the Prerequisites tab's
  // ChecklistItemRow (records who touched a checklist item) and the
  // Subtasks tab's per-day dpr_entries writes.
  userId: string | null;
  // Which of the 3 tabs (Edit/Subtasks/Prerequisites) this sheet opens on —
  // by explicit request, replacing the old split where the flowchart's
  // action menu's "Open" navigated to a whole separate full-page screen and
  // only "Edit" opened this sheet. Both entries now open this SAME sheet,
  // just defaulting to a different starting tab; the person can still
  // freely switch tabs from either entry point.
  initialTab?: DetailTab;
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
  const [works, setWorks] = useState<WorkOption[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab);

  // Subtasks tab — one section per planned calendar day, by explicit
  // request: "its planned date is Aug 14 to 17, 4 days, so it needs to
  // create 4 rows." A day can have SEVERAL subtasks now, each independently
  // addable/editable/deletable (see SubtaskListEditor) and independent of
  // dpr_entries entirely — a subtask routinely exists before any other DPR
  // field has ever been touched for that day.
  //
  // plannedDayKeys is derived from the LIVE form dates, not the task's
  // original ones — by explicit request: changing Planned Start/End on the
  // Edit tab (more or fewer days) should immediately resize this list
  // without needing to close and reopen the sheet.
  const plannedDayKeys = useMemo(() => {
    const startKey = form?.plannedStartDate || null;
    const endKey = form?.dueDate || null;
    if (!startKey || !endKey || startKey > endKey) return [];
    const keys: string[] = [];
    for (let k = startKey; k <= endKey; k = addDaysToKey(k, 1)) keys.push(k);
    return keys;
  }, [form?.plannedStartDate, form?.dueDate]);

  const [subtasksByDate, setSubtasksByDate] = useState<Record<string, DprSubtaskItem[]>>({});
  const [subtasksFetched, setSubtasksFetched] = useState(false);
  const [subtasksLoading, setSubtasksLoading] = useState(false);
  const [subtasksError, setSubtasksError] = useState<string | null>(null);

  // Prerequisites tab — the same real checklist items /task/[taskId].tsx
  // shows on its own full page, surfaced here too so it's reachable from
  // the same sheet as Edit/Subtasks instead of a separate navigation.
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  useEffect(() => {
    setForm(task ? toEditable(task) : null);
    setError(null);
    setActiveTab(initialTab);
    setSubtasksByDate({});
    setSubtasksFetched(false);
    setItems([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  useEffect(() => {
    fetchWorksForProject(projectId).then(setWorks).catch(() => {}); // the picker just stays empty on failure — not load-bearing for viewing the rest of the sheet
  }, [projectId]);

  // Lazy per-tab fetch — only loads once, the first time each tab is
  // actually visited, so opening the sheet (defaulting to Edit) doesn't pay
  // for Subtasks/Prerequisites data nobody asked to see this time.
  useEffect(() => {
    if (!task) return;
    if (activeTab === 'subtasks' && !subtasksFetched && !subtasksLoading) {
      setSubtasksLoading(true);
      setSubtasksError(null);
      fetchSubtasksForTask(task.id)
        .then((rows) => {
          const grouped: Record<string, DprSubtaskItem[]> = {};
          for (const s of rows) (grouped[s.reportDate] ??= []).push(s);
          setSubtasksByDate(grouped);
          setSubtasksFetched(true);
        })
        .catch((err) => setSubtasksError(err instanceof Error ? err.message : String(err)))
        .finally(() => setSubtasksLoading(false));
    }
    if (activeTab === 'prerequisites' && items.length === 0 && !itemsLoading) {
      setItemsLoading(true);
      setItemsError(null);
      fetchTaskDetail(task.id)
        .then((detail) => setItems(detail.items))
        .catch((err) => setItemsError(err instanceof Error ? err.message : String(err)))
        .finally(() => setItemsLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, task?.id]);

  function handleItemChanged(itemId: string, patch: Partial<ChecklistItem>) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)));
  }

  function handleItemDeleted(itemId: string) {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  if (!task || !form) return null;

  const delayChip = resolveDelayChip(task);
  const selectedType = taskTypes.find((t) => t.id === form.taskTypeId);

  async function handleSave() {
    if (!task || !form) return;
    // Department is mandatory (same rule as CreateTaskSheet's own "Work *")
    // — never lets a task be saved back into a null work_id.
    if (!form.workId) {
      setError('Please select a Department.');
      return;
    }
    setSaving(true);
    setError(null);
    // Re-glue the category prefix back on before saving — the form only
    // ever edits the "action" part, same convention as admin-web's own
    // submitEditForm (splits on load, re-joins with the same " — " on save).
    const fullTaskName = form.category ? `${form.category} — ${form.taskName}` : form.taskName;
    const before: EditableTaskFields = {
      taskName: task.taskName,
      // '' (never a real Work id) rather than form.workId here — task.workId
      // should never actually be null (every task the flowchart loads comes
      // through an inner join to works), but if it somehow were, this still
      // guarantees the diff below treats it as a real change and persists
      // the picked value, rather than silently no-op'ing against itself.
      workId: task.workId ?? '',
      plannedStartDate: task.plannedStartDate,
      dueDate: task.dueDate,
      actualStartDate: task.actualStartDate,
      actualEndDate: task.actualEndDate,
      taskTypeId: task.taskTypeId,
      accountabilityType: task.accountabilityType,
      roomType: task.roomType,
      floorLevel: task.floorLevel,
    };
    const after: EditableTaskFields = {
      taskName: fullTaskName,
      workId: form.workId,
      plannedStartDate: form.plannedStartDate || null,
      dueDate: form.dueDate || null,
      actualStartDate: form.actualStartDate || null,
      actualEndDate: form.actualEndDate || null,
      taskTypeId: form.taskTypeId,
      accountabilityType: form.accountabilityType,
      roomType: form.roomType,
      floorLevel: form.floorLevel,
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
        {/* overflow:'hidden' + minHeight:0 down this whole chain — by
            explicit request ("save button is not there when I scroll"). On
            React Native Web, a flex child defaults to min-height:auto (its
            own content's natural size), which overrides an ancestor's
            maxHeight — this form (Category through Actual End) was tall
            enough to push the whole Card past this wrapper's 85%, shoving
            the fixed Cancel/Save Changes footer off the bottom of the
            screen entirely, unreachable no matter how far you scrolled
            (there was nothing wrong with Save itself). minHeight:0 on both
            this wrapper and the ScrollView below is the standard flexbox
            fix — it lets each actually shrink to the available space
            instead of growing to fit all their content. */}
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380, maxHeight: '85%', overflow: 'hidden' }}>
          <Card style={{ flexShrink: 1, minHeight: 0 }}>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1, minHeight: 0 }}>
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

              {/* 3 pages reachable from the same sheet, by explicit request
                  — Edit (this form), Subtasks (per planned day), and
                  Prerequisites (the real checklist), replacing the old split
                  where "Open" left this sheet entirely for a separate
                  full-page screen. */}
              <View className="flex-row bg-neutral-100 rounded-lg p-0.5 mb-3">
                {(['subtasks', 'prerequisites', 'edit'] as DetailTab[]).map((tab) => {
                  const active = activeTab === tab;
                  return (
                    <Pressable
                      key={tab}
                      onPress={() => setActiveTab(tab)}
                      className="flex-1 items-center py-1.5 rounded-md"
                      style={{ backgroundColor: active ? '#0F1F33' : 'transparent' }}
                    >
                      <Text className="text-2xs font-bold" style={{ color: active ? '#fff' : '#525252' }}>
                        {tab === 'edit' ? 'Edit' : tab === 'subtasks' ? 'Subtasks' : 'Prerequisites'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {activeTab === 'edit' && (
              <>
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

              <DropdownPicker
                key={`${task.id}-department`}
                label="Department"
                required
                value={form.workId}
                valueLabel={works.find((w) => w.id === form.workId)?.name ?? 'Select department'}
                options={works.map((w) => ({ value: w.id, label: w.name }))}
                // No clearable — Department is mandatory, unlike Room
                // Type/Floor Level below.
                onSelect={(id) => id && setForm((f) => (f ? { ...f, workId: id } : f))}
                editable={canEdit}
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

              <DropdownPicker
                key={`${task.id}-procurement`}
                label="Procurement Duration"
                value={form.taskTypeId}
                valueLabel={selectedType ? `Type ${typeLetter(taskTypes.indexOf(selectedType))} — ${selectedType.defaultDurationDays} working days` : 'No type'}
                options={taskTypes.map((t, index) => ({ value: t.id, label: `Type ${typeLetter(index)}`, sublabel: `${t.defaultDurationDays} days` }))}
                onSelect={(id) => setForm((f) => (f ? { ...f, taskTypeId: id } : f))}
                editable={canEdit}
                clearable
                clearLabel="No type"
              />

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

              <DropdownPicker
                key={`${task.id}-room-type`}
                label="Room Type"
                value={form.roomType}
                valueLabel={form.roomType ?? 'None selected'}
                options={ROOM_TYPE_PRESETS.map((option) => ({ value: option, label: option }))}
                onSelect={(v) => setForm((f) => (f ? { ...f, roomType: v } : f))}
                editable={canEdit}
                clearable
                clearLabel="None"
              />

              <DropdownPicker
                key={`${task.id}-floor-level`}
                label="Floor Level"
                value={form.floorLevel}
                valueLabel={form.floorLevel ?? 'None selected'}
                options={FLOOR_LEVEL_PRESETS.map((option) => ({ value: option, label: option }))}
                onSelect={(v) => setForm((f) => (f ? { ...f, floorLevel: v } : f))}
                editable={canEdit}
                clearable
                clearLabel="None"
              />

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
              </>
              )}

              {activeTab === 'subtasks' && (
                <View>
                  {subtasksLoading ? (
                    <View className="py-8 items-center">
                      <ActivityIndicator color="#0F1F33" />
                    </View>
                  ) : subtasksError ? (
                    <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
                      <Text className="text-xs text-red-600">{subtasksError}</Text>
                    </View>
                  ) : plannedDayKeys.length === 0 ? (
                    <Text className="text-sm text-neutral-500 py-4 text-center">
                      No planned dates set for this task yet — set Planned Start/End on the Edit tab first.
                    </Text>
                  ) : (
                    <View className="gap-3 mb-2">
                      {plannedDayKeys.map((key) => (
                        <View key={key}>
                          <Text className="text-2xs font-semibold text-neutral-500 mb-1">{formatDateKeyLabel(key)}</Text>
                          <SubtaskListEditor
                            taskId={task.id}
                            reportDate={key}
                            works={works}
                            subtasks={subtasksByDate[key] ?? []}
                            editable={canEditChecklist}
                            onChange={(next) => setSubtasksByDate((prev) => ({ ...prev, [key]: next }))}
                          />
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {activeTab === 'prerequisites' && (
                <View>
                  {itemsLoading ? (
                    <View className="py-8 items-center">
                      <ActivityIndicator color="#0F1F33" />
                    </View>
                  ) : itemsError ? (
                    <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
                      <Text className="text-xs text-red-600">{itemsError}</Text>
                    </View>
                  ) : (
                    CATEGORIES.map((cat) => {
                      const catItems = items.filter((i) => i.category === cat);
                      if (catItems.length === 0) return null;
                      return (
                        <View key={cat} className="mb-3 border border-neutral-100 rounded-lg overflow-hidden">
                          <View className="px-3 py-1.5 bg-neutral-50">
                            <Text className="text-2xs font-bold text-neutral-600">{CATEGORY_LABEL[cat]}</Text>
                          </View>
                          {catItems.map((item, index) => (
                            <ChecklistItemRow
                              key={item.id}
                              item={item}
                              taskId={task.id}
                              editable={canEditChecklist}
                              userId={userId}
                              onChanged={handleItemChanged}
                              onDeleted={handleItemDeleted}
                              isLast={index === catItems.length - 1}
                            />
                          ))}
                        </View>
                      );
                    })
                  )}
                </View>
              )}
            </ScrollView>

            {/* Moved out of the ScrollView, right above the fixed footer —
                by explicit request ("save button is only not working"):
                this form is long enough (Category through Floor Level) that
                a Save error rendered at the TOP of the scroll area, the way
                it used to, was invisible to someone who'd scrolled down to
                edit a later field (e.g. Room Type/Floor Level) and hit Save
                without scrolling back up. Save itself was very likely
                working the whole time — the error just wasn't visible. */}
            {activeTab === 'edit' && error && (
              <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mt-3">
                <Text className="text-xs text-red-600">{error}</Text>
              </View>
            )}

            {/* Save Changes only applies to the Edit tab's fields — Subtasks
                has its own inline Save button above, and Prerequisites'
                ChecklistItemRow already saves each item the moment it's
                changed, so neither needs a second save action down here. */}
            <View className="flex-row justify-end gap-2 mt-3">
              {activeTab === 'edit' && canEdit ? (
                <>
                  <Pressable onPress={onClose} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                    <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSave}
                    disabled={saving || !form.workId}
                    className="px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5"
                    style={{ opacity: !form.workId ? 0.5 : 1 }}
                  >
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
