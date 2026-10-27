import { ScrollView, Text, View } from 'react-native';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import type { FlowchartTask } from '../../lib/flowchart/types';

// The Filter panel's "List view" — same filtered task set the Flowchart
// view shows as a canvas, here as a flat scrollable list instead, by
// explicit request ("I need flowchart view or list view both I can
// switch"). MILE-xx codes stay hidden here too, same reasoning as
// TaskNode.tsx's own node label.
function TaskRow({ task }: { task: FlowchartTask }) {
  const showCode = !task.taskId.startsWith('MILE-');
  return (
    <Card className="mb-2.5">
      {showCode && <Text className="text-2xs font-mono font-bold text-neutral-400 mb-0.5">{task.taskId}</Text>}
      <Text className="text-sm font-bold text-neutral-900 mb-1">{task.taskName}</Text>
      <View className="flex-row flex-wrap gap-1.5">
        <View className="px-2 py-0.5 rounded-full bg-neutral-100">
          <Text className="text-2xs font-semibold text-neutral-600">{task.workName}</Text>
        </View>
        {task.floorLevel && (
          <View className="px-2 py-0.5 rounded-full bg-blue-50">
            <Text className="text-2xs font-semibold text-blue-700">{task.floorLevel}</Text>
          </View>
        )}
        {task.roomType && (
          <View className="px-2 py-0.5 rounded-full bg-amber-50">
            <Text className="text-2xs font-semibold text-amber-700">{task.roomType}</Text>
          </View>
        )}
      </View>
      {(task.plannedStartDate || task.dueDate) && (
        <Text className="text-2xs text-neutral-400 mt-1.5">
          {task.plannedStartDate ?? '—'} – {task.dueDate ?? '—'}
        </Text>
      )}
    </Card>
  );
}

export function FilteredTaskList({ tasks }: { tasks: FlowchartTask[] }) {
  if (tasks.length === 0) {
    return <EmptyState icon="search-outline" iconColor="#9CA3AF" title="No matching tasks" subtitle="Try a different filter combination." />;
  }
  return (
    <ScrollView contentContainerClassName="px-4 pt-3 pb-8">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </ScrollView>
  );
}
