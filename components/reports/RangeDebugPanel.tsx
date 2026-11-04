import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { computeRangeParamCheck, type TaskParamCheck } from '../../lib/debug/rangeTaskReportParamCheck';
import type { RangeTaskRow } from '../../lib/reports/rangeTaskReport';
import { RangeTaskDetailRows } from './RangeTaskDetailRows';

function TaskCheckRow({ task }: { task: TaskParamCheck }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="border-t border-amber-100">
      <Pressable onPress={() => setOpen((v) => !v)} className="flex-row items-center justify-between px-3.5 py-2">
        <View className="flex-row items-center gap-1.5 flex-1 pr-2">
          <Ionicons name={task.allOk ? 'checkmark-circle' : 'close-circle'} size={13} color={task.allOk ? '#16A34A' : '#DC2626'} />
          <Text className="text-2xs font-medium text-neutral-800 flex-1" numberOfLines={1}>{task.taskCode} — {task.taskName}</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Text className="text-2xs text-neutral-500">{task.okCount}/{task.total}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={13} color="#B45309" />
        </View>
      </Pressable>
      {open && <RangeTaskDetailRows results={task.results} showStatus />}
    </View>
  );
}

// TEMP DEBUG - REMOVE BEFORE CLIENT DELIVERY. Same pattern as Task Report's
// own DebugParamCheckPanel, scoped to every task in the current
// Weekly/Monthly/Custom-Range report instead of just one — see
// lib/debug/rangeTaskReportParamCheck.ts's own header for the full removal
// list. Collapsed by default.
export function RangeDebugPanel({ rows }: { rows: RangeTaskRow[] }) {
  const [open, setOpen] = useState(false);
  const { perTask, tasksComplete, tasksTotal } = computeRangeParamCheck(rows);

  return (
    <View className="rounded-xl border border-dashed border-amber-300 bg-amber-50 mb-3.5 overflow-hidden">
      <Pressable onPress={() => setOpen((v) => !v)} className="flex-row items-center justify-between px-3.5 py-2.5">
        <Text className="text-2xs font-bold uppercase tracking-wide text-amber-700">
          🐛 Debug: Parameter Check — Tasks with complete data: {tasksComplete}/{tasksTotal}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#B45309" />
      </Pressable>

      {open && (
        <View className="pb-1">
          {perTask.length === 0 ? (
            <Text className="text-2xs text-neutral-400 px-3.5 pb-2">No tasks in this range.</Text>
          ) : (
            perTask.map((task) => <TaskCheckRow key={task.id} task={task} />)
          )}
        </View>
      )}
    </View>
  );
}
