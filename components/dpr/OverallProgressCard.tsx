import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Pressable } from '../ui/Pressable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { DateField } from '../ui/DateField';
import { FormField, FormSection, TextField } from '../ui/Form';
import { InlineError } from '../ui/States';
import { useToast } from '../ui/Toast';
import { colors, radius, space } from '../../lib/theme';
import { formatDateLabel } from '../../lib/formatTime';
import { countWorkingDaysBetween } from '../../lib/workingDays';
import { fetchBlockedDates } from '../../lib/reports/generalParameterReport';
import {
  DPR_DEPENDENCY_CATEGORIES,
  DPR_DEPENDENCY_LABEL,
  fetchOverallProgress,
  saveOverallProgress,
  type DprDependencyCategory,
  type DprTask,
} from '../../lib/dprEntries';

const keyDate = (k: string) => new Date(`${k}T00:00:00Z`);

function SpanRow({ label, start, end, endFallback, days }: { label: string; start: string | null; end: string | null; endFallback?: string; days: string | null }) {
  const fmt = (k: string | null, fallback = '—') => (k ? formatDateLabel(keyDate(k)) : fallback);
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <AppText variant="caption">{label}</AppText>
        <AppText variant="label" style={{ flexShrink: 1, textAlign: 'right' }}>
          {start ? `${fmt(start)} → ${fmt(end, endFallback ?? '—')}` : '—'}
        </AppText>
      </View>
      {days ? (
        <AppText variant="caption" tone="muted" style={{ textAlign: 'right' }}>
          {days}
        </AppText>
      ) : null}
    </View>
  );
}

