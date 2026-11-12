import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from '../ui/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '../ui/Card';
import { formatDateTimeLabel, formatDateLabel } from '../../lib/formatTime';
import {
  DPR_COMMENT_LABEL,
  DPR_DEPENDENCY_LABEL,
  fetchDprSubmissionHistory,
  type DprSubmission,
  type TaskStatus,
} from '../../lib/dprEntries';

const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: 'Pending',
  ready: 'Pending',
  blocked: 'Pending',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
};

function HistoryRow({ entry, isLast }: { entry: DprSubmission; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className={isLast ? '' : 'border-b border-neutral-100'}>
      <Pressable onPress={() => setExpanded((v) => !v)} className="flex-row items-center justify-between py-2.5">
        <View className="flex-1 pr-2">
          <Text className="text-xs font-semibold text-neutral-800" numberOfLines={1}>{entry.taskName}</Text>
          <Text className="text-2xs text-neutral-400 mt-0.5">
            {entry.isOverall ? 'PR' : 'DPR'}: {formatDateLabel(new Date(`${entry.reportDate}T00:00:00`))} · Submitted: {formatDateTimeLabel(new Date(entry.submittedAtISO))}
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#D4D4D4" />
      </Pressable>

      {expanded && (
        <View className="rounded-lg bg-neutral-50 border border-neutral-100 px-2.5 py-2 mb-2.5">
          {entry.submittedByName && (
            <Text className="text-2xs font-semibold text-neutral-500 mb-1.5">Submitted by {entry.submittedByName}</Text>
          )}

          <View className="flex-row items-center justify-between mb-1.5">
            <View className="px-2 py-0.5 rounded-full bg-brand-navy self-start">
              <Text className="text-2xs font-bold text-white">{STATUS_LABEL[entry.status] ?? entry.status}</Text>
            </View>
            {entry.percentComplete != null && (
              <Text className="text-2xs font-bold text-neutral-500">{entry.percentComplete}% done that day</Text>
            )}
          </View>

          {entry.dependencies.length > 0 && (
            <View className="flex-row flex-wrap gap-1 mb-1.5">
              {entry.dependencies.map((cat) => (
                <View key={cat} className="px-2 py-1 rounded-full bg-neutral-100">
                  <Text className="text-2xs font-semibold text-neutral-700">{DPR_DEPENDENCY_LABEL[cat] ?? cat}</Text>
                </View>
              ))}
            </View>
          )}

          {entry.commentPreset && <Text className="text-2xs text-neutral-600">{DPR_COMMENT_LABEL[entry.commentPreset]}</Text>}
        </View>
      )}
    </View>
  );
}

// Admin-only — a chronological log of real DPR/PR submissions for the
// selected project (dpr_entries with submitted_at set), newest first, each
// row collapsed to its two dates until tapped open. The old hardcoded demo
// rows were removed 2026-11-11.
export function DprHistorySection({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<DprSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDprSubmissionHistory(projectId)
      .then((rows) => !cancelled && setEntries(rows))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <View className="mt-5">
      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Submission History</Text>
      <Card style={{ paddingVertical: 4 }}>
        {error ? (
          <Text className="text-xs text-red-600 py-2.5">{error}</Text>
        ) : entries === null ? (
          <View className="py-3">
            <ActivityIndicator color="#0F1F33" />
          </View>
        ) : entries.length === 0 ? (
          <Text className="text-xs text-neutral-400 py-2.5">No DPRs submitted yet.</Text>
        ) : (
          entries.map((entry, i) => <HistoryRow key={entry.key} entry={entry} isLast={i === entries.length - 1} />)
        )}
      </Card>
    </View>
  );
}
