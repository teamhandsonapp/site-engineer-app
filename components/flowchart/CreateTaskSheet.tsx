import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Card } from '../ui/Card';
import { DateField } from '../ui/DateField';
import {
  createTask,
  fetchDependencyTemplate,
  fetchWorksForProject,
  seedDependencyItems,
  createDependency,
  type WorkOption,
} from '../../lib/flowchart/data';
import type { DependencyType, FlowchartSeriesEdge, FlowchartTask, TaskTypeOption } from '../../lib/flowchart/types';

const LINK_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];
const LINK_TYPE_LABEL: Record<DependencyType, string> = {
  FS: 'FS — blocks start until the other finishes',
  SS: 'SS — blocks start until the other starts',
  FF: 'FF — blocks finish until the other finishes',
  SF: 'SF — blocks finish until the other starts',
};

// Three fields are mandatory here by explicit request, beyond what admin-web
// itself requires on ITS OWN create-task form (there, only task name +
// work are required — neither Task Type, dates, nor links are required
// there either). This form is deliberately stricter than admin-web's own.
// AC/AV used to be a fourth mandatory field here too — now auto-classified
// by keyword match at creation (matching admin-web's createTaskCore) and
// no longer picked manually; a wrong guess or no-match task can be set via
// Edit Task afterward instead (see TaskDetailSheet's own AC/AV control).
export function CreateTaskSheet({
  projectId,
  existingTasks,
  taskTypes,
  onClose,
  onCreated,
}: {
  projectId: string;
  existingTasks: { id: string; taskId: string; taskName: string }[];
  taskTypes: TaskTypeOption[];
  onClose: () => void;
  onCreated: (task: FlowchartTask, edge: FlowchartSeriesEdge | null) => void;
}) {
  const [works, setWorks] = useState<WorkOption[]>([]);
  const [loadingWorks, setLoadingWorks] = useState(true);

  const [workId, setWorkId] = useState<string | null>(null);
  const [taskName, setTaskName] = useState('');
  const [description, setDescription] = useState('');
  const [taskTypeId, setTaskTypeId] = useState<string | null>(null);
  const [plannedStartDate, setPlannedStartDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [linkTaskId, setLinkTaskId] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<DependencyType | null>(null);

  const [taskTypeOpen, setTaskTypeOpen] = useState(false);
  const [linkTaskOpen, setLinkTaskOpen] = useState(false);
  const [linkTypeOpen, setLinkTypeOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWorksForProject(projectId)
      .then((list) => {
        setWorks(list);
        setWorkId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingWorks(false));
  }, [projectId]);

  const selectedWork = works.find((w) => w.id === workId);
  const selectedTaskType = taskTypes.find((t) => t.id === taskTypeId);
  const selectedLinkTask = existingTasks.find((t) => t.id === linkTaskId);

  const missing: string[] = [];
  if (!taskName.trim()) missing.push('Task Name');
  if (!workId) missing.push('Work');
  if (!taskTypeId) missing.push('Task Type');
  if (!plannedStartDate) missing.push('Planned Start');
  if (!dueDate) missing.push('Planned End');
  if (!linkTaskId || !linkType) missing.push('Dependency Link');

  async function handleSave() {
    if (missing.length > 0 || !workId || !selectedWork || !taskTypeId || !plannedStartDate || !dueDate || !linkTaskId || !linkType) {
      setError(`Please fill in: ${missing.join(', ')}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const newTask = await createTask({
        workId,
        workCode: selectedWork.code,
        taskName: taskName.trim(),
        description: description.trim() || null,
        taskTypeId,
        plannedStartDate,
        dueDate,
      });

      // Auto-seed the checklist so this behaves identically to a task
      // created on admin-web (createTaskCore does the same seed there) —
      // a mobile-created task shouldn't open to an empty "Open" screen.
      const template = await fetchDependencyTemplate();
      await seedDependencyItems(newTask.id, template).catch(() => {
        // Non-fatal — the task itself is real either way; a missing
        // checklist seed is recoverable later, an uncreated task is not.
      });

      let edge: FlowchartSeriesEdge | null = null;
      try {
        edge = await createDependency(newTask.id, linkTaskId, linkType);
      } catch (linkErr) {
        // The task is already created at this point — surface the link
        // failure but don't pretend the whole thing failed.
        setError(linkErr instanceof Error ? `Task created, but the link failed: ${linkErr.message}` : 'Task created, but the link failed.');
      }

      onCreated(newTask, edge);
      if (!edge) return; // keep the sheet open with the error visible above
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the task');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 400, maxHeight: '88%' }}>
          <Card>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-sm font-bold text-neutral-900 mb-3">New Task</Text>

              {error && (
                <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-3">
                  <Text className="text-xs text-red-600">{error}</Text>
                </View>
              )}

              <Text className="text-xs text-neutral-400 mb-1">Work *</Text>
              {loadingWorks ? (
                <ActivityIndicator size="small" color="#0F1F33" style={{ marginBottom: 12, alignSelf: 'flex-start' }} />
              ) : (
                <View className="flex-row flex-wrap gap-1.5 mb-3">
                  {works.map((w) => {
                    const active = workId === w.id;
                    return (
                      <Pressable
                        key={w.id}
                        onPress={() => setWorkId(w.id)}
                        className={`px-2.5 py-1.5 rounded-full ${active ? 'bg-brand-navy' : 'bg-neutral-100'}`}
                      >
                        <Text className={`text-2xs font-semibold ${active ? 'text-white' : 'text-neutral-600'}`}>{w.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Text className="text-xs text-neutral-400 mb-1">Task Name *</Text>
              <TextInput
                value={taskName}
                onChangeText={setTaskName}
                placeholder="e.g. Column starter casting"
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
              />

              <Text className="text-xs text-neutral-400 mb-1">Description (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Describe the scope of work…"
                multiline
                numberOfLines={2}
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
                style={{ minHeight: 52, textAlignVertical: 'top' }}
              />
              <Text className="text-2xs text-neutral-400 mb-3" style={{ marginTop: -8 }}>
                AC/AV is classified automatically from the task name — correct it later via Edit Task if needed.
              </Text>

              <Text className="text-xs text-neutral-400 mb-1">Task Type *</Text>
              <Pressable
                onPress={() => setTaskTypeOpen((v) => !v)}
                className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 mb-1"
              >
                <Text className="text-sm text-neutral-900">
                  {selectedTaskType ? `${selectedTaskType.name} — ${selectedTaskType.defaultDurationDays} working days` : 'Select a type'}
                </Text>
                <Text className="text-neutral-400">{taskTypeOpen ? '▲' : '▼'}</Text>
              </Pressable>
              {taskTypeOpen && (
                <View className="mb-3">
                  {taskTypes.map((t) => {
                    const active = taskTypeId === t.id;
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => { setTaskTypeId(t.id); setTaskTypeOpen(false); }}
                        className={`px-3 py-2 rounded-lg mb-1 ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                      >
                        <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-neutral-600'}`}>
                          {t.name} — {t.defaultDurationDays} working days
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <View className="flex-row gap-2 mb-3">
                <View className="flex-1">
                  <DateField label="Planned Start *" value={plannedStartDate} onChange={setPlannedStartDate} />
                </View>
                <View className="flex-1">
                  <DateField label="Planned End *" value={dueDate} minDate={plannedStartDate} onChange={setDueDate} />
                </View>
              </View>

              <Text className="text-xs text-neutral-400 mb-1">Dependency Link *</Text>
              <Pressable
                onPress={() => setLinkTaskOpen((v) => !v)}
                className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 mb-1"
              >
                <Text className="text-sm text-neutral-900" numberOfLines={1}>
                  {selectedLinkTask ? `${selectedLinkTask.taskId} — ${selectedLinkTask.taskName}` : 'Select the prerequisite task'}
                </Text>
                <Text className="text-neutral-400">{linkTaskOpen ? '▲' : '▼'}</Text>
              </Pressable>
              {linkTaskOpen && (
                <ScrollView style={{ maxHeight: 160 }} className="mb-2 border border-neutral-100 rounded-lg">
                  {existingTasks.map((t) => {
                    const active = linkTaskId === t.id;
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => { setLinkTaskId(t.id); setLinkTaskOpen(false); }}
                        className={`px-3 py-2 ${active ? 'bg-neutral-100' : ''}`}
                      >
                        <Text className="text-xs text-neutral-700" numberOfLines={1}>{t.taskId} — {t.taskName}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              <Pressable
                onPress={() => setLinkTypeOpen((v) => !v)}
                className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 mb-1"
              >
                <Text className="text-sm text-neutral-900">{linkType ? LINK_TYPE_LABEL[linkType] : 'Select relationship type'}</Text>
                <Text className="text-neutral-400">{linkTypeOpen ? '▲' : '▼'}</Text>
              </Pressable>
              {linkTypeOpen && (
                <View className="mb-3">
                  {LINK_TYPES.map((lt) => {
                    const active = linkType === lt;
                    return (
                      <Pressable
                        key={lt}
                        onPress={() => { setLinkType(lt); setLinkTypeOpen(false); }}
                        className={`px-3 py-2 rounded-lg mb-1 ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                      >
                        <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-neutral-600'}`}>{LINK_TYPE_LABEL[lt]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>

            <View className="flex-row justify-end gap-2 mt-3">
              <Pressable onPress={onClose} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSave} disabled={saving} className="px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
                {saving && <ActivityIndicator size="small" color="#fff" />}
                <Text className="text-xs font-semibold text-white">Create Task</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
