import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, ScrollView, View } from 'react-native';
import { Pressable } from '../../components/ui/Pressable';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { preparePhotoForUpload } from '../../lib/preparePhoto';
import { addSitePhoto, locationLabel, type PhotoLocation } from '../../lib/sitePhotos';
import { LocationPicker } from '../../components/files/LocationPicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../../lib/AuthContext';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { AppText, Text } from '../../components/ui/AppText';
import { Button, IconButton } from '../../components/ui/Button';
import { FormField, FormSection, TextField } from '../../components/ui/Form';
import { Screen } from '../../components/ui/Screen';
import { StickyFooter } from '../../components/ui/StickyFooter';
import { ErrorState, InlineError, SkeletonBlock, SkeletonCard } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { colors, radius, shadow, space } from '../../lib/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommentPicker } from '../../components/dpr/CommentPicker';
import { DprDelayBreakdown } from '../../components/dpr/DprDelayBreakdown';
import { DateField } from '../../components/ui/DateField';
import { TaskWorkersAttendance, type TaskAttendanceState } from '../../components/workforce/TaskWorkersAttendance';
import { ProgressStatusBadge } from '../../components/ui/ProgressStatusBadge';
import { fetchProgressStatuses, type ProgressStatusInfo } from '../../lib/taskProgressStatus';
import { SubtaskListEditor } from '../../components/dpr/SubtaskListEditor';
import { formatDateLabel, formatDateTimeLabel } from '../../lib/formatTime';
import { fetchGeneralParameterReport, type GeneralParameterReportData } from '../../lib/reports/generalParameterReport';
import { fetchWorksForProject, type WorkOption } from '../../lib/flowchart/data';
import {
  DPR_DEPENDENCY_CATEGORIES,
  DPR_DEPENDENCY_LABEL,
  EMPTY_DPR_ENTRY,
  buildFullDayEntryList,
  fetchAllDprEntriesForTask,
  fetchDailyProgressPhotos,
  fetchDprTaskById,
  fetchSubtasksForTask,
  fetchSubtaskActualStarts,
  updateSubtaskActualStart,
  isDprPending,
  inPreconstruction,
  fetchChecklistProgress,
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

// Status is no longer picked by hand (2026-11-13): it's calculated from the
// dates and submitted DPRs (lib/taskProgressStatus.ts) and shown with "Why?".

function dayGap(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00Z`).getTime();
  const to = new Date(`${toKey}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

export default function DprEditScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { state } = useAuth();
  // This page pads its own bottom (app/_layout.tsx OWN_BOTTOM_INSET): StickyFooter when there's a
  // footer, otherwise this extra end-of-page space keeps content above the nav bar (batch 5).
  const bottomInset = useSafeAreaInsets().bottom;
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
  // Back to the original daily DPR (2026-11-11): the day pager is the page.
  // The PR card (components/dpr/OverallProgressCard — one cumulative %) is
  // kept in the code but not shown here until it gets its own place.
  // Pre-construction checklist progress (shown while the DPR is locked).
  const [checklistProgress, setChecklistProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    fetchChecklistProgress(taskId)
      .then((p) => !cancelled && setChecklistProgress(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [taskId]);
  // This day's Workers Attendance completeness — gates Submit DPR.
  const [attendanceState, setAttendanceState] = useState<TaskAttendanceState>({ loaded: false, hasFolder: false, total: 0, unmarked: 0 });

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
    refreshProgress();
  }

  // Calculated status (dates + submitted DPRs) — refreshed on load, after a
  // submit, and after task-level changes.
  const [progress, setProgress] = useState<ProgressStatusInfo | null>(null);
  const refreshProgress = useCallback(() => {
    if (!taskId) return;
    fetchProgressStatuses([taskId])
      .then((m) => setProgress(m.get(taskId) ?? null))
      .catch(() => {});
  }, [taskId]);
  useEffect(() => {
    refreshProgress();
  }, [refreshProgress]);

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
  // Every calendar day is a working day (by request, 2026-11-10: no Sundays
  // or holidays off), same rule as the report's Projected End Date.
  function dprDayDate(dayIndex: number, reportDate: string): Date {
    if (!task?.actualStartDate) return new Date(`${reportDate}T00:00:00Z`);
    const [y, m, d] = task.actualStartDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + Math.max(0, dayIndex)));
  }

  // Current day's editable copy — reset whenever the pager moves.
  const [draft, setDraft] = useState<DprEntryFields>(EMPTY_DPR_ENTRY);
  const [quantityText, setQuantityText] = useState('');
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [architectCommentText, setArchitectCommentText] = useState('');
  const [clientCommentText, setClientCommentText] = useState('');
  // Comment typed for each selected Reason for Delay (category -> text).
  const [reasonComments, setReasonComments] = useState<Partial<Record<DprDependencyCategory, string>>>({});
  const [statusError, setStatusError] = useState<string | null>(null);
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
    setOtherText(current.dependencyOtherText ?? '');
    setArchitectCommentText(current.architectComment ?? '');
    setClientCommentText(current.clientComment ?? '');
    // 'other' used to keep its text in dependency_other_text only.
    setReasonComments({
      ...(current.dependencyOtherText ? { other: current.dependencyOtherText } : {}),
      ...(current.delayReasonComments ?? {}),
    });
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
    const comments = trimmedReasonComments();
    next = { ...next, delayReasonComments: comments, dependencyOtherText: comments.other ?? (otherText.trim() || null) };
    next = { ...next, architectComment: architectCommentText.trim() || null, clientComment: clientCommentText.trim() || null };
    const ok = await persistDraft(next);
    if (!ok) return false;
    setDayFieldsSaved(true);
    setTimeout(() => setDayFieldsSaved(false), 1500);
    return true;
  }

  function trimmedReasonComments(): Partial<Record<DprDependencyCategory, string>> {
    const out: Partial<Record<DprDependencyCategory, string>> = {};
    for (const [cat, text] of Object.entries(reasonComments) as [DprDependencyCategory, string | undefined][]) {
      const t = text?.trim();
      if (t) out[cat] = t;
    }
    return out;
  }

  function toggleDependency(cat: DprDependencyCategory) {
    const next = draft.dependencyCategories.includes(cat)
      ? draft.dependencyCategories.filter((c) => c !== cat)
      : [...draft.dependencyCategories, cat];
    // Carry the comments typed so far, so ticking another reason never
    // throws away a comment that hasn't been saved yet.
    const comments = trimmedReasonComments();
    void persistDraft({ ...draft, dependencyCategories: next, delayReasonComments: comments, dependencyOtherText: comments.other ?? null });
  }

  function handleSubtasksChange(next: DprSubtaskItem[]) {
    const entry = entries[index];
    if (!entry) return;
    setSubtasksByDate((prev) => ({ ...prev, [entry.reportDate]: next }));
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
    // No pre-construction "Ready" gate any more (2026-11-09): a task that
    // hasn't started (draft/ready/blocked) moves straight to In Progress
    // once its real start date is entered. update_task_status still only
    // starts from 'ready', so step through it first.
    // Pre-construction gate (2026-11-11): only a 'ready' task (checklist
    // done) moves on — a draft/blocked task is refused by the database.
    if (task && task.status === 'ready') {
      try {
        await updateTaskStatusRpc(taskId, 'in_progress');
      } catch (err) {
        // The date itself is already saved; say why the status didn't move
        // (e.g. a linked task in the flowchart hasn't started yet).
        setStatusError(`Actual Start saved, but the status couldn't change to In Progress — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await refreshTaskOnly().catch(() => {});
  }

  // Actual End Date — same tasks column the flowchart's task sheet edits.
  // Only saves the date; marking the task Completed stays a separate,
  // deliberate Status change (it locks the task).
  async function handleSetActualEnd(isoDate: string) {
    if (!taskId) return;
    setStatusError(null);
    if (task?.actualStartDate && isoDate < task.actualStartDate) {
      setStatusError('Actual End Date can’t be before the Actual Start Date.');
      return;
    }
    try {
      await updateTaskActualDate(taskId, 'actual_end_date', isoDate);
      toast.success('Actual End Date saved');
    } catch (err) {
      setStatusError(`Couldn't save the Actual End Date — ${err instanceof Error ? err.message : String(err)}`);
      return;
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
    }
    // Every ticked Reason for Delay needs its own comment.
    const comments = trimmedReasonComments();
    const uncommented = draft.dependencyCategories.filter((c) => !comments[c]);
    if (uncommented.length > 0) {
      missing.push(`a comment for ${uncommented.map((c) => DPR_DEPENDENCY_LABEL[c]).join(', ')}`);
    }
    // Workers Attendance is part of the DPR: not filled = DPR not filled.
    if (!attendanceState.loaded) {
      missing.push('Workers Attendance (still loading)');
    } else if (!attendanceState.hasFolder || attendanceState.total === 0) {
      missing.push(`Workers Attendance (no ${task.workName} workers added yet — add them in the Attendance tab)`);
    } else if (attendanceState.unmarked > 0) {
      missing.push(`Workers Attendance (${attendanceState.unmarked} not marked)`);
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
      refreshProgress();
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
  // Pre-construction gate: checklist not done -> no DPR yet.
  const locked = !!task && inPreconstruction(task.status);
  // Attendance day: the DPR day open in the pager, else today.
  const attendanceDateKey = current ? current.reportDate : todayDateKey();

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
        <Screen footer={locked ? undefined : footer} contentStyle={locked ? { paddingBottom: space.xxxl + bottomInset } : undefined}>
          <AppText variant="overline">{task.workName}</AppText>
          <AppText variant="title" accessibilityRole="header" style={{ marginTop: 2, marginBottom: space.md }}>
            {task.taskName}
          </AppText>

          {locked ? (
            // Pre-construction gate: no DPR until the whole checklist is done.
            <FormSection compact title="Pre-construction checklist pending" icon="lock-closed-outline">
              <AppText variant="body">
                The DPR / construction phase opens once this task&apos;s pre-construction checklist is complete.
              </AppText>
              {checklistProgress ? (
                <View style={{ gap: 6 }}>
                  <AppText variant="label">
                    {checklistProgress.done} of {checklistProgress.total} items done
                  </AppText>
                  <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
                    <View
                      style={{
                        width: `${checklistProgress.total ? Math.round((checklistProgress.done / checklistProgress.total) * 100) : 0}%`,
                        height: 8,
                        backgroundColor: colors.navy,
                      }}
                    />
                  </View>
                </View>
              ) : null}
              <Button label="Open checklist" icon="checkbox-outline" fullWidth onPress={() => router.push(`/task/${task.id}`)} />
            </FormSection>
          ) : entries.length === 0 ? (
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

              {/* ── Workers Attendance (this task's department, this DPR day) ──
                  Required: Submit DPR is blocked until everyone is marked. */}
              {projectId ? (
                <FormSection
                  compact
                  title={`Workers Attendance · ${formatDateLabel(new Date(`${attendanceDateKey}T00:00:00Z`))}`}
                  icon="people-outline"
                >
                  <TaskWorkersAttendance
                    key={attendanceDateKey}
                    projectId={projectId}
                    workId={task.workId}
                    workName={task.workName}
                    dateKey={attendanceDateKey}
                    userId={userId}
                    onStateChange={setAttendanceState}
                  />
                </FormSection>
              ) : null}

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
              <FormSection compact title="Progress" icon="trending-up-outline">
                <FormField label="Quantity of Work" hint={suggestedPerDay != null ? `${plannedDurationDays} planned day${plannedDurationDays === 1 ? '' : 's'} — about ${suggestedPerDay}% per day.` : 'Percentage of THIS day’s planned work that was done.'} error={quantityError}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <TextField value={quantityText} onChangeText={setQuantityText} keyboardType="decimal-pad" placeholder="e.g. 80" invalid={!!quantityError} style={{ width: 90, minHeight: 40 }} accessibilityLabel="Quantity of work, percent" />
                    <AppText variant="bodyStrong" tone="muted">
                      %
                    </AppText>
                    {totalCompletedPercent != null && totalPendingPercent != null ? (
                      <AppText variant="caption" tone="secondary" style={{ flex: 1, textAlign: 'right' }}>
                        Done {totalCompletedPercent}% · Pending {totalPendingPercent}%
                      </AppText>
                    ) : null}
                  </View>
                </FormField>
                {/* The "X% of this day's Y% share = Z% of total task" line
                    stays hidden by explicit request — the same calculation
                    (dayContribution) is what Save Draft / Submit store. */}
                {dayContribution != null && dayShareExact != null && dayShortfall != null && (
                  <View
                    style={{
                      borderRadius: radius.sm,
                      paddingHorizontal: space.md,
                      paddingVertical: space.sm,
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
                {actualPacePerDay != null && actualPaceDaysToFinish != null && (
                  <AppText variant="caption" tone="secondary">
                    Going at <AppText variant="caption" tone="default" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>{actualPacePerDay}%/day</AppText>, this task will take{' '}
                    <AppText variant="caption" tone="default" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
                      {actualPaceDaysToFinish} more day{actualPaceDaysToFinish === 1 ? '' : 's'}
                    </AppText>{' '}
                    to finish.
                  </AppText>
                )}

                {/* Actual Start / End — task-level dates (moved back here
                    from the PR card, 2026-11-11). */}
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <FormField label="Actual Start">
                      <DateField value={task.actualStartDate} onChange={(d) => void handleSetActualStart(d)} maxDate={todayDateKey()} />
                    </FormField>
                  </View>
                  <View style={{ flex: 1 }}>
                    <FormField label="Actual End">
                      <DateField value={task.actualEndDate} onChange={(d) => void handleSetActualEnd(d)} minDate={task.actualStartDate} maxDate={todayDateKey()} />
                    </FormField>
                  </View>
                </View>

                <View style={{ zIndex: 10, gap: space.sm }}>
                  {/* Status is calculated from dates + DPRs (task_progress_statuses) — no manual picker (2026-11-13). */}
                  <FormField label="Status" error={statusError} hint="Set automatically from the planned dates and submitted DPRs.">
                    {progress ? (
                      <ProgressStatusBadge info={progress} showWhy />
                    ) : (
                      <AppText variant="caption" tone="muted">
                        Calculating…
                      </AppText>
                    )}
                  </FormField>

                  {task.status !== 'completed' && (
                    <FormField
                      label="Reason for Delay"
                      required={task.status === 'on_hold'}
                      hint="Tap every reason that applies, and add a comment for each."
                    >
                      {/* Compact chips (2026-11-11) instead of a full-width
                          row per reason; a comment box opens under the chips
                          for each one ticked. */}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {DPR_DEPENDENCY_CATEGORIES.map((cat) => {
                          const active = draft.dependencyCategories.includes(cat);
                          return (
                            <Pressable
                              key={cat}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: active }}
                              accessibilityLabel={DPR_DEPENDENCY_LABEL[cat]}
                              onPress={() => toggleDependency(cat)}
                              style={({ pressed }) => ({
                                minHeight: 34,
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 4,
                                paddingHorizontal: space.md,
                                borderRadius: radius.pill,
                                borderWidth: 1,
                                borderColor: active ? colors.navy : colors.border,
                                backgroundColor: active ? colors.navy : pressed ? colors.surfaceMuted : colors.surface,
                              })}
                            >
                              {active ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                              <AppText variant="label" style={{ color: active ? '#fff' : colors.textSecondary }}>
                                {DPR_DEPENDENCY_LABEL[cat]}
                              </AppText>
                            </Pressable>
                          );
                        })}
                      </View>
                      {DPR_DEPENDENCY_CATEGORIES.filter((cat) => draft.dependencyCategories.includes(cat)).map((cat) => {
                        const missingComment = !reasonComments[cat]?.trim();
                        return (
                          <TextField
                            key={cat}
                            value={reasonComments[cat] ?? ''}
                            onChangeText={(text) => setReasonComments((prev) => ({ ...prev, [cat]: text }))}
                            onBlur={saveDayFields}
                            placeholder={`${DPR_DEPENDENCY_LABEL[cat]}: ${cat === 'other' ? 'what is the reason?' : 'what is the delay about?'}`}
                            multiline
                            invalid={missingComment && !!validationError}
                            style={{ minHeight: 56, paddingVertical: space.sm }}
                            accessibilityLabel={`Comment for ${DPR_DEPENDENCY_LABEL[cat]} delay`}
                          />
                        );
                      })}
                    </FormField>
                  )}
                </View>
              </FormSection>

              {/* ── Subtasks ── */}
              <FormSection compact title="Subtasks" icon="list-outline">
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
                    minHeight: 40,
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

              {/* Workforce (targeted / actual people per day) removed from
                  the DPR on request, 2026-11-09. Any figures already saved
                  stay in dpr_entries untouched. */}

              {/* ── Remarks (pending / on hold only, as before) ── */}
              {isDprPending(task.status) && (
                <FormSection compact title="Remarks (optional)" icon="chatbubble-ellipses-outline">
                  <FormField label="Comments">
                    <CommentPicker comment={draft.comment} required={false} editable onChange={(next: DprComment | null) => void persistDraft({ ...draft, comment: next })} />
                  </FormField>
                  <FormField label="Architect">
                    <TextField value={architectCommentText} onChangeText={setArchitectCommentText} onBlur={saveDayFields} placeholder="Note for or from the architect…" multiline style={{ minHeight: 48, paddingVertical: space.sm }} accessibilityLabel="Architect comment" />
                  </FormField>
                  <FormField label="Client">
                    <TextField value={clientCommentText} onChangeText={setClientCommentText} onBlur={saveDayFields} placeholder="Note for or from the client…" multiline style={{ minHeight: 48, paddingVertical: space.sm }} accessibilityLabel="Client comment" />
                  </FormField>
                </FormSection>
              )}
            </>
          )}

              {/* ── Photos (task-level, always shown) ── */}
              <FormSection compact title="Photos" icon="camera-outline">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {photos.map((photo) => (
                    <View key={photo.id} style={{ width: 72 }}>
                      {photo.signedUrl ? (
                        <Image source={{ uri: photo.signedUrl }} style={{ width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted }} accessibilityLabel="Progress photo" />
                      ) : (
                        <View style={{ width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
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
                      width: 72,
                      height: 72,
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
