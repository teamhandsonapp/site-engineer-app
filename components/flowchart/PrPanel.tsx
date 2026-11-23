import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { FormField, FormSection, TextField } from '../ui/Form';
import { InlineError } from '../ui/States';
import { DateField } from '../ui/DateField';
import { updateTaskActualDate } from '../../lib/flowchart/data';
import { colors, radius, space } from '../../lib/theme';
import { formatDateLabel } from '../../lib/formatTime';
import {
  DPR_DEPENDENCY_CATEGORIES,
  DPR_DEPENDENCY_LABEL,
  fetchChecklistProgress,
  fetchDprTaskById,
  inPreconstruction,
  todayDateKey,
  type DprDependencyCategory,
  type DprTask,
} from '../../lib/dprEntries';
import { fetchPrDays, markAllPrerequisitesIssued, planPr, savePr, type PrDay, type PrMode } from '../../lib/progressReport';

// Task sheet "PR" tab (Flowchart 2): the same PR as the PR page
// (app/pr-edit/[taskId].tsx) — one cumulative % for the whole task, shared
// across its planned DPR days as drafts, plus Reasons for Delay with comments.
// If the pre-construction checklist isn't done yet it offers "Mark all as
// Issued" first, exactly like the page. All saving goes through
// lib/progressReport.ts, so both places write the same data.

const dayLabel = (k: string) => formatDateLabel(new Date(`${k}T00:00:00Z`));

