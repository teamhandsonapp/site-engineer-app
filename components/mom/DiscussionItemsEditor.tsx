// MoM › Create / Edit meeting › "What will be discussed".
// Two ways to add items, usable together:
//   a) Tasks by department — pick a department (real works rows), tick that
//      department's tasks in this project, "Add selected". Repeat for others.
//   b) Custom topics — free text, not linked to a task.
// Selected items are listed below (tasks grouped by department), each removable.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from '../ui/AppText';
import { FormModal } from '../ui/FormModal';
import { fetchDepartments, type Department } from '../../lib/departments';
import { fetchDepartmentTasks, type PickerTask } from '../../lib/drawingFiles';
import { newId } from '../../lib/mom/store';
import { TOPIC_MAX, type DiscussionItem } from '../../lib/mom/types';
import { Button, NAVY } from './ui';

const STATUS_COLOR: Record<string, string> = {
  completed: '#15803D',
  in_progress: '#1D4ED8',
  blocked: '#DC2626',
  not_started: '#6B7280',
};

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ');
}

export function DiscussionItemsEditor({
  projectId,
  items,
  onChange,
  error,
}: {
  projectId: string;
  items: DiscussionItem[];
  onChange: (next: DiscussionItem[]) => void;
  error: string | null;
}) {
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [deptError, setDeptError] = useState<string | null>(null);
  const [deptPickerOpen, setDeptPickerOpen] = useState(false);
  const [dept, setDept] = useState<Department | null>(null);
  const [tasks, setTasks] = useState<PickerTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [topicOpen, setTopicOpen] = useState(false);
  const [topic, setTopic] = useState('');

  useEffect(() => {
    let alive = true;
    fetchDepartments(projectId)
      .then((d) => alive && setDepartments(d))
      .catch((e) => alive && setDeptError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [projectId]);

  function pickDepartment(d: Department) {
    setDeptPickerOpen(false);
    setDept(d);
    setQuery('');
    setTicked(new Set());
    setTasksError(null);
    setTasksLoading(true);
    fetchDepartmentTasks(projectId, d.id)
      .then(setTasks)
      .catch((e) => {
        setTasks([]);
        setTasksError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setTasksLoading(false));
  }

  const addedTaskIds = useMemo(() => new Set(items.filter((i) => i.type === 'task').map((i) => i.taskId)), [items]);
  const q = query.trim().toLowerCase();
  const shownTasks = q ? tasks.filter((t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)) : tasks;

  function addSelected() {
    if (!dept) return;
    const fresh = tasks
      .filter((t) => ticked.has(t.id) && !addedTaskIds.has(t.id))
      .map<DiscussionItem>((t) => ({
        id: newId(),
        type: 'task',
        taskId: t.id,
        taskCode: t.code,
        departmentId: dept.id,
        departmentName: dept.name,
        title: t.name,
      }));
    if (fresh.length) onChange([...items, ...fresh]);
    setTicked(new Set());
  }

  function addTopic() {
    const text = topic.trim().slice(0, TOPIC_MAX);
    if (!text) return;
    onChange([...items, { id: newId(), type: 'topic', taskId: null, taskCode: null, departmentId: null, departmentName: null, title: text }]);
    setTopic('');
  }

  // Selected list: tasks grouped by department (in the order first added), then topics.
  const groups = useMemo(() => {
    const byDept = new Map<string, DiscussionItem[]>();
    for (const i of items) {
      if (i.type !== 'task') continue;
      const k = i.departmentName ?? 'Department';
      byDept.set(k, [...(byDept.get(k) ?? []), i]);
    }
    return [...byDept.entries()];
  }, [items]);
  const topics = items.filter((i) => i.type === 'topic');
  const deptColor = (id: string | null) => departments?.find((d) => d.id === id)?.color ?? NAVY;

  return (
    <View>
      {/* a) Tasks by department */}
      <Text className="text-xs font-bold text-neutral-700 mb-1.5">Tasks by department</Text>
      <Pressable
        testID="discussion-department-picker"
        onPress={() => setDeptPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={dept ? `Department: ${dept.name}. Change` : 'Choose a department'}
        className="flex-row items-center gap-2 border border-neutral-200 rounded-lg px-3 bg-white"
        style={{ minHeight: 44 }}
      >
        {dept ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dept.color }} /> : <Ionicons name="business-outline" size={16} color="#6B7280" />}
        <Text className="flex-1 text-sm" style={{ color: dept ? '#111827' : '#9CA3AF' }} numberOfLines={1}>
          {dept ? dept.name : 'Choose a department'}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#6B7280" />
      </Pressable>
      {deptError ? <Text className="text-2xs text-red-600 mt-1">{`Couldn't load departments — ${deptError}`}</Text> : null}

      {dept ? (
        <View className="mt-2">
          {tasksLoading ? (
            <ActivityIndicator color={NAVY} style={{ marginVertical: 12 }} />
          ) : tasksError ? (
            <Text className="text-2xs text-red-600">{`Couldn't load tasks — ${tasksError}`}</Text>
          ) : tasks.length === 0 ? (
            <View testID="discussion-no-tasks" className="rounded-lg bg-neutral-50 border border-neutral-100 px-3 py-3">
              <Text className="text-xs font-semibold text-neutral-700">No tasks in this department</Text>
              <Text className="text-2xs text-neutral-500 mt-0.5">Add a topic below instead.</Text>
            </View>
          ) : (
            <>
              {tasks.length > 4 ? (
                <View className="flex-row items-center gap-2 border border-neutral-200 rounded-lg px-3 bg-white mb-1.5" style={{ minHeight: 42 }}>
                  <Ionicons name="search" size={15} color="#6B7280" />
                  <TextInput
                    testID="discussion-task-search"
                    value={query}
                    onChangeText={setQuery}
                    placeholder={`Search ${dept.name} tasks`}
                    placeholderTextColor="#9CA3AF"
                    className="flex-1 text-sm text-neutral-900"
                    style={{ paddingVertical: 8 }}
                  />
                </View>
              ) : null}
              <View className="rounded-lg border border-neutral-100 bg-white overflow-hidden">
                {shownTasks.map((t, idx) => {
                  const already = addedTaskIds.has(t.id);
                  const on = already || ticked.has(t.id);
                  return (
                    <Pressable
                      key={t.id}
                      testID={`discussion-task-${t.code}`}
                      disabled={already}
                      onPress={() =>
                        setTicked((prev) => {
                          const n = new Set(prev);
                          if (n.has(t.id)) n.delete(t.id);
                          else n.add(t.id);
                          return n;
                        })
                      }
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: already }}
                      className={`flex-row items-center gap-2.5 px-3 ${idx > 0 ? 'border-t border-neutral-100' : ''}`}
                      style={{ minHeight: 48, opacity: already ? 0.55 : 1 }}
                    >
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? NAVY : '#D1D5DB'} />
                      <View className="flex-1 py-1.5">
                        <Text className="text-sm text-neutral-900" numberOfLines={1}>
                          {t.name}
                        </Text>
                        <Text className="text-2xs text-neutral-500" numberOfLines={1}>
                          {t.code}
                          {already ? ' · already added' : ''}
                        </Text>
                      </View>
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: `${STATUS_COLOR[t.status] ?? '#6B7280'}1A` }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: STATUS_COLOR[t.status] ?? '#6B7280' }}>{statusLabel(t.status)}</Text>
                      </View>
                    </Pressable>
                  );
                })}
                {shownTasks.length === 0 ? <Text className="text-xs text-neutral-500 px-3 py-3">No task matches “{query}”.</Text> : null}
              </View>
              <View className="mt-2">
                <Button
                  label={ticked.size ? `Add selected (${ticked.size})` : 'Add selected'}
                  icon="add"
                  variant="secondary"
                  disabled={ticked.size === 0}
                  onPress={addSelected}
                />
              </View>
            </>
          )}
        </View>
      ) : null}

      {/* b) Custom topics */}
      <View className="mt-4">
        <Text className="text-xs font-bold text-neutral-700 mb-1.5">Topics</Text>
        {topicOpen ? (
          <View>
            <View className="flex-row items-center gap-2">
              <TextInput
                testID="discussion-topic-input"
                value={topic}
                onChangeText={(v) => setTopic(v.slice(0, TOPIC_MAX))}
                maxLength={TOPIC_MAX}
                placeholder="e.g. Payment schedule discussion"
                placeholderTextColor="#9CA3AF"
                onSubmitEditing={addTopic}
                returnKeyType="done"
                autoFocus
                className="flex-1 border border-neutral-200 rounded-lg px-3 text-sm text-neutral-900 bg-white"
                style={{ minHeight: 44 }}
              />
              <Pressable
                testID="discussion-topic-add"
                onPress={addTopic}
                disabled={!topic.trim()}
                accessibilityRole="button"
                accessibilityLabel="Add topic"
                className="items-center justify-center rounded-lg px-3"
                style={{ minHeight: 44, backgroundColor: topic.trim() ? NAVY : '#E5E7EB' }}
              >
                <Text className="text-xs font-bold" style={{ color: topic.trim() ? '#fff' : '#9CA3AF' }}>Add</Text>
              </Pressable>
            </View>
            <View className="flex-row justify-between mt-1">
              <Pressable onPress={() => { setTopicOpen(false); setTopic(''); }} hitSlop={6}>
                <Text className="text-2xs font-semibold text-neutral-500">Done adding topics</Text>
              </Pressable>
              <Text className="text-2xs text-neutral-400">{topic.length}/{TOPIC_MAX}</Text>
            </View>
          </View>
        ) : (
          <Pressable
            testID="discussion-add-topic"
            onPress={() => setTopicOpen(true)}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 self-start rounded-lg border border-dashed border-neutral-300 px-3"
            style={{ minHeight: 40 }}
          >
            <Ionicons name="add" size={16} color={NAVY} />
            <Text className="text-xs font-bold" style={{ color: NAVY }}>Add topic</Text>
          </Pressable>
        )}
      </View>

      {/* Selected items */}
      <View className="mt-4 pt-3 border-t border-neutral-100">
        <Text testID="discussion-count" className="text-xs font-bold text-neutral-900 mb-2">
          {items.length === 0 ? 'Nothing added yet' : `${items.length} item${items.length === 1 ? '' : 's'} to discuss`}
        </Text>
        {groups.map(([deptName, list]) => (
          <View key={deptName} className="mb-2">
            {list.map((i) => (
              <ItemRow key={i.id} item={i} tag={deptName} tagColor={deptColor(i.departmentId)} onRemove={() => onChange(items.filter((x) => x.id !== i.id))} />
            ))}
          </View>
        ))}
        {topics.map((i) => (
          <ItemRow key={i.id} item={i} tag="Topic" tagColor="#7C3AED" onRemove={() => onChange(items.filter((x) => x.id !== i.id))} />
        ))}
        {error ? (
          <Text testID="discussion-error" className="text-xs font-semibold mt-1" style={{ color: '#DC2626' }}>
            {error}
          </Text>
        ) : null}
      </View>

      {/* Department picker (bottom sheet, big rows — easy one-handed) */}
      <FormModal visible={deptPickerOpen} onRequestClose={() => setDeptPickerOpen(false)} position="bottom" animationType="slide">
        <View className="bg-white rounded-t-2xl px-4 pt-3 pb-8 w-full self-center" style={{ maxWidth: 640 }}>
          <View className="flex-row items-center mb-2">
            <Text className="flex-1 text-base font-bold text-neutral-900">Choose a department</Text>
            <Pressable onPress={() => setDeptPickerOpen(false)} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#6B7280" />
            </Pressable>
          </View>
          {departments === null && !deptError ? <ActivityIndicator color={NAVY} style={{ marginVertical: 16 }} /> : null}
          {departments?.length === 0 ? <Text className="text-sm text-neutral-500 py-3">This project has no departments yet.</Text> : null}
          {(departments ?? []).map((d) => (
            <Pressable
              key={d.id}
              testID={`discussion-dept-${d.code}`}
              onPress={() => pickDepartment(d)}
              className="flex-row items-center gap-3 border-t border-neutral-100"
              style={{ minHeight: 52 }}
              accessibilityRole="button"
            >
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: d.color }} />
              <Text className="flex-1 text-sm font-semibold text-neutral-900" numberOfLines={1}>
                {d.name}
              </Text>
              <Text className="text-2xs text-neutral-500">{d.taskCount} task{d.taskCount === 1 ? '' : 's'}</Text>
              {dept?.id === d.id ? <Ionicons name="checkmark" size={18} color={NAVY} /> : null}
            </Pressable>
          ))}
        </View>
      </FormModal>
    </View>
  );
}

function ItemRow({ item, tag, tagColor, onRemove }: { item: DiscussionItem; tag: string; tagColor: string; onRemove: () => void }) {
  return (
    <View testID={`discussion-item-${item.type}`} className="flex-row items-center gap-2 py-1.5">
      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: `${tagColor}1A`, maxWidth: 120 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: tagColor }} numberOfLines={1}>
          {tag}
        </Text>
      </View>
      <Text className="flex-1 text-sm text-neutral-900" numberOfLines={2}>
        {item.title}
      </Text>
      <Pressable testID="discussion-item-remove" onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${item.title}`}>
        <Ionicons name="close-circle" size={20} color="#9CA3AF" />
      </Pressable>
    </View>
  );
}