// Top of the DPR screen, by explicit request (2026-11-09): instead of
// filling DPR 1..N one day at a time, enter ONE overall % for the whole task
// (out of 100), the real start/end dates, and Reasons for Delay — several
// at once, each with its own comment. Saved to dpr_entries (see
// saveOverallProgress) so the reports pick it up as-is.
export function OverallProgressCard({
  task,
  userId,
  onSetActualStart,
  onSetActualEnd,
  dateError,
  onSaved,
}: {
  task: DprTask;
  userId: string | null;
  onSetActualStart: (iso: string) => void;
  onSetActualEnd: (iso: string) => void;
  dateError: string | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [percentText, setPercentText] = useState('');
  const [reasons, setReasons] = useState<DprDependencyCategory[]>([]);
  const [comments, setComments] = useState<Partial<Record<DprDependencyCategory, string>>>({});
  const [savedLine, setSavedLine] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOverallProgress(task.id)
      .then((p) => {
        if (cancelled) return;
        setPercentText(p.overallPercent > 0 ? String(p.overallPercent) : '');
        setReasons(p.reasons);
        setComments(p.comments);
        setSavedLine(p.savedOn ? `Last saved ${formatDateLabel(new Date(`${p.savedOn}T00:00:00Z`))}${p.savedByName ? ` by ${p.savedByName}` : ''}` : null);
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const today = new Date().toISOString().slice(0, 10);

  // Working days = every day in the range except the holidays table — the
  // same rule as the report's "Planned Working Days", applied to the actual
  // dates too (actual start -> actual end, or -> today while running).
  const [blocked, setBlocked] = useState<Set<string> | null>(null);
  const yearsKey = [task.plannedStartDate, task.plannedEndDate, task.actualStartDate, task.actualEndDate, today]
    .filter((k): k is string => !!k)
    .map((k) => k.slice(0, 4))
    .sort()
    .join(',');
  useEffect(() => {
    let cancelled = false;
    fetchBlockedDates(new Set(yearsKey.split(',').map(Number)))
      .then((b) => !cancelled && setBlocked(b))
      .catch(() => !cancelled && setBlocked(new Set()));
    return () => {
      cancelled = true;
    };
  }, [yearsKey]);
  const plannedWorkingDays =
    blocked && task.plannedStartDate && task.plannedEndDate
      ? countWorkingDaysBetween(keyDate(task.plannedStartDate), keyDate(task.plannedEndDate), blocked)
      : null;
  const actualOngoing = !!task.actualStartDate && !task.actualEndDate;
  const actualWorkingDays =
    blocked && task.actualStartDate ? countWorkingDaysBetween(keyDate(task.actualStartDate), keyDate(task.actualEndDate ?? today), blocked) : null;
  const extraDays = plannedWorkingDays != null && actualWorkingDays != null ? actualWorkingDays - plannedWorkingDays : null;

  const percent = percentText.trim() === '' ? null : Number(percentText);
  const percentValid = percent == null || (Number.isFinite(percent) && percent >= 0 && percent <= 100);
  const barPercent = percent != null && percentValid ? percent : 0;

  function toggle(cat: DprDependencyCategory) {
    setReasons((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  async function handleSave() {
    setError(null);
    if (percent == null || !percentValid) {
      setError('Enter the overall progress as a number from 0 to 100.');
      return;
    }
    const missing = reasons.filter((c) => !comments[c]?.trim());
    if (missing.length > 0) {
      setError(`Add a comment for: ${missing.map((c) => DPR_DEPENDENCY_LABEL[c]).join(', ')}.`);
      return;
    }
    setSaving(true);
    try {
      await saveOverallProgress(task.id, percent, reasons, comments, userId);
      setSavedLine(`Last saved ${formatDateLabel(new Date(`${today}T00:00:00Z`))}`);
      toast.success('Overall progress saved');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSection title="Overall progress" icon="speedometer-outline" description="One total for the whole task — no need to fill every day.">
      {loading ? (
        <ActivityIndicator color={colors.navy} />
      ) : loadError ? (
        <InlineError message={loadError} />
      ) : (
        <>
          <View style={{ borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, padding: space.md, gap: 6 }}>
            <SpanRow
              label="Planned"
              start={task.plannedStartDate}
              end={task.plannedEndDate}
              days={plannedWorkingDays != null ? `${plannedWorkingDays} working day${plannedWorkingDays === 1 ? '' : 's'}` : null}
            />
            <SpanRow
              label="Actual"
              start={task.actualStartDate}
              end={task.actualEndDate}
              endFallback={task.actualStartDate ? 'ongoing' : undefined}
              days={
                actualWorkingDays != null
                  ? `${actualWorkingDays} working day${actualWorkingDays === 1 ? '' : 's'}${actualOngoing ? ' so far' : ''}`
                  : 'Not started'
              }
            />
            {extraDays != null && extraDays !== 0 && (!actualOngoing || extraDays > 0) ? (
              <AppText variant="caption" tone={extraDays > 0 ? 'danger' : 'success'} style={{ textAlign: 'right' }}>
                {extraDays > 0 ? `${extraDays} working day${extraDays === 1 ? '' : 's'} over plan` : `${-extraDays} working day${extraDays === -1 ? '' : 's'} under plan`}
              </AppText>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <FormField label="Actual Start">
                <DateField value={task.actualStartDate} onChange={onSetActualStart} maxDate={today} />
              </FormField>
            </View>
            <View style={{ flex: 1 }}>
              <FormField label="Actual End">
                <DateField value={task.actualEndDate} onChange={onSetActualEnd} minDate={task.actualStartDate} maxDate={today} />
              </FormField>
            </View>
          </View>
          {dateError ? <InlineError message={dateError} /> : null}

          <FormField label="Overall % complete" hint="Out of 100 for the whole task." error={!percentValid ? 'Enter a number from 0 to 100' : null}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <TextField value={percentText} onChangeText={setPercentText} keyboardType="decimal-pad" placeholder="e.g. 40" invalid={!percentValid} style={{ width: 110 }} accessibilityLabel="Overall percent complete" />
              <AppText variant="bodyStrong" tone="muted">
                % of 100
              </AppText>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden', marginTop: space.sm }}>
              <View style={{ width: `${barPercent}%`, height: 8, backgroundColor: barPercent >= 100 ? colors.success : colors.navy }} />
            </View>
          </FormField>

          <FormField label="Reasons for Delay" hint="Tick every reason that applies and add a comment for each.">
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' }}>
              {DPR_DEPENDENCY_CATEGORIES.map((cat, i) => {
                const active = reasons.includes(cat);
                return (
                  <View key={cat} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider, backgroundColor: active ? colors.navySoft : colors.surface }}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={DPR_DEPENDENCY_LABEL[cat]}
                      onPress={() => toggle(cat)}
                      style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, opacity: pressed ? 0.6 : 1 })}
                    >
                      <Ionicons name={active ? 'checkbox' : 'square-outline'} size={22} color={active ? colors.navy : colors.textMuted} />
                      <AppText variant={active ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>
                        {DPR_DEPENDENCY_LABEL[cat]}
                      </AppText>
                    </Pressable>
                    {active && (
                      <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
                        <TextField
                          value={comments[cat] ?? ''}
                          onChangeText={(text) => setComments((prev) => ({ ...prev, [cat]: text }))}
                          placeholder={cat === 'other' ? 'What is the reason, and what happened?' : `What is the ${DPR_DEPENDENCY_LABEL[cat].toLowerCase()} delay about?`}
                          multiline
                          accessibilityLabel={`Comment for ${DPR_DEPENDENCY_LABEL[cat]} delay`}
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </FormField>

          {error ? <InlineError message={error} onDismiss={() => setError(null)} /> : null}
          <Button label="Save overall progress" icon="save-outline" size="lg" fullWidth busy={saving} onPress={handleSave} />
          {savedLine ? (
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {savedLine}
            </AppText>
          ) : null}
        </>
      )}
    </FormSection>
  );
}
