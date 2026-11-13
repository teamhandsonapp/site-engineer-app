// DPR › "+ Add task": report progress on a task that started on site before
// it reached today's DPR list. Steps: Department → Task → Progress →
// Summary (+ workers attendance, same rule as a normal DPR submit) → Submit.
// Back keeps everything entered. Saving goes through one database function
// (lib/dprAddTask.ts › submitTaskFromSite).

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from '../ui/AppText';
import { Button } from '../ui/Button';
import { DateField } from '../ui/DateField';
import { FormModal } from '../ui/FormModal';
import { useToast } from '../ui/Toast';
import { colors, radius, space } from '../../lib/theme';
import { fetchDepartments, type Department } from '../../lib/departments';
import type { DprDependencyCategory } from '../../lib/dprEntries';
import {
  delayReasonNeeded,
  fetchAddableCounts,
  fetchAddableTasks,
  fetchReportedPercent,
  fetchUnfinishedPredecessors,
  submitTaskFromSite,
  timingOf,
  type AddableTask,
} from '../../lib/dprAddTask';
import { DepartmentTiles } from '../drawingFiles/parts';
import { TaskWorkersAttendance, type TaskAttendanceState } from '../workforce/TaskWorkersAttendance';

type Step = 'dept' | 'task' | 'progress' | 'summary';
const STEPS: Step[] = ['dept', 'task', 'progress', 'summary'];
const STEP_TITLE: Record<Step, string> = { dept: 'Department', task: 'Task', progress: 'Progress', summary: 'Review & submit' };
const REASONS: { key: DprDependencyCategory; label: string }[] = [
  { key: 'architect', label: 'Architect' },
  { key: 'client', label: 'Client' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'other', label: 'Other' },
];
const STATUS_COLOR: Record<string, string> = { in_progress: '#1D4ED8', on_hold: '#B45309', blocked: '#DC2626', ready: '#15803D', draft: '#6B7280' };
const TAG_COLOR = { early: '#15803D', on_time: '#1D4ED8', delayed: '#DC2626' } as const;

function shortDate(key: string | null): string {
  if (!key) return '—';
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}

