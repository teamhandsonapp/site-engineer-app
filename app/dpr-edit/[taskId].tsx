import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { preparePhotoForUpload } from '../../lib/preparePhoto';
import { addSitePhoto, locationLabel, type PhotoLocation } from '../../lib/sitePhotos';
import { LocationPicker } from '../../components/files/LocationPicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../../lib/AuthContext';
import { Card } from '../../components/ui/Card';
import { DateField } from '../../components/ui/DateField';
import { EmptyState } from '../../components/ui/EmptyState';
import { AppText } from '../../components/ui/AppText';
import { Button, IconButton } from '../../components/ui/Button';
import { FormField, FormSection, TextField } from '../../components/ui/Form';
import { Screen } from '../../components/ui/Screen';
import { StickyFooter } from '../../components/ui/StickyFooter';
import { ErrorState, InlineError, SkeletonBlock, SkeletonCard } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { colors, radius, shadow, space } from '../../lib/theme';
import { CommentPicker } from '../../components/dpr/CommentPicker';
import { DprDelayBreakdown } from '../../components/dpr/DprDelayBreakdown';
import { SubtaskListEditor } from '../../components/dpr/SubtaskListEditor';
import { formatDateLabel, formatDateTimeLabel } from '../../lib/formatTime';
import { fetchGeneralParameterReport, type GeneralParameterReportData } from '../../lib/reports/generalParameterReport';
import { fetchWorksForProject, type WorkOption } from '../../lib/flowchart/data';
import {
  DPR_DEPENDENCY_CATEGORIES,
  EMPTY_DPR_ENTRY,
  buildFullDayEntryList,
  dependencyDisplayLabel,
  fetchAllDprEntriesForTask,
  fetchDailyProgressPhotos,
  fetchDprTaskById,
  fetchSubtasksForTask,
  fetchSubtaskActualStarts,
  updateSubtaskActualStart,
  isDprPending,
  markDprSubmitted,
  todayDateKey,
  updateTaskActualDate,
  updateTaskStatusRpc,
  uploadDailyProgressPhoto,
  upsertTodayDprEntry,
  type DailyProgressPhoto,
  type DprComment,
  type DprDependencyCategory,
  type DprEntryFields,
  type DprHistoryEntry,
  type DprSubtaskItem,
  type DprTask,
  type TaskStatus,
} from '../../lib/dprEntries';

// Full-page DPR editor, by explicit correction — a task spans several real
// days (one planned day = one real DPR), so this pages through EVERY one of
// them ("DPR 1 of N", Prev/Next) instead of only ever showing today's entry
// in a flat form. Opens on Day 1 every time. "DPR History" (below) is now a
// lightweight popup FROM this page — a quick day-index to jump the pager —
// not a second full page, since this page already covers every day's real
// editing. Self-contained: fetches everything by taskId (the task row, its
// full real history, subtasks, works, photos) rather than receiving it as
// props, since a navigated page has no live connection back to the list
// screen's own state.

const STATUS_DISPLAY_LABEL: Record<TaskStatus, string> = {
  draft: 'Pending',
  ready: 'Pending',
  blocked: 'Pending',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
};

// A single dropdown replacing the old pill+conditional-action-buttons row,
// by explicit request — 'ready' is the real DB value behind the "Pending"
// label shown/selected here. update_task_status still enforces every real
// transition rule server-side (completed-lock, ready/on_hold-before-
// in_progress, cross-trade prerequisites), so offering all 4 up front is
// safe — an invalid pick just comes back as statusError.
// "Pending" isn't offered here, by explicit request — it's the natural
// starting state a task is already in before work begins, not something you
// manually switch a task back to. STATUS_DISPLAY_LABEL above still shows
// "Pending" as the current label for a task that's genuinely in that state.
const STATUS_DROPDOWN_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
];

