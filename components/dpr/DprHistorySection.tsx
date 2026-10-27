import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { formatDateTimeLabel, formatDateLabel } from '../../lib/formatTime';
import { DPR_COMMENT_LABEL, DPR_DEPENDENCY_LABEL, type DprDependencyCategory } from '../../lib/dprEntries';

type MockHistoryEntry = {
  id: string;
  taskCode: string;
  taskName: string;
  workName: string;
  dprDateISO: string;
  submittedAtISO: string;
  submittedByName: string;
  statusLabel: string;
  percentComplete: number | null;
  targetedWorkforcePerDay: number | null;
  actualWorkforcePerDay: number | null;
  dependencies: DprDependencyCategory[];
  commentPreset: keyof typeof DPR_COMMENT_LABEL | null;
};

// Preview-only mock rows — NOT written to dpr_entries, so nothing here
// touches a real task's Delay-by-Category or % complete on Reports. Placed
// here for now purely so the History UI has something to show before real
// submissions accumulate day over day; safe to delete once real data exists.
const MOCK_HISTORY: MockHistoryEntry[] = [
  { id: 'h1', taskCode: 'INT-260920-02', taskName: 'Wall electrical conduits', workName: 'Electrical', dprDateISO: '2026-09-22', submittedAtISO: '2026-09-22T18:42:00', submittedByName: 'Ramesh Kumar', statusLabel: 'In Progress', percentComplete: 35, targetedWorkforcePerDay: 6, actualWorkforcePerDay: 5, dependencies: ['vendor'], commentPreset: 'awaiting_material_delivery' },
  { id: 'h2', taskCode: 'INT-260920-02', taskName: 'Wall electrical conduits', workName: 'Electrical', dprDateISO: '2026-09-21', submittedAtISO: '2026-09-21T19:05:00', submittedByName: 'Ramesh Kumar', statusLabel: 'In Progress', percentComplete: 20, targetedWorkforcePerDay: 6, actualWorkforcePerDay: 6, dependencies: [], commentPreset: null },
  { id: 'h3', taskCode: 'INT-260920-05', taskName: 'Wall electrical conduit & plumbing work', workName: 'Electrical', dprDateISO: '2026-09-22', submittedAtISO: '2026-09-22T17:58:00', submittedByName: 'Suresh Nair', statusLabel: 'In Progress', percentComplete: 42, targetedWorkforcePerDay: 8, actualWorkforcePerDay: 7, dependencies: ['client'], commentPreset: 'awaiting_client_approval' },
  { id: 'h4', taskCode: 'INT-260920-05', taskName: 'Wall electrical conduit & plumbing work', workName: 'Electrical', dprDateISO: '2026-09-21', submittedAtISO: '2026-09-21T18:20:00', submittedByName: 'Suresh Nair', statusLabel: 'In Progress', percentComplete: 28, targetedWorkforcePerDay: 8, actualWorkforcePerDay: 8, dependencies: [], commentPreset: null },
  { id: 'h5', taskCode: 'INT-260920-05', taskName: 'Wall electrical conduit & plumbing work', workName: 'Electrical', dprDateISO: '2026-09-20', submittedAtISO: '2026-09-20T19:15:00', submittedByName: 'Suresh Nair', statusLabel: 'In Progress', percentComplete: 15, targetedWorkforcePerDay: 8, actualWorkforcePerDay: 6, dependencies: ['contractor'], commentPreset: 'labour_shortage' },
  { id: 'h6', taskCode: 'CIV-260920-03', taskName: 'Column reinforcement work', workName: 'Civil Works', dprDateISO: '2026-09-22', submittedAtISO: '2026-09-22T18:10:00', submittedByName: 'Prakash Iyer', statusLabel: 'In Progress', percentComplete: 50, targetedWorkforcePerDay: 10, actualWorkforcePerDay: 9, dependencies: [], commentPreset: null },
  { id: 'h7', taskCode: 'CIV-260920-03', taskName: 'Column reinforcement work', workName: 'Civil Works', dprDateISO: '2026-09-21', submittedAtISO: '2026-09-21T17:40:00', submittedByName: 'Prakash Iyer', statusLabel: 'In Progress', percentComplete: 30, targetedWorkforcePerDay: 10, actualWorkforcePerDay: 8, dependencies: ['architect'], commentPreset: 'awaiting_drawing_clarification' },
  { id: 'h8', taskCode: 'CIV-260920-04', taskName: 'Slab shuttering & levelling', workName: 'Civil Works', dprDateISO: '2026-09-22', submittedAtISO: '2026-09-22T19:30:00', submittedByName: 'Prakash Iyer', statusLabel: 'On Hold', percentComplete: 10, targetedWorkforcePerDay: 8, actualWorkforcePerDay: 3, dependencies: ['consultant', 'vendor'], commentPreset: 'awaiting_material_delivery' },
  { id: 'h9', taskCode: 'CIV-260920-04', taskName: 'Slab shuttering & levelling', workName: 'Civil Works', dprDateISO: '2026-09-21', submittedAtISO: '2026-09-21T18:55:00', submittedByName: 'Prakash Iyer', statusLabel: 'On Hold', percentComplete: 5, targetedWorkforcePerDay: 8, actualWorkforcePerDay: 2, dependencies: ['vendor'], commentPreset: 'awaiting_material_delivery' },
  { id: 'h10', taskCode: 'INT-260920-02', taskName: 'Wall electrical conduits', workName: 'Electrical', dprDateISO: '2026-09-20', submittedAtISO: '2026-09-20T18:25:00', submittedByName: 'Ramesh Kumar', statusLabel: 'In Progress', percentComplete: 8, targetedWorkforcePerDay: 6, actualWorkforcePerDay: 6, dependencies: [], commentPreset: null },
  { id: 'h11', taskCode: 'CIV-260920-03', taskName: 'Column reinforcement work', workName: 'Civil Works', dprDateISO: '2026-09-20', submittedAtISO: '2026-09-20T17:50:00', submittedByName: 'Prakash Iyer', statusLabel: 'In Progress', percentComplete: 12, targetedWorkforcePerDay: 10, actualWorkforcePerDay: 10, dependencies: [], commentPreset: null },
  { id: 'h12', taskCode: 'CIV-260920-04', taskName: 'Slab shuttering & levelling', workName: 'Civil Works', dprDateISO: '2026-09-20', submittedAtISO: '2026-09-20T18:05:00', submittedByName: 'Prakash Iyer', statusLabel: 'On Hold', percentComplete: 2, targetedWorkforcePerDay: 8, actualWorkforcePerDay: 4, dependencies: ['vendor'], commentPreset: 'awaiting_material_delivery' },
];