export function PrPanel({ taskId, userId, editable }: { taskId: string; userId: string | null; editable: boolean }) {
  const [task, setTask] = useState<DprTask | null>(null);
  const [days, setDays] = useState<PrDay[]>([]);
  const [checklist, setChecklist] = useState<{ done: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [percentText, setPercentText] = useState('');
  const [mode, setMode] = useState<PrMode>('fill-empty');
  const [reasons, setReasons] = useState<DprDependencyCategory[]>([]);
  const [comments, setComments] = useState<Partial<Record<DprDependencyCategory, string>>>({});
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Actual Start / Actual End — saved the same way as the Edit tab
  // (updateTaskActualDate: an Actual Start moves a not-started task to In progress).
  const [actualStart, setActualStart] = useState<string | null>(null);
  const [actualEnd, setActualEnd] = useState<string | null>(null);
  const [savingDates, setSavingDates] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const found = await fetchDprTaskById(taskId, todayDateKey());
      if (!found) {
        setTask(null);
        return;
      }
      setTask(found.task);
      setActualStart(found.task.actualStartDate);
      setActualEnd(found.task.actualEndDate);
      const [d, c] = await Promise.all([fetchPrDays(taskId, found.task.plannedStartDate, found.task.plannedEndDate), fetchChecklistProgress(taskId)]);
      setDays(d);
      setChecklist(c);
      const filled = d.filter((x) => x.percent != null).length;
      setMode(d.length > 0 && filled === d.length ? 'overwrite' : 'fill-empty');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={{ paddingVertical: space.xl, alignItems: 'center' }}>
        <ActivityIndicator color={colors.navy} />
      </View>
    );
  }
  if (loadError) return <InlineError message={loadError} />;
  if (!task) return <AppText variant="body">{"This task isn't available for PR."}</AppText>;

  const locked = inPreconstruction(task.status);
  const filledDays = days.filter((d) => d.percent != null);
  const alreadyFilled = filledDays.reduce((s, d) => s + (d.percent ?? 0), 0);
  const target = percentText.trim() === '' ? null : Number(percentText);
  const targetValid = target != null && Number.isInteger(target) && target >= 0 && target <= 100;
  const plan = targetValid ? planPr(days, target, mode) : null;

  const datesChanged = actualStart !== task.actualStartDate || actualEnd !== task.actualEndDate;

  async function handleSaveDates() {
    if (!task) return;
    setError(null);
    setNotice(null);
    if (actualEnd && !actualStart) {
      setError('Enter the Actual Start before the Actual End.');
      return;
    }
    if (actualStart && actualEnd && actualEnd < actualStart) {
      setError('Actual End cannot be before Actual Start.');
      return;
    }
    setSavingDates(true);
    try {
      if (actualStart !== task.actualStartDate) await updateTaskActualDate(taskId, 'actual_start_date', actualStart);
      if (actualEnd !== task.actualEndDate) await updateTaskActualDate(taskId, 'actual_end_date', actualEnd);
      setNotice('Actual dates saved — tap ⟳ on the flowchart to see them on the card');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDates(false);
    }
  }

  async function handleIssueAll() {
    setIssuing(true);
    setError(null);
    try {
      const n = await markAllPrerequisitesIssued(taskId, userId);
      setNotice(`${n} checklist item${n === 1 ? '' : 's'} marked Issued`);
      setConfirmIssue(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIssuing(false);
    }
  }

  async function handleSave() {
    setError(null);
    setNotice(null);
    if (!targetValid) {
      setError('Enter the cumulative % as a whole number from 0 to 100.');
      return;
    }
    const missing = reasons.filter((c) => !comments[c]?.trim());
    if (missing.length) {
      setError(`Add a comment for: ${missing.map((c) => DPR_DEPENDENCY_LABEL[c]).join(', ')}.`);
      return;
    }
    if (!plan || plan.error) {
      setError(plan?.error ?? 'Nothing to save.');
      return;
    }
    setSaving(true);
    try {
      await savePr(taskId, plan.targets, reasons, comments, userId);
      setNotice(`PR saved — ${plan.targets.length} day${plan.targets.length === 1 ? '' : 's'} filled as drafts`);
      setPercentText('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View testID="pr-panel" style={{ gap: space.sm }}>
      <FormSection compact title="Days" icon="calendar-outline">
        <AppText variant="label">
          {task.plannedStartDate && task.plannedEndDate ? `${dayLabel(task.plannedStartDate)} → ${dayLabel(task.plannedEndDate)}` : 'No planned dates'}
          {days.length ? `  ·  ${days.length} DPR day${days.length === 1 ? '' : 's'}` : ''}
        </AppText>
        <AppText variant="caption" tone="secondary">
          {filledDays.length} filled ({alreadyFilled}% so far) · {days.length - filledDays.length} empty
        </AppText>
      </FormSection>

      <FormSection compact title="Actual dates" icon="flag-outline">
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <DateField label="Actual Start" value={actualStart} editable={editable && !locked} maxDate={actualEnd} onChange={setActualStart} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="Actual End" value={actualEnd} editable={editable && !locked && !!actualStart} minDate={actualStart} onChange={setActualEnd} />
          </View>
        </View>
        {locked ? (
          <AppText variant="caption" tone="secondary">
            Actual dates can be entered once the pre-construction checklist is complete (Mark all as Issued below).
          </AppText>
        ) : editable && datesChanged ? (
          <Button label="Save actual dates" icon="save-outline" variant="secondary" fullWidth busy={savingDates} onPress={handleSaveDates} />
        ) : null}
      </FormSection>

      {locked ? (
        <FormSection compact title="Pre-construction checklist pending" icon="lock-closed-outline">
          <AppText variant="body">The PR opens once the pre-construction checklist is complete.</AppText>
          {checklist ? (
            <AppText variant="label">
              {checklist.done} of {checklist.total} items Issued / Not Required
            </AppText>
          ) : null}
          {!editable ? null : confirmIssue ? (
            <View style={{ gap: space.sm }}>
              <AppText variant="caption" tone="warning">
                This marks every remaining item as Issued. Items already Issued or Not Required stay as they are.
              </AppText>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button label="Cancel" variant="secondary" fullWidth onPress={() => setConfirmIssue(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Yes, mark all" icon="checkmark-done" variant="success" fullWidth busy={issuing} onPress={handleIssueAll} />
                </View>
              </View>
            </View>
          ) : (
            <Button label="Mark all as Issued" icon="checkmark-done-outline" fullWidth onPress={() => setConfirmIssue(true)} />
          )}
        </FormSection>
      ) : days.length === 0 ? (
        <AppText variant="body" tone="secondary">
          Set planned dates on this task (Edit tab) before filling a PR.
        </AppText>
      ) : (
        <>
          <FormSection compact title="Cumulative progress" icon="speedometer-outline">
            <FormField label="Whole task % complete" hint="Out of 100 — shared equally across the days below.">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <TextField
                  testID="pr-panel-percent"
                  value={percentText}
                  onChangeText={setPercentText}
                  keyboardType="number-pad"
                  placeholder="e.g. 60"
                  editable={editable}
                  invalid={percentText !== '' && !targetValid}
                  style={{ width: 90, minHeight: 40 }}
                  accessibilityLabel="Cumulative percent complete"
                />
                <AppText variant="bodyStrong" tone="muted">
                  %
                </AppText>
              </View>
            </FormField>

            {filledDays.length > 0 ? (
              <View style={{ gap: 6 }}>
                {(
                  [
                    { key: 'fill-empty', title: 'Fill only the empty days', sub: `Keep the ${filledDays.length} filled day${filledDays.length === 1 ? '' : 's'} as they are` },
                    { key: 'overwrite', title: 'Overwrite all days', sub: `Replace all ${days.length} days with the new %` },
                  ] as const
                ).map((opt) => {
                  const active = mode === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      onPress={() => setMode(opt.key)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.sm,
                        padding: space.sm,
                        borderRadius: radius.sm,
                        borderWidth: 1,
                        borderColor: active ? colors.navy : colors.border,
                        backgroundColor: active ? colors.navySoft : colors.surface,
                      }}
                    >
                      <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={18} color={active ? colors.navy : colors.textMuted} />
                      <View style={{ flex: 1 }}>
                        <AppText variant="bodyStrong">{opt.title}</AppText>
                        <AppText variant="caption">{opt.sub}</AppText>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {plan ? (
              plan.error ? (
                <AppText variant="caption" tone="danger">
                  {plan.error}
                </AppText>
              ) : (
                <View style={{ borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, padding: space.sm, gap: 2 }}>
                  {plan.targets.map((t) => (
                    <View key={t.reportDate} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <AppText variant="caption">{dayLabel(t.reportDate)}</AppText>
                      <AppText variant="label">{t.percent}%</AppText>
                    </View>
                  ))}
                </View>
              )
            ) : null}
          </FormSection>

          <FormSection compact title="Reasons for Delay" icon="alert-circle-outline">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {DPR_DEPENDENCY_CATEGORIES.map((cat) => {
                const active = reasons.includes(cat);
                return (
                  <Pressable
                    key={cat}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    onPress={() => setReasons((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]))}
                    style={{
                      minHeight: 34,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: space.md,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: active ? colors.navy : colors.border,
                      backgroundColor: active ? colors.navy : colors.surface,
                    }}
                  >
                    {active ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                    <AppText variant="label" style={{ color: active ? '#fff' : colors.textSecondary }}>
                      {DPR_DEPENDENCY_LABEL[cat]}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            {DPR_DEPENDENCY_CATEGORIES.filter((c) => reasons.includes(c)).map((cat) => (
              <TextField
                key={cat}
                value={comments[cat] ?? ''}
                onChangeText={(text) => setComments((prev) => ({ ...prev, [cat]: text }))}
                placeholder={`${DPR_DEPENDENCY_LABEL[cat]}: what is the delay about?`}
                multiline
                style={{ minHeight: 56, paddingVertical: space.sm }}
                accessibilityLabel={`Comment for ${DPR_DEPENDENCY_LABEL[cat]} delay`}
              />
            ))}
          </FormSection>

          {editable ? <Button label="Save PR" icon="save-outline" fullWidth busy={saving} onPress={handleSave} /> : null}
        </>
      )}

      {error ? <InlineError message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <AppText variant="caption" style={{ color: '#15803D' }}>
          {notice}
        </AppText>
      ) : null}
    </View>
  );
}
