import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../../lib/AuthContext';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormField, FormSection, TextField } from '../../components/ui/Form';
import { Screen } from '../../components/ui/Screen';
import { StickyFooter } from '../../components/ui/StickyFooter';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, InlineError, SkeletonCard } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
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

// Edit PR — one cumulative % for the whole task + Reasons for Delay, shared
// equally across its DPR days as drafts (lib/progressReport.ts). If the
// pre-construction checklist isn't done yet, the page offers "Mark all as
// Issued" first (the database still enforces the gate).

const dayLabel = (k: string) => formatDateLabel(new Date(`${k}T00:00:00Z`));

export default function PrEditScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { state } = useAuth();
  const userId = state.status === 'signed-in' ? state.profile.id : null;
  const toast = useToast();

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

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoadError(null);
    try {
      const found = await fetchDprTaskById(taskId, todayDateKey());
      if (!found) {
        setTask(null);
        return;
      }
      setTask(found.task);
      const [d, c] = await Promise.all([fetchPrDays(taskId, found.task.plannedStartDate, found.task.plannedEndDate), fetchChecklistProgress(taskId)]);
      setDays(d);
      setChecklist(c);
      // Default: fill the empty days; if every day is already filled, overwrite.
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

  if (state.status !== 'signed-in') return <Redirect href="/login" />;

  const locked = !!task && inPreconstruction(task.status);
  const filledDays = days.filter((d) => d.percent != null);
  const emptyDays = days.length - filledDays.length;
  const alreadyFilled = filledDays.reduce((s, d) => s + (d.percent ?? 0), 0);
  const target = percentText.trim() === '' ? null : Number(percentText);
  const targetValid = target != null && Number.isInteger(target) && target >= 0 && target <= 100;
  const plan = targetValid ? planPr(days, target, mode) : null;

  function toggle(cat: DprDependencyCategory) {
    setReasons((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  async function handleIssueAll() {
    if (!taskId) return;
    setIssuing(true);
    setError(null);
    try {
      const n = await markAllPrerequisitesIssued(taskId, userId);
      toast.success(`${n} checklist item${n === 1 ? '' : 's'} marked Issued`);
      setConfirmIssue(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIssuing(false);
    }
  }

  async function handleSave() {
    if (!taskId) return;
    setError(null);
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
      toast.success(`PR saved — ${plan.targets.length} day${plan.targets.length === 1 ? '' : 's'} filled as drafts`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const footer =
    task && !locked && days.length > 0 ? (
      <StickyFooter above={error ? <InlineError message={error} onDismiss={() => setError(null)} /> : undefined}>
        <View style={{ flex: 1 }}>
          <Button label="Save PR" icon="save-outline" size="lg" fullWidth busy={saving} onPress={handleSave} />
        </View>
      </StickyFooter>
    ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'PR',
          headerStyle: { backgroundColor: colors.navy },
          headerTintColor: '#fff',
          headerTitleStyle: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 17 },
          headerShadowVisible: false,
        }}
      />
      {loading ? (
        <View style={{ padding: space.lg }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </View>
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : !task ? (
        <EmptyState icon="document-text-outline" iconColor={colors.textMuted} title="Task not found" subtitle="It may have been deleted." />
      ) : (
        <Screen footer={footer ?? undefined}>
          <AppText variant="overline">{task.workName}</AppText>
          <AppText variant="title" accessibilityRole="header" style={{ marginTop: 2, marginBottom: space.md }}>
            {task.taskName}
          </AppText>

          {/* Planned span + what's already in the DPR */}
          <FormSection compact title="Days" icon="calendar-outline">
            <AppText variant="label">
              {task.plannedStartDate && task.plannedEndDate ? `${dayLabel(task.plannedStartDate)} → ${dayLabel(task.plannedEndDate)}` : 'No planned dates'}
              {days.length ? `  ·  ${days.length} DPR day${days.length === 1 ? '' : 's'}` : ''}
            </AppText>
            <AppText variant="caption" tone="secondary">
              {filledDays.length} filled ({alreadyFilled}% so far) · {emptyDays} empty
            </AppText>
          </FormSection>

          {locked ? (
            // Pre-construction first — one tap to clear the whole checklist.
            <FormSection compact title="Pre-construction checklist pending" icon="lock-closed-outline">
              <AppText variant="body">The PR opens once the pre-construction checklist is complete.</AppText>
              {checklist ? (
                <AppText variant="label">
                  {checklist.done} of {checklist.total} items Issued / Not Required
                </AppText>
              ) : null}
              {confirmIssue ? (
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
              {error ? <InlineError message={error} onDismiss={() => setError(null)} /> : null}
            </FormSection>
          ) : days.length === 0 ? (
            <EmptyState icon="calendar-outline" iconColor={colors.textMuted} title="No planned dates yet" subtitle="Set planned dates on this task before filling a PR." />
          ) : (
            <>
              <FormSection compact title="Cumulative progress" icon="speedometer-outline">
                <FormField label="Whole task % complete" hint="Out of 100 — shared equally across the days below.">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <TextField
                      value={percentText}
                      onChangeText={setPercentText}
                      keyboardType="number-pad"
                      placeholder="e.g. 60"
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

                {/* Preview of what Save will write */}
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
                        onPress={() => toggle(cat)}
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
              {saving ? <ActivityIndicator color={colors.navy} /> : null}
            </>
          )}
        </Screen>
      )}
    </View>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