export function DprAddTaskSheet({
  visible,
  projectId,
  todayKey,
  todayListIds,
  userId,
  onClose,
  onAdded,
}: {
  visible: boolean;
  projectId: string;
  todayKey: string;
  todayListIds: Set<string>;
  userId: string | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [step, setStep] = useState<Step>('dept');
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [dept, setDept] = useState<Department | null>(null);
  // Tasks each department could add (not completed, not in today's list).
  const [counts, setCounts] = useState<Map<string, { total: number; addable: number }> | null>(null);
  const [tasks, setTasks] = useState<AddableTask[] | null>(null);
  const [query, setQuery] = useState('');
  const [task, setTask] = useState<AddableTask | null>(null);
  const [reported, setReported] = useState(0);
  const [preds, setPreds] = useState<string[]>([]);
  const [actualStart, setActualStart] = useState<string | null>(null);
  const [actualEnd, setActualEnd] = useState<string | null>(null);
  const [percentText, setPercentText] = useState('');
  const [reasons, setReasons] = useState<DprDependencyCategory[]>([]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attendance, setAttendance] = useState<TaskAttendanceState>({ loaded: false, hasFolder: false, total: 0, unmarked: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fresh start each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setStep('dept');
    setDept(null);
    setTask(null);
    setQuery('');
    setActualStart(null);
    setActualEnd(null);
    setPercentText('');
    setReasons([]);
    setNote('');
    setErrors({});
    setSubmitError(null);
    fetchDepartments(projectId).then(setDepartments).catch(() => setDepartments([]));
    setCounts(null);
    fetchAddableCounts(projectId, new Set()).then(setCounts).catch(() => setCounts(null));
  }, [visible, projectId]);

  function pickDept(d: Department) {
    setDept(d);
    setTasks(null);
    setQuery('');
    setStep('task');
    // Every open task of the department — not limited by today's DPR list (2026-11-13).
    fetchAddableTasks(projectId, d.id, new Set()).then(setTasks).catch(() => setTasks([]));
  }

  function pickTask(t: AddableTask) {
    if (task?.id !== t.id) {
      setActualStart(null);
      setActualEnd(null);
      setPercentText('');
      setReasons([]);
      setNote('');
      setErrors({});
    }
    setTask(t);
    setStep('progress');
    fetchReportedPercent(t.id).then(setReported).catch(() => setReported(0));
    fetchUnfinishedPredecessors(t.id).then(setPreds).catch(() => setPreds([]));
  }

  const percent = actualEnd ? 100 : Number(percentText);
  const timing = timingOf(task?.plannedStart ?? null, actualStart);
  const reasonWhy = task ? delayReasonNeeded(task, actualStart, actualEnd, Number.isFinite(percent) ? percent : 0, todayKey) : null;

  function validateProgress(): boolean {
    const e: Record<string, string> = {};
    if (!actualStart) e.start = 'Pick the actual start date';
    else if (actualStart > todayKey) e.start = "Actual start can't be in the future";
    if (actualEnd) {
      if (actualStart && actualEnd < actualStart) e.end = "Actual end can't be before actual start";
      else if (actualEnd > todayKey) e.end = "Actual end can't be in the future";
    }
    if (!actualEnd) {
      if (percentText.trim() === '' || !Number.isFinite(percent)) e.percent = 'Enter the progress %';
      else if (percent < 0 || percent > 100) e.percent = 'Progress must be 0–100';
      else if (percent < reported) e.percent = `Can't be lower than the last reported ${reported}%`;
    }
    if (reasonWhy) {
      if (reasons.length === 0) e.reason = 'Pick at least one reason for the delay';
      else if (reasons.includes('other') && !note.trim()) e.reason = 'Describe the "Other" reason';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const attendanceOk = attendance.loaded && attendance.hasFolder && attendance.total > 0 && attendance.unmarked === 0;

  async function submit() {
    if (!task) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitTaskFromSite({ taskId: task.id, actualStart: actualStart as string, actualEnd, percent, reasons, note, userId });
      toast.success(`${task.name} added to today's DPR`);
      onAdded();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const q = query.trim().toLowerCase();
  const shownTasks = useMemo(() => (tasks ?? []).filter((t) => !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)), [tasks, q]);
  const stepIndex = STEPS.indexOf(step);

  function back() {
    if (stepIndex === 0) onClose();
    else setStep(STEPS[stepIndex - 1]);
  }

  return (
    <FormModal visible={visible} onRequestClose={() => !submitting && back()} position="bottom" animationType="slide">
      <View
        style={{
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.lg,
          marginTop: insets.top + 24,
          width: '100%',
          maxWidth: 640,
          alignSelf: 'center',
        }}
      >
        {/* Header: Back · title · step x of 4 · close */}
        <View className="flex-row items-center gap-2 mb-1">
          <Pressable testID="dpr-add-back" onPress={back} disabled={submitting} hitSlop={10} accessibilityLabel={stepIndex === 0 ? 'Close' : 'Back'}>
            <Ionicons name={stepIndex === 0 ? 'close' : 'arrow-back'} size={22} color={colors.navy} />
          </Pressable>
          <Text className="flex-1 text-base font-bold text-neutral-900">Add task · {STEP_TITLE[step]}</Text>
          <Text className="text-2xs text-neutral-500">
            {stepIndex + 1} of {STEPS.length}
          </Text>
          {stepIndex > 0 ? (
            <Pressable onPress={onClose} disabled={submitting} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Text className="text-2xs text-neutral-500 mb-3">Report progress on any open task of a department.</Text>

        {/* 1. Department */}
        {step === 'dept' ? (
          departments === null ? (
            <ActivityIndicator color={colors.navy} style={{ marginVertical: 24 }} />
          ) : departments.length === 0 ? (
            <Text className="text-sm text-neutral-500">This project has no departments yet.</Text>
          ) : (
            <View testID="dpr-add-departments">
              <DepartmentTiles
                departments={departments}
                value={dept?.id ?? null}
                onChange={(id) => pickDept(departments.find((d) => d.id === id) as Department)}
                countLabel={(id) => {
                  if (!counts) return '…';
                  const n = counts.get(id)?.total ?? 0;
                  return `${n} task${n === 1 ? '' : 's'}`;
                }}
              />
            </View>
          )
        ) : null}

        {/* 2. Task */}
        {step === 'task' && dept ? (
          <View>
            <Text className="text-xs font-semibold text-neutral-600 mb-2">{dept.name} · all open tasks</Text>
            <View className="flex-row items-center gap-2 border border-neutral-200 rounded-lg px-3 bg-white mb-2" style={{ minHeight: 42 }}>
              <Ionicons name="search" size={15} color="#6B7280" />
              <TextInput
                testID="dpr-add-task-search"
                value={query}
                onChangeText={setQuery}
                placeholder="Search tasks"
                placeholderTextColor={colors.placeholder}
                className="flex-1 text-sm text-neutral-900"
                style={{ paddingVertical: 8 }}
              />
            </View>
            {tasks === null ? <ActivityIndicator color={colors.navy} style={{ marginVertical: 16 }} /> : null}
            {tasks !== null && tasks.length === 0 ? (
              <Text testID="dpr-add-no-tasks" className="text-sm text-neutral-500 py-3">No open tasks in this department</Text>
            ) : null}
            <View className="rounded-xl bg-white border border-neutral-100 overflow-hidden">
              {shownTasks.map((t, i) => (
                <Pressable
                  key={t.id}
                  testID={`dpr-add-task-${t.code}`}
                  onPress={() => pickTask(t)}
                  className={`flex-row items-center gap-2 px-3 ${i > 0 ? 'border-t border-neutral-100' : ''}`}
                  style={{ minHeight: 52, backgroundColor: task?.id === t.id ? '#F8FAFC' : '#fff' }}
                  accessibilityRole="button"
                >
                  <View className="flex-1 py-1.5">
                    <Text className="text-sm font-semibold text-neutral-900" numberOfLines={1}>
                      {t.name}
                    </Text>
                    <Text className="text-2xs text-neutral-500" numberOfLines={1}>
                      {t.code} · {shortDate(t.plannedStart)} → {shortDate(t.plannedEnd)}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: STATUS_COLOR[t.status] ?? '#6B7280' }}>{t.status.replace(/_/g, ' ')}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                </Pressable>
              ))}
              {tasks && tasks.length > 0 && shownTasks.length === 0 ? <Text className="text-xs text-neutral-500 px-3 py-3">No task matches “{query}”.</Text> : null}
            </View>
          </View>
        ) : null}

        {/* 3. Progress */}
        {step === 'progress' && task ? (
          <View className="gap-3">
            <View className="rounded-xl bg-white border border-neutral-100 px-3 py-2.5">
              <Text className="text-sm font-bold text-neutral-900" numberOfLines={2}>
                {task.name}
              </Text>
              <View className="flex-row flex-wrap items-center gap-x-2 mt-0.5">
                <Text className="text-2xs text-neutral-500">
                  Planned {shortDate(task.plannedStart)} → {shortDate(task.plannedEnd)}
                  {reported > 0 ? ` · Reported so far ${reported}%` : ''}
                </Text>
                {timing ? (
                  <View testID="dpr-add-timing-tag" style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: `${TAG_COLOR[timing.tag]}1A` }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: TAG_COLOR[timing.tag] }}>{timing.label}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1" testID="dpr-add-actual-start">
                <DateField label="Actual start *" value={actualStart} maxDate={todayKey} onChange={(v) => { setActualStart(v); setErrors((e) => ({ ...e, start: '' })); }} />
                {errors.start ? <Text className="text-2xs font-semibold mt-1" style={{ color: colors.danger }}>{errors.start}</Text> : null}
              </View>
              <View className="flex-1" testID="dpr-add-actual-end">
                <DateField label="Actual end (if finished)" value={actualEnd} minDate={actualStart} maxDate={todayKey} onChange={(v) => { setActualEnd(v); setErrors((e) => ({ ...e, end: '', percent: '' })); }} />
                {actualEnd ? (
                  <Pressable onPress={() => setActualEnd(null)} hitSlop={6}>
                    <Text className="text-2xs font-semibold text-brand-navy mt-1">Clear end date</Text>
                  </Pressable>
                ) : null}
                {errors.end ? <Text className="text-2xs font-semibold mt-1" style={{ color: colors.danger }}>{errors.end}</Text> : null}
              </View>
            </View>

            <View>
              <Text className="text-xs text-neutral-500 mb-1">Cumulative progress % *</Text>
              <View className="flex-row items-center gap-2">
                <TextInput
                  testID="dpr-add-percent"
                  value={actualEnd ? '100' : percentText}
                  editable={!actualEnd}
                  onChangeText={(v) => setPercentText(v.replace(/[^0-9]/g, '').slice(0, 3))}
                  keyboardType="number-pad"
                  placeholder={reported ? `${reported}–100` : '0–100'}
                  placeholderTextColor={colors.placeholder}
                  className="border border-neutral-200 rounded-lg px-3 text-sm text-neutral-900 bg-white"
                  style={{ minHeight: 44, width: 100, opacity: actualEnd ? 0.6 : 1 }}
                />
                <Text className="text-sm font-semibold text-neutral-700">%</Text>
                {actualEnd ? <Text className="text-2xs text-neutral-500 flex-1">Set to 100% because the task is finished.</Text> : null}
              </View>
              {errors.percent ? <Text className="text-2xs font-semibold mt-1" style={{ color: colors.danger }}>{errors.percent}</Text> : null}
            </View>

            <View>
              <Text className="text-xs text-neutral-500 mb-1">{reasonWhy ? 'Reason for delay *' : 'Remarks (optional)'}</Text>
              {reasonWhy ? (
                <Text testID="dpr-add-reason-why" className="text-2xs font-semibold mb-1.5" style={{ color: colors.danger }}>
                  Required: {reasonWhy}
                </Text>
              ) : null}
              {reasonWhy ? (
                <View className="flex-row flex-wrap gap-1.5 mb-2">
                  {REASONS.map((r) => {
                    const on = reasons.includes(r.key);
                    return (
                      <Pressable
                        key={r.key}
                        testID={`dpr-add-reason-${r.key}`}
                        onPress={() => setReasons((prev) => (on ? prev.filter((x) => x !== r.key) : [...prev, r.key]))}
                        className="rounded-full px-3 border"
                        style={{ minHeight: 34, justifyContent: 'center', backgroundColor: on ? colors.navy : '#fff', borderColor: on ? colors.navy : colors.border }}
                      >
                        <Text className="text-xs font-semibold" style={{ color: on ? '#fff' : colors.text }}>{r.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              <TextInput
                testID="dpr-add-note"
                value={note}
                onChangeText={setNote}
                multiline
                maxLength={500}
                placeholder={reasonWhy ? 'Details (what caused the delay?)' : 'Anything to note about this task'}
                placeholderTextColor={colors.placeholder}
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white"
                style={{ minHeight: 64, textAlignVertical: 'top' }}
              />
              {errors.reason ? <Text className="text-2xs font-semibold mt-1" style={{ color: colors.danger }}>{errors.reason}</Text> : null}
            </View>

            <Button testID="dpr-add-next" label="Next: review" icon="arrow-forward" onPress={() => validateProgress() && setStep('summary')} fullWidth />
          </View>
        ) : null}

        {/* 4. Summary + attendance + submit */}
        {step === 'summary' && task && dept ? (
          <View className="gap-3">
            <View testID="dpr-add-summary" className="rounded-xl bg-white border border-neutral-100 px-3 py-2.5 gap-1">
              <Text className="text-sm font-bold text-neutral-900" numberOfLines={2}>{task.name}</Text>
              {[
                ['Department', dept.name],
                ['Planned', `${shortDate(task.plannedStart)} → ${shortDate(task.plannedEnd)}`],
                ['Actual', `${shortDate(actualStart)}${actualEnd ? ` → ${shortDate(actualEnd)}` : ' → (ongoing)'}`],
                ['Progress', `${percent}%${percent >= 100 ? ' · will be marked Completed' : ' · will be In Progress'}`],
                ['Timing', timing?.label ?? '—'],
                [reasonWhy ? 'Reason' : 'Remarks', [reasons.map((r) => REASONS.find((x) => x.key === r)?.label).join(', '), note.trim()].filter(Boolean).join(' — ') || '—'],
              ].map(([k, v]) => (
                <View key={k} className="flex-row gap-2">
                  <Text className="text-xs text-neutral-500" style={{ width: 84 }}>{k}</Text>
                  <Text className="text-xs font-semibold text-neutral-900 flex-1">{v}</Text>
                </View>
              ))}
            </View>

            {preds.length > 0 ? (
              <View testID="dpr-add-pred-warning" className="flex-row gap-2 rounded-xl px-3 py-2.5" style={{ backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' }}>
                <Ionicons name="warning-outline" size={16} color="#B45309" style={{ marginTop: 1 }} />
                <Text className="flex-1 text-xs" style={{ color: '#92400E' }}>
                  {preds.join(', ')} {preds.length === 1 ? "isn't" : "aren't"} finished yet — continue anyway?
                </Text>
              </View>
            ) : null}

            <View>
              <Text className="text-xs font-bold text-neutral-700 mb-1.5">Workers attendance today — needed before Submit</Text>
              <TaskWorkersAttendance projectId={projectId} workId={dept.id} workName={dept.name} dateKey={todayKey} userId={userId} onStateChange={setAttendance} />
              {/* "N not marked" is already shown by the attendance card itself. */}
              {attendance.loaded && (!attendance.hasFolder || attendance.total === 0) ? (
                <Text className="text-2xs font-semibold mt-1" style={{ color: colors.danger }}>
                  No {dept.name} workers added yet — add them in the Attendance tab first.
                </Text>
              ) : null}
            </View>

            {submitError ? (
              <View className="rounded-xl px-3 py-2.5" style={{ backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' }}>
                <Text className="text-xs font-semibold" style={{ color: '#B91C1C' }}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              testID="dpr-add-submit"
              label={preds.length ? 'Submit anyway' : 'Submit'}
              icon="checkmark"
              size="lg"
              fullWidth
              busy={submitting}
              disabled={!attendanceOk || submitting}
              onPress={() => void submit()}
            />
          </View>
        ) : null}
      </View>
    </FormModal>
  );
}
