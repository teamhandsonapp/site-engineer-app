import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/ui/Card';
import { useProject } from '../../lib/ProjectContext';
import { useSafeBottomOffset } from '../../lib/useSafeBottomOffset';
import { PEOPLE, personName } from '../../lib/dummyPeople';
import { supabase } from '../../lib/supabase';
import { fetchWorksForProject, type WorkOption } from '../../lib/flowchart/data';
import { fetchSubtasksForTask } from '../../lib/dprEntries';

// MoM (Minutes of Meeting) — rough first version, by explicit request:
// Create MoM -> fixed format (title/date/time/venue, attendees picked from a
// list, agenda (Department > Task > Subtask from real project data),
// discussion, action items) -> Save Draft or Send MoM.
// Project-specific (uses the selected project, same as a project
// dashboard's other quick links). DUMMY / IN-MEMORY ONLY for now — nothing
// is written to Supabase and the attendee list is sample people; saved MoMs
// last until the app reloads.

const VENUES = ['Site', 'Office', 'Online'];

interface ActionItem {
  department: string; // department of the linked task (auto-filled from the agenda)
  taskName: string; // the project task this action is about (from the agenda)
  task: string; // the action itself
  ownerId: string | null;
  due: string;
  comments: string;
}

const emptyAction = (): ActionItem => ({ department: '', taskName: '', task: '', ownerId: null, due: '', comments: '' });

// One agenda line picked from the project's REAL data: Department (works) ->
// Task (tasks under that work) -> Subtask (the task's DPR subtasks, optional).
interface AgendaItem {
  workId: string | null;
  workName: string;
  taskId: string | null;
  taskName: string;
  subtask: string;
}

const emptyAgendaItem = (): AgendaItem => ({ workId: null, workName: '', taskId: null, taskName: '', subtask: '' });

interface TaskOption {
  id: string;
  name: string;
}

