import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { FormModal } from '../../components/ui/FormModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AttendanceSessionError,
  fetchTodaysAttendance,
  istStartOfToday,
  recordAttendance,
  type AttendanceRecord,
} from '../../lib/attendance';
import { LEAVE_REASON_PRESETS, insertLeaveEvent, type LeaveReasonPresetValue } from '../../lib/leaveEvents';
import { Card } from '../../components/ui/Card';
import { isFieldRole, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { WORK_HOURS_END_MINUTES } from '../../lib/locationTracking/constants';
import { logAction, logError } from '../../lib/sentryLog';
import { formatTime12h } from '../../lib/formatTime';

function timeLabel(iso: string): string {
  return formatTime12h(new Date(iso));
}

// Plain arithmetic (+5:30 on the real UTC clock), not Intl/toLocaleTimeString
// with a timeZone option and not the device's own system timezone either —
// both of those depend on the running environment already being configured
// for IST, which isn't guaranteed on every test device/browser. This is
// correct regardless of the device's own clock/timezone settings, same
// reasoning as critical-alerts.tsx's reportedAtLabel.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function currentISTLabel(): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  let hours = ist.getUTCHours();
  const minutes = ist.getUTCMinutes();
  const seconds = ist.getUTCSeconds();
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${period}`;
}

// A live, ticking clock so it's visually obvious this is the CURRENT time,
// not another historical log entry — added specifically because the
// Check In/Check Out history below shows the whole day's events, and it
// wasn't otherwise obvious at a glance that an old 6:12 AM entry sitting
// above a live 6:47 PM reading are both correct, just from different
// moments in the same day.
function LiveClock() {
  const [label, setLabel] = useState(currentISTLabel);

  useEffect(() => {
    const id = setInterval(() => setLabel(currentISTLabel()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <View className="flex-row items-center justify-center gap-2 py-2.5 mb-4 rounded-xl bg-neutral-100">
      <Ionicons name="time-outline" size={14} color="#6B7280" />
      <Text className="text-xs font-semibold text-neutral-500">Current time (IST)</Text>
      <Text className="text-sm font-bold text-neutral-900 tabular-nums">{label}</Text>
    </View>
  );
}

// The reason form shown after the "are you sure?" confirmation — a preset
// dropdown (rendered as a vertical pressable list, same pattern this app
// already uses for pickers elsewhere, e.g. invoices.tsx's project/client
// selection, rather than a native <Picker>) plus an always-available
// optional free-text note, not just for 'Other'. Submitting does NOT end
// the check-in session — see this screen's own handleSubmitLeave, which
// only inserts a leave_events row; tracking/geofencing/the check-in itself
// are all completely untouched by this.
function LeaveReasonSheet({
  visible,
  submitting,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (preset: LeaveReasonPresetValue, note: string) => void;
}) {
  const [preset, setPreset] = useState<LeaveReasonPresetValue | null>(null);
  const [note, setNote] = useState('');

  function handleClose() {
    setPreset(null);
    setNote('');
    onClose();
  }

  return (
    <FormModal visible={visible} onRequestClose={handleClose}>
        {/* Reasons + note scroll inside the card so Confirm Leave stays on
            screen on small phones / large text. */}
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380, maxHeight: '90%' }}>
          <Card style={{ flexShrink: 1, minHeight: 0 }}>
            <ScrollView nestedScrollEnabled style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            <Text className="text-md font-bold text-neutral-900 mb-1">Why are you leaving?</Text>
            <Text className="text-xs text-neutral-400 mb-3">Your check-in stays open while you&apos;re out.</Text>

            <View className="gap-1.5 mb-3">
              {LEAVE_REASON_PRESETS.map((r) => {
                const active = r.value === preset;
                return (
                  <Pressable
                    key={r.value}
                    onPress={() => setPreset(r.value)}
                    className={`px-3 py-2.5 rounded-lg ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                  >
                    <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{r.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text className="text-xs text-neutral-400 mb-1">Additional detail (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. picking up rebar from the yard"
              multiline
              numberOfLines={2}
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-4"
              style={{ minHeight: 52, textAlignVertical: 'top' }}
            />
            </ScrollView>

            <View className="flex-row justify-end gap-2">
              <Pressable onPress={handleClose} disabled={submitting} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => preset && onSubmit(preset, note)}
                disabled={submitting || !preset}
                className="px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5 disabled:opacity-50"
              >
                {submitting && <ActivityIndicator size="small" color="#fff" />}
                <Text className="text-xs font-semibold text-white">Confirm Leave</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
    </FormModal>
  );
}

