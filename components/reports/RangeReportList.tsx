import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { groupByDepartment, type RangeTaskRow } from '../../lib/reports/rangeTaskReport';
import { computeRowParamCheck } from '../../lib/debug/rangeTaskReportParamCheck';
import { RangeTaskDetailRows } from './RangeTaskDetailRows';
import { EmptyState } from '../ui/EmptyState';

function TaskRow({ row, isLast }: { row: RangeTaskRow; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View className={isLast ? '' : 'border-b border-neutral-100'}>
      <Pressable onPress={() => setOpen((v) => !v)} className="flex-row items-center justify-between px-3.5 py-2.5">
        <View className="flex-1 pr-2">
          <Text className="text-xs font-semibold text-neutral-800" numberOfLines={1}>{row.taskCode} — {row.taskName}</Text>
          <Text className="text-2xs text-neutral-400 mt-0.5">
            {row.percentCompleteByQuantity != null ? `${row.percentCompleteByQuantity}% complete` : 'No quantity tracked'}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <View className={`px-2 py-0.5 rounded-full ${row.isOverdue ? 'bg-red-50' : 'bg-green-50'}`}>
            <Text className={`text-2xs font-bold ${row.isOverdue ? 'text-red-700' : 'text-green-700'}`}>
              {row.isOverdue ? 'Overdue' : 'On track'}
            </Text>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#9CA3AF" />
        </View>
      </Pressable>
      {open && <RangeTaskDetailRows results={computeRowParamCheck(row).results} showStatus={false} />}
    </View>
  );
}

// The real (non-debug) grouped task list every one of Weekly/Monthly/
// Custom Date-Range shares — Department-grouped, each row shows the 3
// headline fields the spec called out (name, % complete, overdue), with
// the rest of the same 13 parameters available by tapping to expand.
export function RangeReportList({ rows }: { rows: RangeTaskRow[] }) {
  if (rows.length === 0) {
    return <EmptyState icon="list-outline" iconColor="#9CA3AF" title="No tasks in this range" />;
  }
  const groups = groupByDepartment(rows);

  return (
    <View>
      {groups.map((group) => (
        <View key={group.workName} className="mb-4">
          <View className="flex-row items-center gap-2 mb-1.5 px-0.5">
            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-500">{group.workName}</Text>
            <Text className="text-2xs text-neutral-400">{group.rows.length} task{group.rows.length === 1 ? '' : 's'}</Text>
          </View>
          <View className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            {group.rows.map((row, i) => <TaskRow key={row.id} row={row} isLast={i === group.rows.length - 1} />)}
          </View>
        </View>
      ))}
    </View>
  );
}