async function fetchTasksForWork(workId: string): Promise<TaskOption[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, task_name')
    .eq('work_id', workId)
    .is('deleted_at', null)
    .order('task_name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; task_name: string }[]).map((t) => ({ id: t.id, name: t.task_name }));
}

// Collapsed dropdown that expands in normal flow (same convention as the
// DPR form's Status dropdown) — used for Department / Task / Subtask.
function SelectBox({
  placeholder,
  value,
  options,
  onChange,
  loading,
  disabled,
  emptyText,
}: {
  placeholder: string;
  value: string;
  options: { key: string; label: string }[];
  onChange: (key: string) => void;
  loading?: boolean;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="mt-1.5">
      <Pressable
        onPress={() => !disabled && setOpen((v) => !v)}
        className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2 bg-white"
        style={{ opacity: disabled ? 0.5 : 1 }}
      >
        <Text className={`text-sm flex-1 ${value ? 'text-neutral-900' : 'text-neutral-400'}`} numberOfLines={1}>
          {value || placeholder}
        </Text>
        {loading ? <ActivityIndicator size="small" color="#0F1F33" /> : <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#9CA3AF" />}
      </Pressable>
      {open && !loading && (
        <View className="mt-1 border border-neutral-100 rounded-lg overflow-hidden bg-white" style={{ maxHeight: 220 }}>
          <ScrollView nestedScrollEnabled>
            {options.length === 0 && <Text className="text-xs text-neutral-400 px-3 py-2">{emptyText ?? 'Nothing to select'}</Text>}
            {options.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => {
                  setOpen(false);
                  onChange(o.key);
                }}
                className="px-3 py-2 border-b border-neutral-50"
                style={{ backgroundColor: o.label === value ? '#0F1F33' : undefined }}
              >
                <Text className={`text-sm ${o.label === value ? 'text-white font-semibold' : 'text-neutral-700'}`}>{o.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

interface Mom {
  id: string;
  projectId: string;
  number: string;
  title: string;
  date: string;
  time: string;
  venue: string;
  attendeeIds: string[];
  agendaItems: AgendaItem[];
  agenda: string; // free-text "other agenda points"
  discussion: string;
  actions: ActionItem[];
  nextMeeting: string;
  comments: { by: string; text: string; at: string }[];
  status: 'draft' | 'sent';
  savedAt: string;
}

// Module-level so MoMs survive leaving and re-entering the screen (still
// session-only).
const STORE: Mom[] = [];
const seeded = new Set<string>();

// One sample MoM per project for the demo, by explicit request — task names
// are ROAST @ Kokapet's real Civil Works tasks.
function seedFor(projectId: string) {
  if (seeded.has(projectId)) return;
  seeded.add(projectId);
  const pcc = 'PCC works @ -6\'-0" & -2\'-0" levels';
  const mivan = 'Mivan columns casting @ -7\'-6" level';
  const slab = '+3\'-6" level Slab casting';
  STORE.push({
    id: `seed-${projectId}`,
    projectId,
    number: 'MoM-001',
    title: 'Civil Works Coordination Meeting',
    date: '23 Sep 2026',
    time: '11:00 AM',
    venue: 'Site',
    attendeeIds: ['p1', 'p3', 'p4', 'p6', 'p8'],
    agendaItems: [
      { workId: null, workName: 'Civil Works', taskId: null, taskName: pcc, subtask: 'soil levelling' },
      { workId: null, workName: 'Formwork (Mivan)', taskId: null, taskName: mivan, subtask: '' },
      { workId: null, workName: 'Structural', taskId: null, taskName: slab, subtask: '' },
    ],
    agenda: 'Material delivery schedule for next week.',
    discussion:
      'Soil levelling for PCC at -6\'-0" is complete; PCC to start once the site engineer confirms levels. Mivan shuttering for -7\'-6" columns arrives on 26 Sep. Structural consultant to re-check slab reinforcement before the +3\'-6" casting.',
    actions: [
      { department: 'Civil Works', taskName: pcc, task: 'Start PCC at -6\'-0" level after level check', ownerId: 'p6', due: '26 Sep 2026', comments: 'Levels checked by site engineer on 24 Sep' },
      { department: 'Formwork (Mivan)', taskName: mivan, task: 'Receive and inspect Mivan shuttering', ownerId: 'p3', due: '27 Sep 2026', comments: 'Vendor confirmed dispatch' },
      { department: 'Structural', taskName: slab, task: 'Approve slab reinforcement before casting', ownerId: 'p8', due: '30 Sep 2026', comments: 'Casting only after written approval' },
    ],
    nextMeeting: '30 Sep 2026',
    comments: [
      { by: 'Ar. Kavya Sharma', text: 'Revised kitchen niche detail will be shared before the next meeting.', at: '23 Sep, 04:10 PM' },
      { by: 'Suresh Reddy', text: 'Noted. PCC team is ready to start on 26 Sep.', at: '24 Sep, 09:25 AM' },
    ],
    status: 'sent',
    savedAt: '23 Sep 2026',
  });
}

function todayLabel(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
}

const emptyDraft = (projectId: string): Mom => ({
  id: '',
  projectId,
  number: '',
  title: '',
  date: todayLabel(),
  time: '',
  venue: 'Site',
  attendeeIds: [],
  agendaItems: [emptyAgendaItem()],
  agenda: '',
  discussion: '',
  actions: [emptyAction()],
  nextMeeting: '',
  comments: [],
  status: 'draft',
  savedAt: '',
});


function Label({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text className="text-xs font-bold text-neutral-600 mb-1">
      {text}
      {required && <Text style={{ color: '#DC2626' }}> *</Text>}
    </Text>
  );
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor="#9CA3AF"
      {...props}
      className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white"
      style={[props.multiline ? { minHeight: 90, textAlignVertical: 'top' } : null, props.style]}
    />
  );
}

function StatusPill({ status }: { status: Mom['status'] }) {
  const sent = status === 'sent';
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: sent ? '#DCFCE7' : '#FEF3C7' }}>
      <Text className="text-2xs font-bold" style={{ color: sent ? '#15803D' : '#92400E' }}>
        {sent ? 'Sent' : 'Draft'}
      </Text>
    </View>
  );
}

export default function MomScreen() {
  const { projects, selectedProjectId, setSelectedProjectId } = useProject();
  const bottomPadding = useSafeBottomOffset(24);
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const [mode, setMode] = useState<'list' | 'form' | 'view'>('list');
  const [draft, setDraft] = useState<Mom | null>(null);
  const [viewing, setViewing] = useState<Mom | null>(null);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Real project data for the agenda pickers, cached per id.
  const [works, setWorks] = useState<WorkOption[] | null>(null);
  const [tasksByWork, setTasksByWork] = useState<Record<string, TaskOption[] | 'loading'>>({});
  const [subtasksByTask, setSubtasksByTask] = useState<Record<string, string[] | 'loading'>>({});

  useEffect(() => {
    if (mode !== 'form' || !selectedProjectId) return;
    let cancelled = false;
    fetchWorksForProject(selectedProjectId)
      .then((w) => !cancelled && setWorks(w))
      .catch(() => !cancelled && setWorks([]));
    return () => {
      cancelled = true;
    };
  }, [mode, selectedProjectId]);

  function loadTasks(workId: string) {
    if (tasksByWork[workId]) return;
    setTasksByWork((prev) => ({ ...prev, [workId]: 'loading' }));
    fetchTasksForWork(workId)
      .then((t) => setTasksByWork((prev) => ({ ...prev, [workId]: t })))
      .catch(() => setTasksByWork((prev) => ({ ...prev, [workId]: [] })));
  }

  function loadSubtasks(taskId: string) {
    if (subtasksByTask[taskId]) return;
    setSubtasksByTask((prev) => ({ ...prev, [taskId]: 'loading' }));
    fetchSubtasksForTask(taskId)
      .then((list) => {
        const names = Array.from(new Set(list.map((x) => x.text.trim()).filter(Boolean)));
        setSubtasksByTask((prev) => ({ ...prev, [taskId]: names }));
      })
      .catch(() => setSubtasksByTask((prev) => ({ ...prev, [taskId]: [] })));
  }
  const [banner, setBanner] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');

  const projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? 'Project';

  // Project-specific: pick a project first when none is selected.
  if (!selectedProjectId) {
    return (
      <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}>
        <Text className="text-lg font-bold text-neutral-900">Select a Project</Text>
        <Text className="text-xs text-neutral-500 mt-0.5 mb-4">Minutes of Meeting are kept per project.</Text>
        {projects.map((p) => (
          <Pressable key={p.id} onPress={() => setSelectedProjectId(p.id)}>
            <Card className="mb-2.5 flex-row items-center gap-3">
              <Ionicons name="business" size={20} color="#0F1F33" />
              <Text className="text-sm font-bold text-neutral-900 flex-1">{p.name}</Text>
              <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  seedFor(selectedProjectId);
  const moms = STORE.filter((m) => m.projectId === selectedProjectId).sort((a, b) => b.number.localeCompare(a.number));

  function startCreate() {
    setDraft(emptyDraft(selectedProjectId!));
    setError(null);
    setPeopleSearch('');
    setMode('form');
  }

  function update(patch: Partial<Mom>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function toggleAttendee(id: string) {
    if (!draft) return;
    const has = draft.attendeeIds.includes(id);
    update({
      attendeeIds: has ? draft.attendeeIds.filter((x) => x !== id) : [...draft.attendeeIds, id],
      // Drop an action item's owner if they're no longer an attendee.
      actions: has ? draft.actions.map((a) => (a.ownerId === id ? { ...a, ownerId: null } : a)) : draft.actions,
    });
  }

  function updateAction(i: number, patch: Partial<ActionItem>) {
    if (!draft) return;
    update({ actions: draft.actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) });
  }

  function save(status: Mom['status']) {
    if (!draft) return;
    if (status === 'sent') {
      const missing: string[] = [];
      if (!draft.title.trim()) missing.push('Meeting Title');
      if (draft.attendeeIds.length === 0) missing.push('Attendees');
      if (!draft.discussion.trim()) missing.push('Discussion / Minutes');
      if (missing.length > 0) {
        setError(`Please fill: ${missing.join(', ')}`);
        return;
      }
    } else if (!draft.title.trim()) {
      setError('Add a Meeting Title to save the draft.');
      return;
    }
    const cleaned: Mom = {
      ...draft,
      actions: draft.actions.filter((a) => a.task.trim()),
      agendaItems: draft.agendaItems.filter((a) => a.workId),
      status,
      savedAt: todayLabel(),
    };
    if (!cleaned.id) {
      const count = STORE.filter((m) => m.projectId === draft.projectId).length + 1;
      cleaned.id = `mom-${Date.now()}`;
      cleaned.number = `MoM-${String(count).padStart(3, '0')}`;
      STORE.push(cleaned);
    } else {
      const idx = STORE.findIndex((m) => m.id === cleaned.id);
      if (idx >= 0) STORE[idx] = cleaned;
    }
    setBanner(status === 'sent' ? `${cleaned.number} sent to ${cleaned.attendeeIds.length} attendee${cleaned.attendeeIds.length === 1 ? '' : 's'}` : `${cleaned.number} saved as draft`);
    setTimeout(() => setBanner(null), 3000);
    setDraft(null);
    setMode('list');
    refresh();
  }

  // ---------- View a MoM ----------
  if (mode === 'view' && viewing) {
    const m = viewing;
    return (
      <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}>
        <Pressable onPress={() => setMode('list')} className="flex-row items-center gap-1 mb-3 self-start">
          <Ionicons name="arrow-back" size={16} color="#0F1F33" />
          <Text className="text-sm font-bold text-brand-navy">All MoMs</Text>
        </Pressable>
        <Card>
          <View className="border-b-2 pb-2 mb-3" style={{ borderColor: '#0F1F33' }}>
            <View className="flex-row items-center justify-between">
              <Text className="text-2xs font-bold tracking-widest text-brand-navy">MINUTES OF MEETING</Text>
              <StatusPill status={m.status} />
            </View>
            <Text className="text-base font-bold text-neutral-900 mt-1">{m.title}</Text>
            <Text className="text-2xs text-neutral-500">
              {m.number} · {projectName}
            </Text>
          </View>
          {[
            ['Date', m.date],
            ['Time', m.time || '—'],
            ['Venue', m.venue],
          ].map(([k, v]) => (
            <View key={k} className="flex-row mb-1">
              <Text className="text-xs font-bold text-neutral-600" style={{ width: 70 }}>{k}</Text>
              <Text className="text-xs text-neutral-900 flex-1">{v}</Text>
            </View>
          ))}

          <Text className="text-xs font-bold text-neutral-800 mt-3 mb-1">Attendees ({m.attendeeIds.length})</Text>
          {m.attendeeIds.map((id) => {
            const p = PEOPLE.find((x) => x.id === id);
            return (
              <Text key={id} className="text-xs text-neutral-700">
                • {p?.name} <Text className="text-neutral-400">— {p?.role}</Text>
              </Text>
            );
          })}

          {(m.agendaItems.length > 0 || !!m.agenda) && (
            <>
              <Text className="text-xs font-bold text-neutral-800 mt-3 mb-1">Agenda</Text>
              {m.agendaItems.map((a, i) => (
                <View key={i} className="flex-row gap-1.5 mb-1">
                  <Text className="text-xs text-neutral-700">{i + 1}.</Text>
                  <View className="flex-1">
                    <View className="flex-row flex-wrap items-center gap-1.5">
                      <Text className="text-xs font-semibold text-neutral-900">{a.taskName || a.workName}</Text>
                      {!!a.workName && (
                        <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#EEF2FF' }}>
                          <Text className="text-2xs font-semibold" style={{ color: '#4338CA' }}>{a.workName}</Text>
                        </View>
                      )}
                    </View>
                    {!!a.subtask && <Text className="text-2xs text-neutral-500 mt-0.5">Subtask: {a.subtask}</Text>}
                  </View>
                </View>
              ))}
              {!!m.agenda && <Text className="text-xs text-neutral-700 leading-5 mt-1">{m.agenda}</Text>}
            </>
          )}

          <Text className="text-xs font-bold text-neutral-800 mt-3 mb-1">Discussion / Minutes</Text>
          <Text className="text-xs text-neutral-700 leading-5">{m.discussion || '—'}</Text>

          {m.actions.length > 0 && (
            <>
              <Text className="text-xs font-bold text-neutral-800 mt-3 mb-1">Action Items</Text>
              <View className="rounded-lg border border-neutral-200 overflow-hidden">
                <View className="flex-row px-2 py-1.5" style={{ backgroundColor: '#F1F5F9' }}>
                  <Text className="text-2xs font-bold text-neutral-700" style={{ flex: 1.3 }}>Department</Text>
                  <Text className="text-2xs font-bold text-neutral-700" style={{ flex: 1.8 }}>Task</Text>
                  <Text className="text-2xs font-bold text-neutral-700" style={{ flex: 2 }}>Action</Text>
                  <Text className="text-2xs font-bold text-neutral-700" style={{ flex: 1.3 }}>Owner</Text>
                  <Text className="text-2xs font-bold text-neutral-700 text-right" style={{ flex: 1.1 }}>Due</Text>
                </View>
                {m.actions.map((a, i) => (
                  <View key={i} className="px-2 py-1.5 border-t border-neutral-100">
                    <View className="flex-row gap-1">
                      <View style={{ flex: 1.3 }}>
                        {a.department ? (
                          <View className="self-start px-1.5 py-0.5 rounded" style={{ backgroundColor: '#EEF2FF' }}>
                            <Text className="text-2xs font-semibold" style={{ color: '#4338CA' }}>{a.department}</Text>
                          </View>
                        ) : (
                          <Text className="text-2xs text-neutral-400">—</Text>
                        )}
                      </View>
                      <Text className="text-2xs font-semibold text-brand-navy" style={{ flex: 1.8 }}>{a.taskName || '—'}</Text>
                      <Text className="text-2xs text-neutral-800" style={{ flex: 2 }}>{a.task}</Text>
                      <Text className="text-2xs text-neutral-700" style={{ flex: 1.3 }}>{personName(a.ownerId)}</Text>
                      <Text className="text-2xs text-neutral-700 text-right" style={{ flex: 1.1 }}>{a.due || '—'}</Text>
                    </View>
                    {!!a.comments && (
                      <View className="flex-row items-start gap-1 mt-1 px-1.5 py-1 rounded" style={{ backgroundColor: '#F8FAFC' }}>
                        <Ionicons name="chatbubble-ellipses-outline" size={11} color="#6B7280" style={{ marginTop: 1 }} />
                        <Text className="text-2xs text-neutral-600 flex-1 italic">{a.comments}</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </>
          )}

          {!!m.nextMeeting && (
            <Text className="text-xs text-neutral-700 mt-3">
              Next meeting: <Text className="font-bold">{m.nextMeeting}</Text>
            </Text>
          )}
          <Text className="text-2xs text-neutral-400 mt-3">
            {m.status === 'sent' ? `Sent on ${m.savedAt} to all attendees` : `Draft — last saved ${m.savedAt}`}
          </Text>
        </Card>
        {/* Comments on this MoM */}
        <Card className="mt-3">
          <Text className="text-xs font-bold text-neutral-800 mb-2">Comments ({m.comments.length})</Text>
          {m.comments.map((c, i) => (
            <View key={i} className="mb-2.5 flex-row gap-2">
              <View className="h-7 w-7 items-center justify-center rounded-full bg-brand-amber">
                <Text className="text-2xs font-bold text-brand-navy">{c.by.replace(/^(Ar\.|Dr\.)\s*/, '').charAt(0)}</Text>
              </View>
              <View className="flex-1 rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#F8FAFC' }}>
                <Text className="text-2xs font-bold text-neutral-800">
                  {c.by} <Text className="font-normal text-neutral-400">· {c.at}</Text>
                </Text>
                <Text className="text-xs text-neutral-700 mt-0.5">{c.text}</Text>
              </View>
            </View>
          ))}
          <View className="flex-row items-end gap-2 mt-1">
            <TextInput
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Add a comment…"
              placeholderTextColor="#9CA3AF"
              multiline
              className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white"
            />
            <Pressable
              onPress={() => {
                const text = commentText.trim();
                if (!text) return;
                const d = new Date();
                const at = `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
                m.comments = [...m.comments, { by: 'You', text, at }];
                setCommentText('');
                refresh();
              }}
              className="h-10 w-10 items-center justify-center rounded-lg bg-brand-navy"
              style={{ opacity: commentText.trim() ? 1 : 0.5 }}
            >
              <Ionicons name="send" size={16} color="#fff" />
            </Pressable>
          </View>
        </Card>

        {m.status === 'draft' && (
          <Pressable
            onPress={() => {
              setDraft({
                ...m,
                agendaItems: m.agendaItems.length ? m.agendaItems : [emptyAgendaItem()],
                actions: m.actions.length ? m.actions : [emptyAction()],
              });
              setError(null);
              setMode('form');
            }}
            className="mt-3 flex-row items-center justify-center gap-2 py-3 rounded-xl bg-brand-navy"
          >
            <Ionicons name="create-outline" size={16} color="#fff" />
            <Text className="text-sm font-bold text-white">Edit Draft</Text>
          </Pressable>
        )}
      </ScrollView>
    );
  }

  // ---------- Create / edit form ----------
  if (mode === 'form' && draft) {
    const q = peopleSearch.trim().toLowerCase();
    const visiblePeople = q ? PEOPLE.filter((p) => p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q)) : PEOPLE;
    const attendees = PEOPLE.filter((p) => draft.attendeeIds.includes(p.id));
    const agendaTaskNames = Array.from(new Set(draft.agendaItems.map((x) => x.taskName).filter(Boolean)));
    return (
      <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => setMode('list')} className="flex-row items-center gap-1 mb-3 self-start">
          <Ionicons name="arrow-back" size={16} color="#0F1F33" />
          <Text className="text-sm font-bold text-brand-navy">Cancel</Text>
        </Pressable>
        <Text className="text-lg font-bold text-neutral-900">{draft.id ? `Edit ${draft.number}` : 'Create MoM'}</Text>
        <Text className="text-xs text-neutral-500 mb-3">{projectName}</Text>

        {/* 1. Meeting details */}
        <Card className="mb-3">
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">1 · Meeting Details</Text>
          <Label text="Meeting Title" required />
          <Field value={draft.title} onChangeText={(t) => update({ title: t })} placeholder="e.g. Weekly Site Progress Review" />
          <View className="flex-row gap-2 mt-2.5">
            <View className="flex-1">
              <Label text="Date" />
              <Field value={draft.date} onChangeText={(t) => update({ date: t })} placeholder="25 Sep 2026" />
            </View>
            <View className="flex-1">
              <Label text="Time" />
              <Field value={draft.time} onChangeText={(t) => update({ time: t })} placeholder="11:00 AM" />
            </View>
          </View>
          <View className="mt-2.5">
            <Label text="Venue" />
            <View className="flex-row gap-2">
              {VENUES.map((v) => {
                const active = draft.venue === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => update({ venue: v })}
                    className={`px-3.5 py-1.5 rounded-full border ${active ? 'bg-brand-navy border-brand-navy' : 'bg-white border-neutral-200'}`}
                  >
                    <Text className={`text-xs font-semibold ${active ? 'text-white' : 'text-neutral-700'}`}>{v}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Card>

        {/* 2. Attendees */}
        <Card className="mb-3">
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">
            2 · People in the Meeting <Text style={{ color: '#DC2626' }}>*</Text>
          </Text>
          <View className="flex-row items-center gap-2 border border-neutral-200 rounded-lg px-2.5 mb-2 bg-white">
            <Ionicons name="search" size={14} color="#9CA3AF" />
            <TextInput
              value={peopleSearch}
              onChangeText={setPeopleSearch}
              placeholder="Search people"
              placeholderTextColor="#9CA3AF"
              className="flex-1 py-2 text-sm text-neutral-900"
            />
          </View>
          {visiblePeople.map((p) => {
            const selected = draft.attendeeIds.includes(p.id);
            return (
              <Pressable
                key={p.id}
                onPress={() => toggleAttendee(p.id)}
                className="flex-row items-center gap-3 py-2 border-b border-neutral-50"
              >
                <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={20} color={selected ? '#0F1F33' : '#9CA3AF'} />
                <View className="h-8 w-8 items-center justify-center rounded-full bg-brand-amber">
                  <Text className="text-xs font-bold text-brand-navy">{p.name.replace(/^(Ar\.|Dr\.)\s*/, '').charAt(0)}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-neutral-900">{p.name}</Text>
                  <Text className="text-2xs text-neutral-500">{p.role}</Text>
                </View>
              </Pressable>
            );
          })}
          <Text className="text-2xs font-bold text-brand-navy mt-2">{draft.attendeeIds.length} selected</Text>
        </Card>

        {/* 3. Minutes */}
        <Card className="mb-3">
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">3 · Minutes</Text>
          <Label text="Agenda" />
          <Text className="text-2xs text-neutral-500 mb-1">Pick the department, task and subtask discussed.</Text>
          {draft.agendaItems.map((a, i) => {
            const setItem = (patch: Partial<AgendaItem>) =>
              update({ agendaItems: draft.agendaItems.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) });
            const taskState = a.workId ? tasksByWork[a.workId] : undefined;
            const subState = a.taskId ? subtasksByTask[a.taskId] : undefined;
            return (
              <View key={i} className="mb-2.5 p-2.5 rounded-xl border border-neutral-200" style={{ backgroundColor: '#F8FAFC' }}>
                <View className="flex-row items-center justify-between">
                  <Text className="text-2xs font-bold text-neutral-500">AGENDA {i + 1}</Text>
                  {draft.agendaItems.length > 1 && (
                    <Pressable onPress={() => update({ agendaItems: draft.agendaItems.filter((_, idx) => idx !== i) })} hitSlop={8}>
                      <Ionicons name="trash-outline" size={16} color="#DC2626" />
                    </Pressable>
                  )}
                </View>
                <SelectBox
                  placeholder="Select department"
                  value={a.workName}
                  loading={works == null}
                  options={(works ?? []).map((w) => ({ key: w.id, label: w.name }))}
                  emptyText="No departments in this project"
                  onChange={(id) => {
                    const w = works?.find((x) => x.id === id);
                    setItem({ workId: id, workName: w?.name ?? '', taskId: null, taskName: '', subtask: '' });
                    loadTasks(id);
                  }}
                />
                <SelectBox
                  placeholder="Select task"
                  value={a.taskName}
                  disabled={!a.workId}
                  loading={taskState === 'loading'}
                  options={Array.isArray(taskState) ? taskState.map((t) => ({ key: t.id, label: t.name })) : []}
                  emptyText="No tasks under this department"
                  onChange={(id) => {
                    const t = Array.isArray(taskState) ? taskState.find((x) => x.id === id) : undefined;
                    setItem({ taskId: id, taskName: t?.name ?? '', subtask: '' });
                    loadSubtasks(id);
                  }}
                />
                <SelectBox
                  placeholder="Select subtask (optional)"
                  value={a.subtask}
                  disabled={!a.taskId}
                  loading={subState === 'loading'}
                  options={Array.isArray(subState) ? subState.map((n) => ({ key: n, label: n })) : []}
                  emptyText="No subtasks logged for this task yet"
                  onChange={(name) => setItem({ subtask: name })}
                />
              </View>
            );
          })}
          <Pressable onPress={() => update({ agendaItems: [...draft.agendaItems, emptyAgendaItem()] })} className="flex-row items-center gap-1.5 self-start mb-1">
            <Ionicons name="add-circle-outline" size={18} color="#0F1F33" />
            <Text className="text-sm font-bold text-brand-navy">Add Agenda Item</Text>
          </Pressable>
          <View className="mt-2">
            <Label text="Other agenda points" />
            <Field value={draft.agenda} onChangeText={(t) => update({ agenda: t })} placeholder="Anything else discussed (optional)" multiline style={{ minHeight: 60 }} />
          </View>
          <View className="mt-2.5">
            <Label text="Discussion / Minutes" required />
            <Field
              value={draft.discussion}
              onChangeText={(t) => update({ discussion: t })}
              placeholder="Type what was discussed and decided in the meeting…"
              multiline
              style={{ minHeight: 140 }}
            />
          </View>
        </Card>

        {/* 4. Action items */}
        <Card className="mb-3">
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">4 · Action Items</Text>
          {draft.actions.map((a, i) => (
            <View key={i} className="mb-3 pb-3 border-b border-neutral-100">
              <Text className="text-2xs font-bold text-neutral-500 mb-1">
                Task{a.department ? <Text className="font-normal text-neutral-400"> · {a.department}</Text> : null}
              </Text>
              {agendaTaskNames.length === 0 ? (
                <Text className="text-2xs text-neutral-400 mb-2">Pick tasks in the Agenda above to link them here</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ marginBottom: 8 }}>
                  {agendaTaskNames.map((name) => {
                    const active = a.taskName === name;
                    return (
                      <Pressable
                        key={name}
                        onPress={() =>
                          updateAction(i, {
                            taskName: active ? '' : name,
                            department: active ? '' : draft.agendaItems.find((x) => x.taskName === name)?.workName ?? '',
                          })
                        }
                        className={`px-2.5 py-1 rounded-full border ${active ? 'bg-brand-navy border-brand-navy' : 'bg-white border-neutral-200'}`}
                      >
                        <Text className={`text-2xs font-semibold ${active ? 'text-white' : 'text-neutral-700'}`} numberOfLines={1}>
                          {name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Field value={a.task} onChangeText={(t) => updateAction(i, { task: t })} placeholder={`Action ${i + 1}`} />
                </View>
                {draft.actions.length > 1 && (
                  <Pressable onPress={() => update({ actions: draft.actions.filter((_, idx) => idx !== i) })} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </Pressable>
                )}
              </View>
              <Text className="text-2xs font-bold text-neutral-500 mt-2 mb-1">Owner</Text>
              {attendees.length === 0 ? (
                <Text className="text-2xs text-neutral-400">Select people in the meeting first</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {attendees.map((p) => {
                    const active = a.ownerId === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => updateAction(i, { ownerId: active ? null : p.id })}
                        className={`px-2.5 py-1 rounded-full border ${active ? 'bg-brand-navy border-brand-navy' : 'bg-white border-neutral-200'}`}
                      >
                        <Text className={`text-2xs font-semibold ${active ? 'text-white' : 'text-neutral-700'}`}>{p.name}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              <View className="mt-2" style={{ width: 150 }}>
                <Field value={a.due} onChangeText={(t) => updateAction(i, { due: t })} placeholder="Due date" />
              </View>
              <View className="mt-2">
                <Field value={a.comments} onChangeText={(t) => updateAction(i, { comments: t })} placeholder="Comments (optional)" multiline style={{ minHeight: 50 }} />
              </View>
            </View>
          ))}
          <Pressable onPress={() => update({ actions: [...draft.actions, emptyAction()] })} className="flex-row items-center gap-1.5 self-start">
            <Ionicons name="add-circle-outline" size={18} color="#0F1F33" />
            <Text className="text-sm font-bold text-brand-navy">Add Action Item</Text>
          </Pressable>
          <View className="mt-3" style={{ width: 170 }}>
            <Label text="Next Meeting" />
            <Field value={draft.nextMeeting} onChangeText={(t) => update({ nextMeeting: t })} placeholder="e.g. 02 Oct 2026" />
          </View>
        </Card>

        {error && (
          <View className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <Text className="text-xs text-red-600">{error}</Text>
          </View>
        )}

        <View className="flex-row gap-2">
          <Pressable onPress={() => save('draft')} className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl bg-white border border-neutral-300">
            <Ionicons name="save-outline" size={16} color="#0F1F33" />
            <Text className="text-sm font-bold text-brand-navy">Save Draft</Text>
          </Pressable>
          <Pressable onPress={() => save('sent')} className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl bg-brand-navy">
            <Ionicons name="send" size={16} color="#fff" />
            <Text className="text-sm font-bold text-white">Send MoM</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // ---------- List ----------
  return (
    <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-lg font-bold text-neutral-900">Minutes of Meeting</Text>
        <Pressable onPress={startCreate} className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-navy">
          <Ionicons name="add" size={16} color="#fff" />
          <Text className="text-xs font-bold text-white">Create MoM</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => setSelectedProjectId(null)} className="flex-row items-center gap-1 mb-3 self-start">
        <Ionicons name="business-outline" size={12} color="#6B7280" />
        <Text className="text-xs text-neutral-500">{projectName}</Text>
        <Text className="text-xs font-bold text-brand-navy"> · Change</Text>
      </Pressable>

      {banner && (
        <View className="flex-row items-center gap-2 mb-3 px-3 py-2.5 rounded-xl" style={{ backgroundColor: '#DCFCE7' }}>
          <Ionicons name="checkmark-circle" size={16} color="#15803D" />
          <Text className="text-xs font-bold flex-1" style={{ color: '#15803D' }}>{banner}</Text>
        </View>
      )}

      {moms.map((m) => (
        <Pressable
          key={m.id}
          onPress={() => {
            setViewing(m);
            setMode('view');
          }}
        >
          <Card className="mb-2.5">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-2xs font-bold text-neutral-400">{m.number}</Text>
              <StatusPill status={m.status} />
            </View>
            <Text className="text-sm font-bold text-neutral-900">{m.title}</Text>
            <Text className="text-2xs text-neutral-500 mt-0.5">
              {m.date}
              {m.time ? ` · ${m.time}` : ''} · {m.venue} · {m.attendeeIds.length} attendee{m.attendeeIds.length === 1 ? '' : 's'}
            </Text>
            {m.actions.length > 0 && (
              <Text className="text-2xs font-semibold text-brand-navy mt-1">
                {m.actions.length} action item{m.actions.length === 1 ? '' : 's'}
              </Text>
            )}
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