// site_engineer/senior_site_engineer only — check-in/out is something a
// field role does about THEMSELVES, not something admin/manager have any
// reason to use. Their view of everyone's attendance (with distance/flags/
// review) is admin-web's existing /attendance page, not a mobile mirror of
// this same button. Location was removed from the app, so check-in/out is a
// plain time-stamped record with no GPS capture.
// The button toggles based on today's LAST record, so multiple check-in/
// out cycles in one day (a 9-to-6 workday with breaks) are allowed rather
// than a single session — lib/attendance.ts's own assertValidSessionTransition
// still rejects the two states that are never valid regardless (double
// check-in, checking out with no open check-in), server-side too.
export default function AttendanceScreen() {
  const { state } = useAuth();
  const isField = state.status === 'signed-in' && isFieldRole(state.profile.role);
  const { selectedProjectId } = useProject();

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown once, right after a late check-out — cleared on the next
  // check-in/out action or Leave submission so it never lingers stale.
  const [lateCheckoutMessage, setLateCheckoutMessage] = useState<string | null>(null);
  const [leaveModalVisible, setLeaveModalVisible] = useState(false);
  const [submittingLeave, setSubmittingLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (state.status !== 'signed-in') return;
    try {
      setError(null);
      setRecords(await fetchTodaysAttendance(state.profile.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [state]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Bug 3.4 — purely to re-evaluate canCheckOut below as the scheduled end
  // time passes while this screen sits open; 1 minute is plenty (the
  // button only ever needs to flip once, at that one boundary, not track
  // time precisely the way LiveClock's own 1s ticker does).
  // Holds "now" in state (updated each minute) so render stays pure — no
  // Date.now() call during render.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!isField || state.status !== 'signed-in') {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  const lastRecord = records[records.length - 1] ?? null;
  const isCheckedIn = lastRecord?.type === 'CHECK_IN';
  const nextAction: 'CHECK_IN' | 'CHECK_OUT' = isCheckedIn ? 'CHECK_OUT' : 'CHECK_IN';

  // Bug 3.4 — mirrors the same block recordAttendance() enforces server-
  // side (lib/attendance.ts's assertValidSessionTransition); computed here
  // too so the button reflects it directly instead of being tappable and
  // then rejected. "Leave" (below) is the intended way to step away mid-day
  // now — this UI deliberately doesn't offer an early-checkout escape hatch.
  const scheduledEndMinutes = lastRecord?.scheduledEndMinutes ?? WORK_HOURS_END_MINUTES;
  const scheduledEndMs = istStartOfToday().getTime() + scheduledEndMinutes * 60_000;
  const canCheckOutNow = !isCheckedIn || nowMs >= scheduledEndMs;

  // Confirmed live: a check-in was recorded with no project selected at
  // all, from a different city than the actual site — geofencing never
  // ran because there was nothing to geofence against (see
  // recordAttendance's own guard in lib/attendance.ts, the actual fix).
  // This disables the button proactively, matching canCheckOutNow's own
  // "disable + explain" convention, instead of letting the tap go through
  // and rejecting it after the fact.
  const hasProjectSelected = !!selectedProjectId;

  async function handlePress() {
    if (state.status !== 'signed-in') return;
    setSubmitting(true);
    // Captured before recordAttendance() below resolves — that call is what
    // makes THIS checkout the new lastRecord on the next render, so the
    // CHECK_IN record (and its scheduledEndMinutes) has to be grabbed now.
    const checkingOutRecord = lastRecord;
    try {
      setError(null);
      setLateCheckoutMessage(null);
      logAction('shift', nextAction === 'CHECK_IN' ? 'Clock in' : 'Clock out', { projectId: selectedProjectId });
      await recordAttendance(state.profile.id, selectedProjectId, nextAction);
      // Section 4 — only ever a "you were late" notice, never an "on time"
      // one (spec: show nothing if on-time/early). scheduledEndMinutes
      // comes from the CHECK_IN record itself (each check-in stamps the
      // project's shift window at the time, so this stays correct even if
      // the project's hours change mid-day).
      if (nextAction === 'CHECK_OUT' && checkingOutRecord?.scheduledEndMinutes != null) {
        const scheduledEnd = new Date(istStartOfToday().getTime() + checkingOutRecord.scheduledEndMinutes * 60_000);
        const lateMs = Date.now() - scheduledEnd.getTime();
        if (lateMs > 0) {
          const lateMinutes = Math.round(lateMs / 60_000);
          setLateCheckoutMessage(`You checked out ${lateMinutes} minute${lateMinutes === 1 ? '' : 's'} late 😔`);
        }
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // An expected, user-facing validation outcome — not a bug worth a
      // Sentry issue, unlike every other failure path here (network, DB).
      if (!(err instanceof AttendanceSessionError)) {
        logError(err, 'attendance_record', { nextAction });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Section 3 — a confirm-first alert, same as any other "about to do
  // something you might not have meant to tap" action in this app, before
  // the reason sheet even opens.
  function handleLeavePress() {
    Alert.alert('Leave the site?', 'Are you sure you want to leave the site?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', onPress: () => setLeaveModalVisible(true) },
    ]);
  }

  async function handleSubmitLeave(preset: LeaveReasonPresetValue, note: string) {
    if (state.status !== 'signed-in') return;
    setSubmittingLeave(true);
    try {
      setLeaveError(null);
      await insertLeaveEvent({
        userId: state.profile.id,
        projectId: selectedProjectId,
        reasonPreset: preset,
        reasonNote: note,
      });
      logAction('shift', 'Leave site', { projectId: selectedProjectId, reason: preset });
      setLeaveModalVisible(false);
    } catch (err) {
      setLeaveError(err instanceof Error ? err.message : String(err));
      logError(err, 'leave_event_insert', { reason: preset });
    } finally {
      setSubmittingLeave(false);
    }
  }

  return (
    <View className="flex-1 bg-neutral-50">
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="px-4 pt-4 pb-8"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
        >
          <LiveClock />

          {error && (
            <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-4">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          )}

          {lateCheckoutMessage && (
            <View className="rounded-xl border border-neutral-200 bg-neutral-100 px-3.5 py-3 mb-4">
              <Text className="text-sm font-semibold text-neutral-700">{lateCheckoutMessage}</Text>
            </View>
          )}

          {leaveError && (
            <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-4">
              <Text className="text-sm text-red-600">{leaveError}</Text>
            </View>
          )}

          <Card className="items-center py-8 mb-5">
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-4"
              style={{ backgroundColor: isCheckedIn ? '#DCFCE7' : '#F3F4F6' }}
            >
              <Ionicons name={isCheckedIn ? 'time' : 'finger-print-outline'} size={30} color={isCheckedIn ? '#16A34A' : '#6B7280'} />
            </View>
            <Text className="text-sm text-neutral-400 mb-1">
              {isCheckedIn ? `Checked in at ${timeLabel(lastRecord!.clientCapturedAtISO)}` : 'Not checked in yet today'}
            </Text>
            <Pressable
              onPress={handlePress}
              disabled={submitting || !canCheckOutNow || !hasProjectSelected}
              className="flex-row items-center gap-2 px-6 py-3.5 rounded-2xl mt-2"
              style={{
                backgroundColor: nextAction === 'CHECK_IN' ? '#16A34A' : '#DC2626',
                opacity: submitting || !canCheckOutNow || !hasProjectSelected ? 0.5 : 1,
              }}
            >
              {submitting && <ActivityIndicator size="small" color="#fff" />}
              <Text className="text-sm font-bold text-white">{nextAction === 'CHECK_IN' ? 'Check In' : 'Check Out'}</Text>
            </Pressable>

            {!hasProjectSelected && (
              <Text className="text-xs text-neutral-400 mt-2 text-center">
                Select a project first.
              </Text>
            )}

            {/* Bug 3.4 — the checkout button is disabled (not just rejected
                on tap) until the scheduled end time; this caption is the
                only place that explains why, and points at Leave as the
                intended way to step away before then. */}
            {hasProjectSelected && isCheckedIn && !canCheckOutNow && (
              <Text className="text-xs text-neutral-400 mt-2 text-center">
                You can check out starting {formatTime12h(new Date(scheduledEndMs))}. Use Leave if you need to step away.
              </Text>
            )}

            {isCheckedIn && (
              <Pressable
                onPress={handleLeavePress}
                disabled={submitting}
                className="flex-row items-center gap-1.5 px-5 py-2.5 rounded-2xl mt-3 border border-neutral-200"
              >
                <Ionicons name="walk-outline" size={15} color="#4B5563" />
                <Text className="text-xs font-bold text-neutral-600">Leave</Text>
              </Pressable>
            )}
          </Card>

          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Today</Text>
          {records.length === 0 ? (
            <Text className="text-sm text-neutral-400">No check-ins recorded yet today.</Text>
          ) : (
            records.map((r) => (
              <Card key={r.id} accentColor={r.type === 'CHECK_IN' ? '#16A34A' : '#DC2626'} className="mb-2.5 flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-neutral-800">{r.type === 'CHECK_IN' ? 'Checked In' : 'Checked Out'}</Text>
                <Text className="text-sm text-neutral-400">{timeLabel(r.clientCapturedAtISO)}</Text>
              </Card>
            ))
          )}

        </ScrollView>
      )}

      <LeaveReasonSheet
        visible={leaveModalVisible}
        submitting={submittingLeave}
        onClose={() => setLeaveModalVisible(false)}
        onSubmit={handleSubmitLeave}
      />
    </View>
  );
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
