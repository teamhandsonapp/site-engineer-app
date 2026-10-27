import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { fetchWorksForProject, type WorkOption } from '../../lib/flowchart/data';
import { formatDateTimeLabel } from '../../lib/formatTime';
import {
  DPR_COMMENT_LABEL,
  dependencyDisplayLabel,
  type DprComment,
  type DprDependencyCategory,
  type DprSubtaskItem,
  type DprTask,
} from '../../lib/dprEntries';

// Only the transitions update_task_status() (add-dpr-entries.sql) actually
// allows FROM each status — kept here just for the collapsed card's status
// pill label, the actual transition buttons live on the Edit DPR page now.
const STATUS_DISPLAY_LABEL: Record<string, string> = {
  draft: 'Yet to Start',
  ready: 'Yet to Start',
  blocked: 'Yet to Start',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
};

// The list's own row — always just this one small collapsed card now, by
// explicit correction: this used to swap in a full inline edit form (or,
// after an earlier pass, a modal popup) right here in the middle of the
// scrolling task list, so opening one task's form still left every other
// task's card visible above/below it. "Edit DPR" navigates to its own full
// page (app/dpr-edit/[taskId].tsx) — a day pager covering the task's ENTIRE
// real history, opening on Day 1, with its own "DPR History" quick-jump
// popup reached from inside that page — so only the one task actually being
// worked on is ever on screen from here.
export function DprTaskRow({
  task,
  projectId,
  dependencies,
  dependencyOtherText,
  comment,
  subtasks,
  percentComplete,
  targetedWorkforcePerDay,
  actualWorkforcePerDay,
  submittedByName,
  submittedAtISO,
  isAdmin = false,
  dprSubmittedAtISO,
  hasApprovedEditGrant,
  onRequestEditAccess,
}: {
  task: DprTask;
  projectId: string;
  dependencies: DprDependencyCategory[];
  dependencyOtherText: string | null;
  comment: DprComment | null;
  subtasks: DprSubtaskItem[];
  percentComplete: number | null;
  targetedWorkforcePerDay: number | null;
  actualWorkforcePerDay: number | null;
  submittedByName: string | null;
  submittedAtISO: string | null;
  isAdmin?: boolean;
  // dpr_entries.submitted_at — set once by "Submit DPR" passing validation.
  // Non-null + !hasApprovedEditGrant locks this row for a non-admin (see
  // isLockedForEngineer below); "Contact Admin" is the only way back in.
  dprSubmittedAtISO: string | null;
  hasApprovedEditGrant: boolean;
  onRequestEditAccess: (message: string) => Promise<void>;
}) {
  // Locked for a non-admin once genuinely submitted, unless an admin has
  // approved a "Contact Admin" edit request for this exact (task, day) —
  // see hasApprovedEditGrant's own comment on the prop.
  const isLockedForEngineer = !isAdmin && dprSubmittedAtISO != null && !hasApprovedEditGrant;
  const [requestingEdit, setRequestingEdit] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [requestSending, setRequestSending] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function handleSendEditRequest() {
    setRequestSending(true);
    setRequestError(null);
    try {
      await onRequestEditAccess(requestMessage);
      setRequestSent(true);
      setRequestingEdit(false);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Could not send the request.');
    } finally {
      setRequestSending(false);
    }
  }

  // Departments, just to resolve each subtask's own department id into a
  // display name for this card's preview — fetched once per row on mount.
  const [works, setWorks] = useState<WorkOption[]>([]);
  useEffect(() => {
    fetchWorksForProject(projectId).then(setWorks).catch(() => {});
  }, [projectId]);
  function subtaskWorkName(workId: string | null): string | null {
    return works.find((w) => w.id === workId)?.name ?? null;
  }

  const commentLabel = comment ? (comment.preset === 'other' ? comment.text : DPR_COMMENT_LABEL[comment.preset]) : null;

  if (isLockedForEngineer) {
    return (
      <Card className="mb-2" style={{ padding: 12 }}>
        <Text className="text-2xs text-neutral-400">{task.workName}</Text>
        <Text className="text-xs font-bold text-neutral-900 mb-1.5">{task.taskName}</Text>

        <View className="rounded-lg bg-neutral-50 border border-neutral-100 px-2.5 py-1.5 mb-2">
          <Text className="text-2xs font-semibold text-neutral-500">
            Submitted{submittedAtISO && ` · ${formatDateTimeLabel(new Date(submittedAtISO))}`} — locked
          </Text>
        </View>

        {percentComplete != null && (
          <Text className="text-2xs font-bold text-neutral-500 mb-2">{percentComplete}% done today</Text>
        )}
        {subtasks.length > 0 && (
          <View className="mb-2">
            {subtasks.map((s) => (
              <Text key={s.id} className="text-2xs text-neutral-600" numberOfLines={2}>
                Subtask: {s.text}{subtaskWorkName(s.workId) ? ` (${subtaskWorkName(s.workId)})` : ''}
              </Text>
            ))}
          </View>
        )}
        {commentLabel && (
          <Text className="text-2xs text-neutral-600 mb-2" numberOfLines={2}>{commentLabel}</Text>
        )}

        {requestSent ? (
          <View className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-2">
            <Text className="text-2xs font-semibold text-emerald-700">Request sent — waiting for admin approval.</Text>
          </View>
        ) : requestingEdit ? (
          <View>
            <TextInput
              value={requestMessage}
              onChangeText={setRequestMessage}
              placeholder="Why do you need to edit this? (optional)"
              placeholderTextColor="#9CA3AF"
              multiline
              className="border border-neutral-200 rounded-lg px-2.5 py-2 text-xs text-neutral-900 mb-2"
              style={{ minHeight: 56, textAlignVertical: 'top' }}
            />
            {requestError && <Text className="text-2xs text-red-600 mb-2">{requestError}</Text>}
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setRequestingEdit(false)}
                className="flex-1 items-center py-1.5 rounded-lg border border-neutral-200"
              >
                <Text className="text-2xs font-bold text-neutral-500">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSendEditRequest}
                disabled={requestSending}
                className="flex-1 flex-row items-center justify-center gap-1 py-1.5 rounded-lg bg-brand-navy"
                style={{ opacity: requestSending ? 0.6 : 1 }}
              >
                {requestSending && <ActivityIndicator size="small" color="#fff" />}
                <Text className="text-2xs font-bold text-white">Send Request</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setRequestingEdit(true)}
            className="flex-row items-center justify-center gap-1 py-1.5 rounded-lg border border-neutral-300"
          >
            <Ionicons name="chatbubble-ellipses-outline" size={12} color="#0F1F33" />
            <Text className="text-2xs font-bold text-brand-navy">Contact Admin to Edit</Text>
          </Pressable>
        )}
      </Card>
    );
  }

  return (
    <Card className="mb-2" style={{ padding: 12 }}>
      <Text className="text-2xs text-neutral-400">{task.workName}</Text>
      <Text className="text-xs font-bold text-neutral-900 mb-1.5">{task.taskName}</Text>

      {/* "Submitted by" means dpr_entries.submitted_at (the real "Submit
          DPR" event), not just submitted_by/updated_at (whoever last
          touched ANY field, autosave included) — a row with real data but
          no dprSubmittedAtISO honestly reads as a draft. */}
      <View className="rounded-lg bg-neutral-50 border border-neutral-100 px-2.5 py-1.5 mb-2">
        <Text className="text-2xs font-semibold text-neutral-500">
          {dprSubmittedAtISO
            ? `Submitted by ${submittedByName ?? 'Unknown user'} · ${formatDateTimeLabel(new Date(dprSubmittedAtISO))}`
            : submittedByName
              ? `Draft — last edited by ${submittedByName}${submittedAtISO ? ` · ${formatDateTimeLabel(new Date(submittedAtISO))}` : ''}`
              : 'Not yet submitted'}
        </Text>
      </View>

      <View className="flex-row items-center justify-between mb-2">
        <View className="px-2 py-0.5 rounded-full bg-brand-navy self-start">
          <Text className="text-2xs font-bold text-white">{STATUS_DISPLAY_LABEL[task.status]}</Text>
        </View>
        {percentComplete != null && (
          <Text className="text-2xs font-bold text-neutral-500">{percentComplete}% done today</Text>
        )}
      </View>

      {(targetedWorkforcePerDay != null || actualWorkforcePerDay != null) && (
        <View className="mb-2 flex-row gap-4">
          <Text className="text-2xs text-neutral-500">Targeted: <Text className="font-bold text-neutral-900">{targetedWorkforcePerDay ?? '—'}</Text></Text>
          <Text className="text-2xs text-neutral-500">Actual: <Text className="font-bold text-neutral-900">{actualWorkforcePerDay ?? '—'}</Text></Text>
        </View>
      )}

      {dependencies.length > 0 && (
        <View className="mb-2">
          <Text className="text-2xs text-neutral-400 mb-1">Reason for Delay</Text>
          <View className="flex-row flex-wrap gap-1">
            {dependencies.map((cat) => (
              <View key={cat} className="px-2 py-1 rounded-full bg-neutral-100">
                <Text className="text-2xs font-semibold text-neutral-700">{dependencyDisplayLabel(cat, dependencyOtherText)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {subtasks.length > 0 && (
        <View className="mb-1">
          {subtasks.map((s) => (
            <Text key={s.id} className="text-2xs text-neutral-600" numberOfLines={2}>
              Subtask: {s.text}{subtaskWorkName(s.workId) ? ` (${subtaskWorkName(s.workId)})` : ''}
            </Text>
          ))}
        </View>
      )}

      {commentLabel && (
        <Text className="text-2xs text-neutral-600 mb-1" numberOfLines={2}>{commentLabel}</Text>
      )}

      {/* Single entry point now, by explicit request — DPR History used to
          be a second button/page here; it's now a lightweight popup reached
          FROM inside Edit DPR (app/dpr-edit/[taskId].tsx's own day pager),
          not a separate destination from this card. */}
      <Pressable
        onPress={() => router.push(`/dpr-edit/${task.id}`)}
        className="flex-row items-center justify-center gap-1 mt-1 py-1.5 rounded-lg border border-neutral-300"
      >
        <Ionicons name="create-outline" size={12} color="#0F1F33" />
        <Text className="text-2xs font-bold text-brand-navy">Edit DPR</Text>
      </Pressable>
    </Card>
  );
}
