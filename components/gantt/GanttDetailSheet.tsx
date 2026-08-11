import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Card } from '../ui/Card';
import type { TimelineWork } from '../../lib/projectTimeline';
import type { TaskDelayInfo } from '../../lib/gantt/delayEngine';
import { toLocalCalendarDate } from '../../lib/ganttLayout';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  ready: 'Ready',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  // Matches admin-web's own STATUS_LABELS exactly — this key's display
  // label really is "Not Started", not "Blocked".
  blocked: 'Not Started',
  completed: 'Completed',
};

function formatDate(date: string | Date | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00.000Z`) : date;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface DetailTask {
  id: string;
  taskCode: string;
  taskName: string;
  status: string;
  plannedStartDate: string | null;
  dueDate: string | null;
  workName: string;
  workColor: string;
}

// Mirrors admin-web's GanttDetailPopup.tsx field-for-field: planned range,
// projected/actual range, a delay banner (or "On schedule"), the driving
// prerequisite (if any), and every downstream task this one is currently
// the driving cause of delay for. Unlike admin-web's own popup — which
// re-invokes computeProjectDelays() fresh per tap — every figure here is
// read straight off the SAME delayById map GanttChart already computed once
// for the bars (see projectTimeline.ts's own comment on why that's the
// single shared source, not a second independent calculation).
export function GanttDetailSheet({
  task,
  delayById,
  works,
  onClose,
}: {
  task: DetailTask | null;
  delayById: Record<string, TaskDelayInfo>;
  works: TimelineWork[];
  onClose: () => void;
}) {
  const taskLookup = useMemo(() => {
    const map = new Map<string, { taskCode: string; taskName: string; workName: string }>();
    for (const w of works) {
      for (const t of w.tasks) map.set(t.id, { taskCode: t.taskCode, taskName: t.taskName, workName: w.workName });
    }
    return map;
  }, [works]);

  if (!task) return null;
  const delay = delayById[task.id];
  if (!delay) return null;

  const drivingPrerequisite = delay.drivingPrerequisiteTaskId ? taskLookup.get(delay.drivingPrerequisiteTaskId) ?? null : null;
  const downstreamImpacted = [...Object.entries(delayById)]
    .filter(([id, d]) => id !== task.id && d.drivingPrerequisiteTaskId === task.id)
    .map(([id, d]) => ({ ...(taskLookup.get(id) ?? { taskCode: '?', taskName: 'Unknown task', workName: '' }), totalDelayDays: d.totalDelayDays }))
    .sort((a, b) => b.totalDelayDays - a.totalDelayDays);

  const statusLabel = STATUS_LABELS[task.status] ?? task.status;
  const isDelayed = delay.totalDelayDays > 0;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380, maxHeight: '85%' }}>
          <Card>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-md font-bold text-neutral-900">{task.taskName}</Text>
              <Text className="text-xs font-mono text-neutral-400 mt-0.5">{task.taskCode}</Text>

              <View className="flex-row items-center gap-1.5 mt-2">
                <View className="w-2 h-2 rounded-full" style={{ backgroundColor: task.workColor }} />
                <Text className="text-xs text-neutral-600">{task.workName}</Text>
                <Text className="text-xs text-neutral-300">·</Text>
                <Text className="text-xs text-neutral-600">{statusLabel}</Text>
              </View>

              <View className="flex-row gap-2 mt-3">
                <View className="flex-1 rounded-lg bg-neutral-50 px-2.5 py-2">
                  <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400">Planned</Text>
                  <Text className="text-xs text-neutral-700 mt-0.5">
                    {formatDate(task.plannedStartDate)} → {formatDate(task.dueDate)}
                  </Text>
                </View>
                <View className="flex-1 rounded-lg bg-neutral-50 px-2.5 py-2">
                  <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400">Projected / Actual</Text>
                  <Text className="text-xs text-neutral-700 mt-0.5">
                    {formatDate(toLocalCalendarDate(delay.projectedStart))} → {formatDate(toLocalCalendarDate(delay.projectedFinish))}
                  </Text>
                </View>
              </View>

              {isDelayed ? (
                <View className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                  <Text className="text-sm font-semibold text-red-700">
                    {delay.totalDelayDays} working day{delay.totalDelayDays === 1 ? '' : 's'} behind plan
                  </Text>
                  <Text className="text-xs text-red-600 mt-0.5">
                    {delay.inheritedDelayDays} inherited, {delay.ownDelayDays} added by this task
                  </Text>
                </View>
              ) : (
                <View className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
                  <Text className="text-sm font-semibold text-green-700">On schedule</Text>
                </View>
              )}

              {drivingPrerequisite && (
                <View className="mt-2.5 pt-2.5 border-t border-neutral-100">
                  <Text className="text-xs text-neutral-500">
                    Delayed by <Text className="font-mono font-semibold text-neutral-700">{drivingPrerequisite.taskCode}</Text> — {drivingPrerequisite.taskName}
                  </Text>
                </View>
              )}

              {downstreamImpacted.length > 0 && (
                <View className="mt-2.5 pt-2.5 border-t border-neutral-100">
                  <Text className="text-xs font-semibold text-neutral-600 mb-1.5">
                    Driving delay for {downstreamImpacted.length} downstream task{downstreamImpacted.length === 1 ? '' : 's'}:
                  </Text>
                  <View className="gap-1">
                    {downstreamImpacted.map((d) => (
                      <View key={d.taskCode} className="flex-row items-center justify-between">
                        <Text className="text-xs text-neutral-600 flex-1 pr-2" numberOfLines={1}>
                          <Text className="font-mono">{d.taskCode}</Text> — {d.taskName}
                        </Text>
                        <Text className="text-xs font-semibold text-red-600">+{d.totalDelayDays}d</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </ScrollView>

            <View className="flex-row justify-end mt-3">
              <Pressable onPress={onClose} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">Close</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