function HistoryRow({ entry, isLast }: { entry: MockHistoryEntry; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className={isLast ? '' : 'border-b border-neutral-100'}>
      <Pressable onPress={() => setExpanded((v) => !v)} className="flex-row items-center justify-between py-2.5">
        <View className="flex-1 pr-2">
          <Text className="text-xs font-semibold text-neutral-800" numberOfLines={1}>{entry.taskCode} — {entry.taskName}</Text>
          <Text className="text-2xs text-neutral-400 mt-0.5">
            DPR: {formatDateLabel(new Date(entry.dprDateISO))} · Submitted: {formatDateTimeLabel(new Date(entry.submittedAtISO))}
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#D4D4D4" />
      </Pressable>

      {expanded && (
        <View className="rounded-lg bg-neutral-50 border border-neutral-100 px-2.5 py-2 mb-2.5">
          <Text className="text-2xs font-semibold text-neutral-500 mb-1.5">Submitted by {entry.submittedByName}</Text>

          <View className="flex-row items-center justify-between mb-1.5">
            <View className="px-2 py-0.5 rounded-full bg-brand-navy self-start">
              <Text className="text-2xs font-bold text-white">{entry.statusLabel}</Text>
            </View>
            {entry.percentComplete != null && (
              <Text className="text-2xs font-bold text-neutral-500">{entry.percentComplete}% done that day</Text>
            )}
          </View>

          {(entry.targetedWorkforcePerDay != null || entry.actualWorkforcePerDay != null) && (
            <View className="flex-row gap-4 mb-1.5">
              <Text className="text-2xs text-neutral-500">Targeted: <Text className="font-bold text-neutral-900">{entry.targetedWorkforcePerDay ?? '—'}</Text></Text>
              <Text className="text-2xs text-neutral-500">Actual: <Text className="font-bold text-neutral-900">{entry.actualWorkforcePerDay ?? '—'}</Text></Text>
            </View>
          )}

          {entry.dependencies.length > 0 && (
            <View className="flex-row flex-wrap gap-1 mb-1.5">
              {entry.dependencies.map((cat) => (
                <View key={cat} className="px-2 py-1 rounded-full bg-neutral-100">
                  <Text className="text-2xs font-semibold text-neutral-700">{DPR_DEPENDENCY_LABEL[cat]}</Text>
                </View>
              ))}
            </View>
          )}

          {entry.commentPreset && (
            <Text className="text-2xs text-neutral-600">{DPR_COMMENT_LABEL[entry.commentPreset]}</Text>
          )}
        </View>
      )}
    </View>
  );
}

// Admin-only, by explicit request — a chronological log of past DPR
// submissions across all tasks/days, each row collapsed to just its two
// dates until tapped open. Mock data only (see MOCK_HISTORY's own comment)
// — swap for a real fetchDprHistory(selectedProjectId) once enough real
// submissions exist to preview against.
export function DprHistorySection() {
  return (
    <View className="mt-5">
      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Submission History</Text>
      <Card style={{ paddingVertical: 4 }}>
        {MOCK_HISTORY.map((entry, i) => (
          <HistoryRow key={entry.id} entry={entry} isLast={i === MOCK_HISTORY.length - 1} />
        ))}
      </Card>
    </View>
  );
}