function dayGap(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00Z`).getTime();
  const to = new Date(`${toKey}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

export default function DprEditScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const userId = profile?.id ?? null;
  const toast = useToast();

  const [task, setTask] = useState<DprTask | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [works, setWorks] = useState<WorkOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Every real planned/submitted day for this task, oldest first — the
  // pager below walks through this. index resets to 0 ("DPR 1") every
  // fresh load, by explicit request.
  const [entries, setEntries] = useState<DprHistoryEntry[]>([]);
  const [index, setIndex] = useState(0);
  const [subtasksByDate, setSubtasksByDate] = useState<Record<string, DprSubtaskItem[]>>({});
  // Per-subtask Actual Start Date, keyed by subtask id (null = same as task).
  const [subtaskStarts, setSubtaskStarts] = useState<Record<string, string | null>>({});
  const [subtaskStartError, setSubtaskStartError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    try {
      const found = await fetchDprTaskById(taskId, todayDateKey());
      if (!found) {
        setTask(null);
        return;
      }
      setTask(found.task);
      setProjectId(found.projectId);
      const [rows, subtaskRows, worksList, photoList] = await Promise.all([
        fetchAllDprEntriesForTask(taskId),
        fetchSubtasksForTask(taskId),
        found.projectId ? fetchWorksForProject(found.projectId) : Promise.resolve([]),
        fetchDailyProgressPhotos(taskId),
      ]);
      setEntries(buildFullDayEntryList(rows, found.task.plannedStartDate, found.task.plannedEndDate));
      setIndex(0);
      const grouped: Record<string, DprSubtaskItem[]> = {};
      for (const s of subtaskRows) (grouped[s.reportDate] ??= []).push(s);
      setSubtasksByDate(grouped);
      const starts = await fetchSubtaskActualStarts(subtaskRows.map((s) => s.id));
      setSubtaskStarts(starts.dates);
      setWorks(worksList);
      setPhotos(photoList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-fetches just the task row (status/actual start/quantity) — used by
  // the task-level actions below so they don't reset the day pager back to
  // "DPR 1" every time, the way a full load() would.
  async function refreshTaskOnly() {
    if (!taskId) return;
    const found = await fetchDprTaskById(taskId, todayDateKey());
    if (found) setTask(found.task);
  }

  // Preconstruction/Construction/Cumulative delay breakdown — task-level,
  // same across every day page, same real fetch the Task Based Report
  // itself uses.
  const [delayData, setDelayData] = useState<GeneralParameterReportData | null>(null);
  const [delayLoading, setDelayLoading] = useState(true);
  const [delayError, setDelayError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId || !projectId) return;
    let cancelled = false;
    setDelayLoading(true);
    setDelayError(null);
    fetchGeneralParameterReport(taskId, projectId)
      .then((data) => {
        if (!cancelled) setDelayData(data);
      })
      .catch((err) => {
        if (!cancelled) setDelayError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setDelayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, projectId]);

  // Each planned day is an equal share of the task's 100% (4 days -> 25%).
  const plannedDurationDays =
    task?.plannedStartDate && task.plannedEndDate ? dayGap(task.plannedStartDate, task.plannedEndDate) + 1 : null;
  const dayShareExact = plannedDurationDays && plannedDurationDays > 0 ? 100 / plannedDurationDays : null;
  const formatPct = (n: number) => String(Math.round(n * 100) / 100);

  // DPR day N is labelled Actual Start + (N-1) working days once the task
  // has an actual start (e.g. started 8 Sep, 4 DPRs -> 8, 9, 10, 11 Sep), by
  // explicit correction; before that, the planned day it's stored under.
  // Same weekday rule as the report's Projected End Date, so they agree.
  function dprDayDate(dayIndex: number, reportDate: string): Date {
    if (!task?.actualStartDate) return new Date(`${reportDate}T00:00:00Z`);
    const [y, m, d] = task.actualStartDate.split('-').map(Number);
    const cursor = new Date(Date.UTC(y, m - 1, d));
    let remaining = dayIndex;
    while (remaining > 0) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) remaining--;
    }
    return cursor;
  }

  // Current day's editable copy — reset whenever the pager moves.
  const [draft, setDraft] = useState<DprEntryFields>(EMPTY_DPR_ENTRY);
  const [quantityText, setQuantityText] = useState('');
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [targetedWorkforceText, setTargetedWorkforceText] = useState('');
  const [actualWorkforceText, setActualWorkforceText] = useState('');
  const [otherText, setOtherText] = useState('');
  const [architectCommentText, setArchitectCommentText] = useState('');
  const [clientCommentText, setClientCommentText] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [delayDropdownOpen, setDelayDropdownOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  // Save/submit failures — shown as a banner under the buttons, NOT the
  // full-screen `error` state (which would replace the form and lose typing).
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dayFieldsSaved, setDayFieldsSaved] = useState(false);

  useEffect(() => {
    const current = entries[index]?.fields ?? EMPTY_DPR_ENTRY;
    setDraft(current);
    setQuantityText(current.percentComplete != null && dayShareExact ? formatPct((current.percentComplete / dayShareExact) * 100) : '');
    setQuantityError(null);
    setTargetedWorkforceText(current.targetedWorkforcePerDay != null ? String(current.targetedWorkforcePerDay) : '');
    setActualWorkforceText(current.actualWorkforcePerDay != null ? String(current.actualWorkforcePerDay) : '');
    setOtherText(current.dependencyOtherText ?? '');
    setArchitectCommentText(current.architectComment ?? '');
    setClientCommentText(current.clientComment ?? '');
    setValidationError(null);
  }, [index, entries, dayShareExact]);

  const suggestedPerDay = plannedDurationDays && plannedDurationDays > 0 ? Math.round(100 / plannedDurationDays) : null;
  const WORKING_HOURS_PER_DAY = 8;

  const totalCompletedPercent = delayData?.cumulativePercentComplete ?? null;
  const totalPendingPercent = totalCompletedPercent != null ? 100 - totalCompletedPercent : null;
  // Real average pace so far (not the fixed planned rate) — total % actually
  // completed divided by how many real days have a filled-in % — by explicit
  // correction: "if the task keeps going at this pace" should reflect what's
  // actually happening on site, not a hypothetical faster rate.
  const filledDayCount = entries.filter((e) => e.fields.percentComplete != null).length;
  const actualPacePerDay =
    filledDayCount > 0 && totalCompletedPercent != null ? Math.round((totalCompletedPercent / filledDayCount) * 10) / 10 : null;
  const actualPaceDaysToFinish =
    actualPacePerDay && actualPacePerDay > 0 && totalPendingPercent != null
      ? Math.round((totalPendingPercent / actualPacePerDay) * 10) / 10
      : null;

  // Returns whether the save really reached the server, so callers never show
  // "Saved" / mark a day submitted after a failed write.
  async function persistDraft(next: DprEntryFields): Promise<boolean> {
    setDraft(next);
    const current = entries[index];
    if (!current || !taskId) return false;
    try {
      await upsertTodayDprEntry(taskId, current.reportDate, next, userId);
      setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, fields: next } : e)));
      setSaveError(null);
      return true;
    } catch (err) {
      setSaveError(`Couldn't save — ${err instanceof Error ? err.message : String(err)}. Your changes are still on screen; try again.`);
      return false;
    }
  }

  async function saveDayFields(): Promise<boolean> {
    let next = draft;
    // The day's % of the whole task = Quantity of Work % x this day's share
    // (see dayContribution). percent_complete is a smallint column, so it's
    // rounded to a whole percent on save.
    const contribution = quantityValue != null && dayShareExact != null ? (quantityValue * dayShareExact) / 100 : null;
    next = { ...next, percentComplete: contribution == null ? null : Math.max(0, Math.min(100, Math.round(contribution))) };
    const trimmedOther = otherText.trim();
    next = { ...next, dependencyOtherText: trimmedOther || null };
    const trimmedTargeted = targetedWorkforceText.trim();
    next = { ...next, targetedWorkforcePerDay: trimmedTargeted === '' ? null : Math.max(0, Math.round(Number(trimmedTargeted))) };
    const trimmedActual = actualWorkforceText.trim();
    next = { ...next, actualWorkforcePerDay: trimmedActual === '' ? null : Math.max(0, Math.round(Number(trimmedActual))) };
    next = { ...next, architectComment: architectCommentText.trim() || null, clientComment: clientCommentText.trim() || null };
    const ok = await persistDraft(next);
    if (!ok) return false;
    setDayFieldsSaved(true);
    setTimeout(() => setDayFieldsSaved(false), 1500);
    return true;
  }

  function toggleDependency(cat: DprDependencyCategory) {
    const next = draft.dependencyCategories.includes(cat)
      ? draft.dependencyCategories.filter((c) => c !== cat)
      : [...draft.dependencyCategories, cat];
    void persistDraft({ ...draft, dependencyCategories: next });
  }

  function handleSubtasksChange(next: DprSubtaskItem[]) {
    const entry = entries[index];
    if (!entry) return;
    setSubtasksByDate((prev) => ({ ...prev, [entry.reportDate]: next }));
  }

  async function handleStatusPress(target: TaskStatus) {
    if (!taskId) return;
    setChangingStatus(true);
    setStatusError(null);
    try {
      await updateTaskStatusRpc(taskId, target);
      await refreshTaskOnly();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setChangingStatus(false);
    }
  }

  async function handleSetActualStart(isoDate: string) {
    if (!taskId) return;
    setStatusError(null);
    try {
      await updateTaskActualDate(taskId, 'actual_start_date', isoDate);
    } catch (err) {
      setStatusError(`Couldn't save the Actual Start Date — ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    // Setting Actual Start Date should read as "the work has begun" — by
    // explicit request, this auto-advances status the same way update_task_
    // status's own in_progress transition already does when it captures this
    // same date the other way around. Only from 'ready' ("Pending"): an
    // on_hold/blocked task stays put until the site engineer explicitly
    // resumes it via the Status dropdown.
    if (task?.status === 'ready') {
      try {
        await updateTaskStatusRpc(taskId, 'in_progress');
      } catch {
        // Best-effort — the date itself is already saved either way.
      }
    }
    await refreshTaskOnly().catch(() => {});
  }

  // Quantity of Work — by explicit request, entered per DPR day as a plain
  // percentage of THAT day's work (0-100). Each planned day is an equal share
  // of the task's 100% (4 days -> 25% each), so the day's real contribution
  // is entered% x dayShare / 100 — e.g. 60% of a 25% day = 15% of the task.
  // That contribution is what's stored as the day's dpr_entries.percent_
  // complete (which Total completed sums), and only on "Save Draft DPR" or
  // Submit — never on blur/enter. The box itself is re-derived from that
  // stored value when the day is reopened.
  const quantityValue = quantityText.trim() === '' ? null : Number(quantityText);
  const quantityValid = quantityValue == null || (Number.isFinite(quantityValue) && quantityValue >= 0 && quantityValue <= 100);
  const dayContribution = quantityValue != null && quantityValid && dayShareExact != null ? (quantityValue * dayShareExact) / 100 : null;
  const dayShortfall = dayContribution != null && dayShareExact != null ? Math.max(0, dayShareExact - dayContribution) : null;
  const dayShortfallHours =
    dayShortfall != null && dayShareExact ? Math.round((dayShortfall / dayShareExact) * WORKING_HOURS_PER_DAY * 10) / 10 : null;

  function validateQuantity(): boolean {
    if (!quantityValid) {
      setQuantityError('Enter a percentage between 0 and 100');
      return false;
    }
    setQuantityError(null);
    return true;
  }

  function reloadDelayData() {
    if (!taskId || !projectId) return;
    fetchGeneralParameterReport(taskId, projectId)
      .then(setDelayData)
      .catch(() => {
        // The on-screen summary is a courtesy view; the save itself succeeded.
      });
  }

  async function handleSaveDraft() {
    if (!validateQuantity()) return;
    if (await saveDayFields()) {
      toast.success('Draft saved');
      reloadDelayData();
    }
  }

  async function handleSubmit() {
    const current = entries[index];
    if (!current || !taskId || !task) return;
    const missing: string[] = [];
    if (isDprPending(task.status)) {
      // Reason for Delay is only actually pickable while On Hold (Pending
      // shows it disabled) — see the render below — so only require it then.
      if (task.status === 'on_hold' && draft.dependencyCategories.length === 0) missing.push('Reason for Delay');
      if (!draft.comment) missing.push('Comments');
    }
    if (missing.length > 0) {
      setValidationError(`${missing.join(' and ')} required before this day's DPR can be submitted.`);
      return;
    }
    setValidationError(null);
    if (!validateQuantity()) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      // Never mark a day submitted unless its fields were really saved first.
      if (!(await saveDayFields())) return;
      await markDprSubmitted(taskId, current.reportDate);
      const nowIso = new Date().toISOString();
      setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, fields: { ...e.fields, dprSubmittedAtISO: nowIso } } : e)));
      setDraft((d) => ({ ...d, dprSubmittedAtISO: nowIso }));
      toast.success('DPR submitted');
      reloadDelayData();
    } catch (err) {
      setSaveError(`Couldn't submit this DPR — ${err instanceof Error ? err.message : String(err)}. Nothing was marked submitted; try again.`);
    } finally {
      setSubmitting(false);
    }
  }

  // Point 9 — general daily progress photos, task-level (not per-day).
  const [photos, setPhotos] = useState<DailyProgressPhoto[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function reloadPhotos() {
    if (!taskId) return;
    try {
      setPhotos(await fetchDailyProgressPhotos(taskId));
    } catch {
      // A courtesy attachment, not load-bearing.
    }
  }

  async function handlePickedPhoto(asset: ImagePicker.ImagePickerAsset) {
    if (!taskId) return;
    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      // Resized + compressed first (see lib/preparePhoto.ts).
      const { base64, contentType } = await preparePhotoForUpload(asset);
      await uploadDailyProgressPhoto(taskId, base64, contentType, userId);
      // File it under the chosen Floor › Room › Wall in Files › Site Photos
      // (on this phone for now — see lib/sitePhotos.ts).
      const loc = pendingLocation.current;
      if (loc && projectId) {
        await addSitePhoto(projectId, { location: loc, uri: asset.uri, by: profile?.fullName || 'You', taskName: task?.taskName ?? null }).catch(() => {});
        setLastPhotoLocation(loc);
        toast.success(`Photo saved to ${locationLabel(loc)}`);
      } else {
        toast.success('Photo uploaded');
      }
      await reloadPhotos();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleTakePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Allow camera access to attach a progress photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) await handlePickedPhoto(result.assets[0]);
  }

  async function handleChooseFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Allow photo library access to attach a progress photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) await handlePickedPhoto(result.assets[0]);
  }

  // Add Photo: pick Floor › Room › Wall first, then camera / gallery.
  const pendingLocation = useRef<PhotoLocation | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [lastPhotoLocation, setLastPhotoLocation] = useState<PhotoLocation | null>(null);

  function handleAddPhotoPress() {
    setPhotoError(null);
    setLocationPickerOpen(true);
  }

  function handleLocationChosen(loc: PhotoLocation) {
    pendingLocation.current = loc;
    setLocationPickerOpen(false);
    // Let the sheet close before the system camera / gallery opens.
    setTimeout(() => handleUploadPhoto(), 250);
  }

  function handleUploadPhoto() {
    if (Platform.OS === 'web') {
      void handleChooseFromLibrary();
      return;
    }
    Alert.alert('Add Photo', undefined, [
      { text: 'Take Photo', onPress: handleTakePhoto },
      { text: 'Choose from Library', onPress: handleChooseFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }

  const current = entries[index];

  const isSubmitted = !!draft.dprSubmittedAtISO;
  const canSubmit = !!task && task.status !== 'completed';

  // Sticky bottom bar: Save Draft + Submit, with the validation / save error
  // banners right above the buttons (always visible next to them).
  const footer =
    !loading && !error && task && entries.length > 0 ? (
      <StickyFooter
        above={
          validationError || saveError ? (
            <View style={{ gap: space.sm }}>
              {validationError ? <InlineError message={validationError} onDismiss={() => setValidationError(null)} /> : null}
              {saveError ? <InlineError message={saveError} onDismiss={() => setSaveError(null)} /> : null}
            </View>
          ) : undefined
        }
      >
        <View style={{ flex: 1 }}>
          <Button
            label={dayFieldsSaved ? 'Saved' : 'Save Draft'}
            icon={dayFieldsSaved ? 'checkmark' : 'save-outline'}
            variant={dayFieldsSaved ? 'success' : 'secondary'}
            size="lg"
            fullWidth
            onPress={handleSaveDraft}
          />
        </View>
        {canSubmit && (
          <View style={{ flex: 1 }}>
            {isSubmitted ? (
              <View
                accessibilityLabel={`Submitted ${formatDateTimeLabel(new Date(draft.dprSubmittedAtISO!))}`}
                style={{ minHeight: 52, borderRadius: radius.md, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
              >
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <AppText variant="bodyStrong" tone="success">
                  Submitted
                </AppText>
              </View>
            ) : (
              <Button label="Submit DPR" icon="paper-plane-outline" size="lg" fullWidth busy={submitting} haptics="press" onPress={handleSubmit} />
            )}
          </View>
        )}
      </StickyFooter>
    ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerShown: true,
          // Short header title; the full task name is shown once in the body.
          title: 'DPR',
          headerStyle: { backgroundColor: colors.navy },
          headerTintColor: '#fff',
          headerTitleStyle: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 17 },
          headerShadowVisible: false,
        }}
      />

      {loading ? (
        <View style={{ padding: space.lg }}>
          <SkeletonBlock width="40%" height={12} />
          <SkeletonBlock width="80%" height={22} style={{ marginTop: space.sm, marginBottom: space.lg }} />
          <SkeletonCard lines={1} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !task ? (
        <EmptyState icon="document-text-outline" iconColor={colors.textMuted} title="Task not found" subtitle="It may have been deleted." />
      ) : (
        <Screen footer={footer}>
          <AppText variant="overline">{task.workName}</AppText>
          <AppText variant="title" accessibilityRole="header" style={{ marginTop: 2, marginBottom: space.md }}>
            {task.taskName}
          </AppText>

          {entries.length === 0 ? (
            <EmptyState icon="calendar-outline" iconColor={colors.textMuted} title="No planned dates yet" subtitle="Planned dates need to be set for this task before a DPR can be filled." />
          ) : (
            <>
              {/* The day pager — opens on Day 1 every time, by explicit
                  request. Tapping the middle opens "DPR History" to jump to
                  any day; the editing always happens right here. */}
              <View
                style={[
                  { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: space.sm },
                  shadow.card,
                ]}
              >
                <IconButton icon="chevron-back" accessibilityLabel="Previous day" disabled={index === 0} onPress={() => setIndex((i) => Math.max(0, i - 1))} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`DPR ${index + 1} of ${entries.length}. Open DPR history`}
                  onPress={() => setHistoryOpen(true)}
                  style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}
                >
                  <AppText variant="bodyStrong">
                    DPR {index + 1} of {entries.length}
                  </AppText>
                  <AppText variant="caption">{formatDateLabel(dprDayDate(index, current.reportDate))} · tap for history</AppText>
                </Pressable>
                <IconButton
                  icon="chevron-forward"
                  accessibilityLabel="Next day"
                  disabled={index === entries.length - 1}
                  onPress={() => setIndex((i) => Math.min(entries.length - 1, i + 1))}
                />
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.lg, paddingHorizontal: 2 }}>
                <Ionicons
                  name={draft.dprSubmittedAtISO ? 'checkmark-circle' : draft.submittedByName ? 'create-outline' : 'ellipse-outline'}
                  size={15}
                  color={draft.dprSubmittedAtISO ? colors.success : draft.submittedByName ? colors.textMuted : colors.warning}
                />
                <AppText variant="caption" tone={draft.dprSubmittedAtISO || draft.submittedByName ? 'muted' : 'warning'} style={{ flex: 1 }}>
                  {draft.dprSubmittedAtISO
                    ? `Submitted by ${draft.submittedByName ?? 'Unknown user'} · ${formatDateTimeLabel(new Date(draft.dprSubmittedAtISO))}`
                    : draft.submittedByName
                      ? `Draft — last edited by ${draft.submittedByName}${draft.submittedAtISO ? ` · ${formatDateTimeLabel(new Date(draft.submittedAtISO))}` : ''}`
                      : "Not filled yet — add this day's update below."}
                </AppText>
              </View>

              {delayLoading && (
                <View style={{ alignItems: 'center', paddingVertical: space.md }}>
                  <ActivityIndicator color={colors.navy} size="small" />
                </View>
              )}
              {delayError && (
                <View style={{ marginBottom: space.md }}>
                  <InlineError message={delayError} />
                </View>
              )}
              {delayData && <DprDelayBreakdown data={delayData} />}

              {/* ── Progress ── */}
              <FormSection title="Progress" icon="trending-up-outline" description="Today's share of the work, status and dates.">
                <FormField label="Quantity of Work" hint={suggestedPerDay != null ? `This task spans ${plannedDurationDays} planned day${plannedDurationDays === 1 ? '' : 's'} — about ${suggestedPerDay}% per day.` : 'Percentage of THIS day’s planned work that was done.'} error={quantityError}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <TextField value={quantityText} onChangeText={setQuantityText} keyboardType="decimal-pad" placeholder="e.g. 80" invalid={!!quantityError} style={{ width: 110 }} accessibilityLabel="Quantity of work, percent" />
                    <AppText variant="bodyStrong" tone="muted">
                      %
                    </AppText>
                  </View>
                </FormField>
                {/* The "X% of this day's Y% share = Z% of total task" line
                    stays hidden by explicit request — the same calculation
                    (dayContribution) is what Save Draft / Submit store. */}
                {dayContribution != null && dayShareExact != null && dayShortfall != null && (
                  <View
                    style={{
                      borderRadius: radius.sm,
                      padding: space.md,
                      borderWidth: 1,
                      backgroundColor: dayShortfall > 0 ? colors.dangerSoft : colors.successSoft,
                      borderColor: dayShortfall > 0 ? '#F5C2C2' : '#BBF7D0',
                    }}
                  >
                    <AppText variant="label" tone={dayShortfall > 0 ? 'danger' : 'success'}>
                      {dayShortfall > 0
                        ? `${formatPct(dayContribution)}% completed today out of ${formatPct(dayShareExact)}% — ${formatPct(dayShortfall)}% short, this is delaying the task (~${dayShortfallHours} hrs to cover it up).`
                        : `${formatPct(dayContribution)}% completed today out of ${formatPct(dayShareExact)}% — on track.`}
                    </AppText>
                  </View>
                )}
                {totalCompletedPercent != null && totalPendingPercent != null && (
                  <View style={{ borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, padding: space.md, gap: 4 }}>
                    <AppText variant="label">
                      Total completed: {totalCompletedPercent}%  ·  Total pending: {totalPendingPercent}%
                    </AppText>
                    {actualPacePerDay != null && actualPaceDaysToFinish != null && (
                      <AppText variant="caption" tone="secondary">
                        Going at <AppText variant="caption" tone="default" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>{actualPacePerDay}%/day</AppText>, this task will take{' '}
                        <AppText variant="caption" tone="default" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
                          {actualPaceDaysToFinish} more day{actualPaceDaysToFinish === 1 ? '' : 's'}
                        </AppText>{' '}
                        to finish.
                      </AppText>
                    )}
                  </View>
                )}

                {/* Only ONE Actual Start field on screen, by explicit
                    correction: with subtasks, each subtask's own date is it;
                    this task-level picker only shows for a day with none. */}
                {(subtasksByDate[current.reportDate] ?? []).length === 0 && (
                  <FormField label="Actual Start Date">
                    <DateField value={task.actualStartDate} onChange={handleSetActualStart} maxDate={new Date().toISOString().slice(0, 10)} />
                  </FormField>
                )}

                <View style={{ zIndex: 10, gap: space.md }}>
                  <FormField label="Status" error={statusError}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Status: ${STATUS_DISPLAY_LABEL[task.status]}${task.status !== 'completed' ? '. Change' : ''}`}
                      onPress={() => task.status !== 'completed' && setStatusDropdownOpen((v) => !v)}
                      disabled={changingStatus}
                      style={({ pressed }) => ({
                        minHeight: 48,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderWidth: 1,
                        borderColor: colors.borderStrong,
                        borderRadius: radius.sm,
                        paddingHorizontal: space.md,
                        backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                        opacity: changingStatus ? 0.5 : 1,
                      })}
                    >
                      <AppText variant="bodyStrong">{STATUS_DISPLAY_LABEL[task.status]}</AppText>
                      {changingStatus ? (
                        <ActivityIndicator size="small" color={colors.navy} />
                      ) : task.status !== 'completed' ? (
                        <Ionicons name={statusDropdownOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                      ) : null}
                    </Pressable>
                    {/* Expands in normal flow (pushes content down) rather than
                        floating over it — by explicit correction. */}
                    {statusDropdownOpen && (
                      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' }}>
                        {STATUS_DROPDOWN_OPTIONS.map((opt, i) => {
                          const active = task.status === opt.value;
                          return (
                            <Pressable
                              key={opt.value}
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                              onPress={() => {
                                setStatusDropdownOpen(false);
                                void handleStatusPress(opt.value);
                              }}
                              style={({ pressed }) => ({
                                minHeight: 46,
                                justifyContent: 'center',
                                paddingHorizontal: space.md,
                                borderTopWidth: i ? 1 : 0,
                                borderTopColor: colors.divider,
                                backgroundColor: active ? colors.navy : pressed ? colors.surfaceMuted : colors.surface,
                              })}
                            >
                              <AppText variant="body" tone={active ? 'inverse' : 'default'}>
                                {opt.label}
                              </AppText>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </FormField>

                  {isDprPending(task.status) && (
                    <FormField
                      label="Reason for Delay"
                      required
                      hint={task.status === 'on_hold' ? 'Pick one or more.' : 'Becomes selectable once the task is On Hold.'}
                    >
                      {/* Shown for Pending and On Hold, but only pickable once
                          On Hold — by explicit request. */}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: task.status !== 'on_hold' }}
                        onPress={() => task.status === 'on_hold' && setDelayDropdownOpen((v) => !v)}
                        style={({ pressed }) => ({
                          minHeight: 48,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: space.sm,
                          borderWidth: 1,
                          borderColor: draft.dependencyCategories.length === 0 ? '#F5C2C2' : colors.borderStrong,
                          borderRadius: radius.sm,
                          paddingHorizontal: space.md,
                          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                          opacity: task.status === 'on_hold' ? 1 : 0.55,
                        })}
                      >
                        <AppText variant="body" tone={draft.dependencyCategories.length === 0 ? 'muted' : 'default'} style={{ flex: 1 }} numberOfLines={1}>
                          {draft.dependencyCategories.length === 0
                            ? 'Select reason(s)'
                            : draft.dependencyCategories.map((c) => dependencyDisplayLabel(c, draft.dependencyOtherText)).join(', ')}
                        </AppText>
                        {task.status === 'on_hold' && <Ionicons name={delayDropdownOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />}
                      </Pressable>
                      {task.status === 'on_hold' && delayDropdownOpen && (
                        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' }}>
                          {DPR_DEPENDENCY_CATEGORIES.map((cat, i) => {
                            const active = draft.dependencyCategories.includes(cat);
                            return (
                              <Pressable
                                key={cat}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: active }}
                                onPress={() => toggleDependency(cat)}
                                style={({ pressed }) => ({
                                  minHeight: 46,
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  paddingHorizontal: space.md,
                                  borderTopWidth: i ? 1 : 0,
                                  borderTopColor: colors.divider,
                                  backgroundColor: active ? colors.navy : pressed ? colors.surfaceMuted : colors.surface,
                                })}
                              >
                                <AppText variant="body" tone={active ? 'inverse' : 'default'}>
                                  {dependencyDisplayLabel(cat, draft.dependencyOtherText)}
                                </AppText>
                                {active && <Ionicons name="checkmark" size={16} color="#fff" />}
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                      {task.status === 'on_hold' && draft.dependencyCategories.includes('other') && (
                        <TextField value={otherText} onChangeText={setOtherText} onBlur={saveDayFields} placeholder="Describe the reason for the delay…" multiline accessibilityLabel="Other reason for delay" />
                      )}
                    </FormField>
                  )}
                </View>
              </FormSection>

              {/* ── Subtasks ── */}
              <FormSection
                title="Subtasks"
                icon="list-outline"
                description="What was worked on today. Progress is entered once above."
              >
                <SubtaskListEditor
                  taskId={task.id}
                  reportDate={current.reportDate}
                  works={works}
                  subtasks={subtasksByDate[current.reportDate] ?? []}
                  editable
                  onChange={handleSubtasksChange}
                  actualStarts={subtaskStarts}
                  taskActualStart={task.actualStartDate}
                  onActualStartChange={(id, d) => {
                    setSubtaskStartError(null);
                    setSubtaskStarts((prev) => ({ ...prev, [id]: d }));
                    updateSubtaskActualStart(id, d)
                      .then(() => {
                        // Task's own Actual Start = earliest subtask start, so
                        // status auto-advance and reports keep working.
                        if (!task.actualStartDate || d < task.actualStartDate) return handleSetActualStart(d);
                      })
                      .catch((err) => {
                        setSubtaskStarts((prev) => ({ ...prev, [id]: null }));
                        setSubtaskStartError(err instanceof Error ? err.message : String(err));
                      });
                  }}
                />
                {subtaskStartError && <InlineError message={subtaskStartError} onDismiss={() => setSubtaskStartError(null)} />}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open quality checklist"
                  onPress={() => router.push(`/dpr-checklist/${task.id}`)}
                  style={({ pressed }) => ({
                    minHeight: 48,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                    paddingHorizontal: space.md,
                    borderRadius: radius.sm,
                    backgroundColor: pressed ? colors.navySoft : colors.surfaceMuted,
                  })}
                >
                  <Ionicons name="document-text-outline" size={18} color={colors.navy} />
                  <AppText variant="bodyStrong" tone="brand" style={{ flex: 1 }}>
                    Quality Checklist
                  </AppText>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              </FormSection>

              {/* ── Workforce ── */}
              <FormSection title="Workforce" icon="people-outline" description="Number of people on site for this task today.">
                <View style={{ flexDirection: 'row', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <FormField label="Targeted / day">
                      <TextField
                        value={targetedWorkforceText}
                        onChangeText={setTargetedWorkforceText}
                        onBlur={saveDayFields}
                        onSubmitEditing={saveDayFields}
                        keyboardType="number-pad"
                        placeholder="e.g. 12"
                        accessibilityLabel="Targeted workforce per day"
                      />
                    </FormField>
                  </View>
                  <View style={{ flex: 1 }}>
                    <FormField label="Actual / day">
                      <TextField
                        value={actualWorkforceText}
                        onChangeText={setActualWorkforceText}
                        onBlur={saveDayFields}
                        onSubmitEditing={saveDayFields}
                        keyboardType="number-pad"
                        placeholder="e.g. 10"
                        accessibilityLabel="Actual workforce per day"
                      />
                    </FormField>
                  </View>
                </View>
              </FormSection>

              {/* ── Remarks (pending / on hold only, as before) ── */}
              {isDprPending(task.status) && (
                <FormSection title="Remarks" icon="chatbubble-ellipses-outline" description="Required while the task is pending or on hold.">
                  <FormField label="Comments" required>
                    <CommentPicker comment={draft.comment} required editable onChange={(next: DprComment | null) => void persistDraft({ ...draft, comment: next })} />
                  </FormField>
                  <FormField label="Architect">
                    <TextField value={architectCommentText} onChangeText={setArchitectCommentText} onBlur={saveDayFields} placeholder="Note for or from the architect…" multiline accessibilityLabel="Architect comment" />
                  </FormField>
                  <FormField label="Client">
                    <TextField value={clientCommentText} onChangeText={setClientCommentText} onBlur={saveDayFields} placeholder="Note for or from the client…" multiline accessibilityLabel="Client comment" />
                  </FormField>
                </FormSection>
              )}

              {/* ── Photos ── */}
              <FormSection title="Photos" icon="camera-outline" description="Choose the floor, room and wall, then take or pick the photo.">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {photos.map((photo) => (
                    <View key={photo.id} style={{ width: 96 }}>
                      {photo.signedUrl ? (
                        <Image source={{ uri: photo.signedUrl }} style={{ width: 96, height: 96, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted }} accessibilityLabel="Progress photo" />
                      ) : (
                        <View style={{ width: 96, height: 96, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
                          <AppText variant="caption">Unavailable</AppText>
                        </View>
                      )}
                    </View>
                  ))}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add photo"
                    onPress={handleAddPhotoPress}
                    disabled={uploadingPhoto}
                    style={({ pressed }) => ({
                      width: 96,
                      height: 96,
                      borderRadius: radius.sm,
                      borderWidth: 1.5,
                      borderStyle: 'dashed',
                      borderColor: colors.borderStrong,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                      opacity: uploadingPhoto ? 0.5 : 1,
                    })}
                  >
                    {uploadingPhoto ? (
                      <ActivityIndicator size="small" color={colors.navy} />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={22} color={colors.textMuted} />
                        <AppText variant="caption" style={{ marginTop: 4, fontFamily: 'IBMPlexSans_600SemiBold' }}>
                          Add Photo
                        </AppText>
                      </>
                    )}
                  </Pressable>
                </View>
                {lastPhotoLocation && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="folder-open-outline" size={15} color={colors.textMuted} />
                    <AppText variant="caption" style={{ flex: 1 }}>
                      Last photo filed in Files › Site Photos › {locationLabel(lastPhotoLocation)}
                    </AppText>
                  </View>
                )}
                {photoError && <InlineError message={photoError} onDismiss={() => setPhotoError(null)} />}
              </FormSection>
            </>
          )}
        </Screen>
      )}

      <LocationPicker visible={locationPickerOpen} onClose={() => setLocationPickerOpen(false)} onConfirm={handleLocationChosen} />

      {/* DPR History — a lightweight popup day-index, by explicit request,
          not a second full page. Just jumps the pager above to whichever
          day is tapped. */}
      <Modal visible={historyOpen} transparent animationType="fade" onRequestClose={() => setHistoryOpen(false)}>
        <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={() => setHistoryOpen(false)}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380, maxHeight: '80%' }}>
            <Card style={{ flexShrink: 1, minHeight: 0 }}>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-sm font-bold text-neutral-900">DPR History</Text>
                <Pressable onPress={() => setHistoryOpen(false)} hitSlop={8}>
                  <Ionicons name="close" size={20} color="#6B7280" />
                </Pressable>
              </View>
              <ScrollView style={{ flexShrink: 1, minHeight: 0 }} showsVerticalScrollIndicator={false}>
                {entries.map((e, i) => {
                  const label = e.fields.dprSubmittedAtISO
                    ? 'Submitted'
                    : e.fields.submittedByName
                      ? 'Draft'
                      : 'Not filled';
                  const labelColor = e.fields.dprSubmittedAtISO ? '#15803D' : e.fields.submittedByName ? '#B45309' : '#9CA3AF';
                  return (
                    <Pressable
                      key={e.reportDate}
                      onPress={() => { setIndex(i); setHistoryOpen(false); }}
                      className="flex-row items-center justify-between px-2 py-2.5 border-b border-neutral-50"
                      style={{ backgroundColor: i === index ? '#F5F5F5' : undefined }}
                    >
                      <View>
                        <Text className="text-xs font-bold text-neutral-900">DPR {i + 1}</Text>
                        <Text className="text-2xs text-neutral-400">{formatDateLabel(dprDayDate(i, e.reportDate))}</Text>
                      </View>
                      <Text className="text-2xs font-bold" style={{ color: labelColor }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
