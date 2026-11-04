// MoM → Custom Alerts tab.
//  • Department alert: pick a department, write a message, and it goes out
//    as a LIVE in-app notification (the existing critical-alert pipeline —
//    same popup + push the engineers already get) to the engineers working
//    in that department.
//  • Task lists: send the Pending and/or Upcoming task list to the client
//    and architect — manually, by WhatsApp / email or as a PDF.

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { fetchDepartments, type Department } from '../../lib/departments';
import { sendCriticalAlertMessage, type ProjectEngineer } from '../../lib/criticalAlertMessages';
import { sharePrintout, previewPrintout } from '../../lib/reports/projectPrintouts';
import { fetchDepartmentEngineers, fetchProjectTasks, pendingTasks, upcomingTasks, type ProjectTask } from '../../lib/mom/taskData';
import { pendingUpcomingHtml, taskListText } from '../../lib/mom/reportHtml';
import type { MomProjectData, Recipient } from '../../lib/mom/types';
import { logError } from '../../lib/sentryLog';
import { addHistory } from './ReportsTab';
import { RecipientPicker } from './RecipientPicker';
import { SendPanel } from './SendPanel';
import { Banner, Button, Chip, Field, NAVY, Row, SectionTitle } from './ui';

type Update = (fn: (d: MomProjectData) => MomProjectData) => Promise<void>;

export function CustomAlertsTab({
  projectId,
  projectName,
  update,
  me,
}: {
  projectId: string;
  projectName: string;
  update: Update;
  me: { id: string; name: string };
}) {
  const [section, setSection] = useState<'alert' | 'tasks'>('alert');
  const [tasks, setTasks] = useState<ProjectTask[] | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTasks(null);
    fetchProjectTasks(projectId)
      .then((t) => !cancelled && setTasks(t))
      .catch((e) => !cancelled && setTaskError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <View>
      <View className="flex-row gap-2 mb-3">
        <Chip label="Department alert" active={section === 'alert'} onPress={() => setSection('alert')} />
        <Chip label="Pending / upcoming tasks" active={section === 'tasks'} onPress={() => setSection('tasks')} />
      </View>
      {taskError && <Banner tone="error">Could not load project tasks: {taskError}</Banner>}
      {section === 'alert' ? (
        <DepartmentAlert projectId={projectId} tasks={tasks} update={update} me={me} />
      ) : (
        <TaskListSender projectId={projectId} projectName={projectName} tasks={tasks} update={update} />
      )}
    </View>
  );
}

function DepartmentAlert({ projectId, tasks, update, me }: { projectId: string; tasks: ProjectTask[] | null; update: Update; me: { id: string; name: string } }) {
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [dept, setDept] = useState<Department | null>(null);
  const [engineers, setEngineers] = useState<{ inDepartment: ProjectEngineer[]; all: ProjectEngineer[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDepartments(projectId)
      .then((d) => !cancelled && setDepartments(d))
      .catch((e) => !cancelled && setResult({ tone: 'error', text: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!dept || !tasks) return;
    let cancelled = false;
    setEngineers(null);
    fetchDepartmentEngineers(projectId, dept.id, tasks)
      .then((e) => {
        if (cancelled) return;
        setEngineers(e);
        const initial = e.inDepartment.length ? e.inDepartment : e.all;
        setSelected(new Set(initial.map((x) => x.id)));
        setShowAll(e.inDepartment.length === 0);
      })
      .catch((err) => !cancelled && setResult({ tone: 'error', text: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [dept, tasks, projectId]);

  const list = engineers ? (showAll ? engineers.all : engineers.inDepartment) : [];

  async function send() {
    if (!dept || selected.size === 0 || !message.trim()) return;
    setSending(true);
    setResult(null);
    const text = `[${dept.name}] ${message.trim()}`;
    const targets = (engineers?.all ?? []).filter((e) => selected.has(e.id));
    const results = await Promise.allSettled(targets.map((e) => sendCriticalAlertMessage(projectId, e.id, text, me.id)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) {
      logError((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason, 'mom_department_alert');
    }
    const ok = targets.length - failed;
    if (ok > 0) {
      await addHistory(update, {
        projectId,
        kind: 'alert',
        title: `${dept.name}: ${message.trim().slice(0, 60)}`,
        channel: 'notification',
        recipientNames: targets.filter((_, i) => results[i].status === 'fulfilled').map((e) => e.fullName),
      });
      setMessage('');
    }
    setResult(
      failed
        ? { tone: 'error', text: `Sent to ${ok}, failed for ${failed}. Check the connection and try again.` }
        : { tone: 'ok', text: `Live alert sent to ${ok} ${ok === 1 ? 'engineer' : 'engineers'} in ${dept.name}.` }
    );
    setSending(false);
  }

  return (
    <View>
      {result && <Banner tone={result.tone} onClose={() => setResult(null)}>{result.text}</Banner>}
      <Card className="mb-3">
        <SectionTitle>1. Department</SectionTitle>
        {!departments ? (
          <ActivityIndicator color={NAVY} />
        ) : departments.length === 0 ? (
          <Text className="text-xs text-neutral-400">This project has no departments yet.</Text>
        ) : (
          <Row gap={6}>
            {departments.map((d) => (
              <Chip key={d.id} label={d.name} active={dept?.id === d.id} color={d.color} onPress={() => setDept(d)} />
            ))}
          </Row>
        )}
      </Card>

      {dept && (
        <Card className="mb-3">
          <SectionTitle>2. Who gets it</SectionTitle>
          {!engineers ? (
            <ActivityIndicator color={NAVY} />
          ) : (
            <>
              {engineers.inDepartment.length === 0 && (
                <Text className="text-2xs text-amber-700 mb-2">No engineer has tasks in {dept.name} yet — showing everyone on this project.</Text>
              )}
              {list.map((e) => {
                const on = selected.has(e.id);
                return (
                  <Pressable
                    key={e.id}
                    onPress={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (on) next.delete(e.id);
                        else next.add(e.id);
                        return next;
                      })
                    }
                    className="flex-row items-center gap-2 py-2 border-t border-neutral-100"
                  >
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={18} color={on ? NAVY : '#9CA3AF'} />
                    <Text className="text-sm text-neutral-900">{e.fullName}</Text>
                  </Pressable>
                );
              })}
              {engineers.inDepartment.length > 0 && engineers.all.length > engineers.inDepartment.length && (
                <Pressable onPress={() => setShowAll((v) => !v)} className="mt-2">
                  <Text className="text-2xs font-bold" style={{ color: NAVY }}>
                    {showAll ? `Only ${dept.name} engineers` : 'Show all project engineers'}
                  </Text>
                </Pressable>
              )}
              {list.length === 0 && <Text className="text-xs text-neutral-400">No engineers are assigned to this project.</Text>}
            </>
          )}
        </Card>
      )}

      {dept && (
        <Card className="mb-3 gap-3">
          <SectionTitle>3. Message</SectionTitle>
          <Field value={message} onChangeText={setMessage} multiline placeholder={`Alert for ${dept.name}…`} />
          <Button
            label={`Send live alert to ${selected.size}`}
            icon="notifications-outline"
            variant="danger"
            busy={sending}
            disabled={selected.size === 0 || !message.trim()}
            onPress={send}
          />
          <Text className="text-2xs text-neutral-500">Shows as a live alert popup with sound on their phones, same as Critical Alerts.</Text>
        </Card>
      )}
    </View>
  );
}

function TaskListSender({ projectId, projectName, tasks, update }: { projectId: string; projectName: string; tasks: ProjectTask[] | null; update: Update }) {
  const [include, setInclude] = useState({ pending: true, upcoming: true });
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => (tasks ? { pending: pendingTasks(tasks).length, upcoming: upcomingTasks(tasks).length } : null), [tasks]);
  const nothing = !include.pending && !include.upcoming;
  const label = include.pending && include.upcoming ? 'Pending & Upcoming Tasks' : include.pending ? 'Pending Tasks' : 'Upcoming Tasks';

  async function pdf(kind: 'preview' | 'share') {
    if (!tasks || nothing) return;
    setBusy(kind);
    setError(null);
    try {
      const html = pendingUpcomingHtml(tasks, projectName, include);
      if (kind === 'preview') await previewPrintout(html);
      else {
        await sharePrintout(html, `${label} — ${projectName}`);
        await addHistory(update, { projectId, kind: 'task-list', title: label, channel: 'pdf', recipientNames: recipients.map((r) => r.name) });
      }
    } catch (e) {
      logError(e, 'mom_task_list_pdf');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View>
      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
      <Card className="mb-3 gap-3">
        <SectionTitle>1. Which list</SectionTitle>
        {!counts ? (
          <ActivityIndicator color={NAVY} />
        ) : (
          <Row gap={6}>
            <Chip label={`Pending (${counts.pending})`} active={include.pending} onPress={() => setInclude((x) => ({ ...x, pending: !x.pending }))} />
            <Chip label={`Upcoming 30 days (${counts.upcoming})`} active={include.upcoming} onPress={() => setInclude((x) => ({ ...x, upcoming: !x.upcoming }))} />
          </Row>
        )}
        <Row gap={8}>
          <View style={{ flex: 1 }}>
            <Button label="Preview PDF" icon="eye-outline" variant="secondary" busy={busy === 'preview'} disabled={!tasks || nothing} onPress={() => pdf('preview')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Share PDF" icon="share-outline" busy={busy === 'share'} disabled={!tasks || nothing} onPress={() => pdf('share')} />
          </View>
        </Row>
      </Card>

      <Card className="mb-3">
        <SectionTitle right={<Button small label="Choose" icon="person-add-outline" variant="secondary" onPress={() => setPicker(true)} />}>
          2. Client & architect ({recipients.length})
        </SectionTitle>
        {tasks && recipients.length > 0 && !nothing ? (
          <SendPanel
            recipients={recipients}
            subject={`${label} — ${projectName}`}
            message={taskListText(tasks, projectName, include)}
            onSent={(channel, keys) =>
              addHistory(update, { projectId, kind: 'task-list', title: label, channel, recipientNames: recipients.filter((r) => keys.includes(r.key)).map((r) => r.name) })
            }
          />
        ) : (
          <Text className="text-xs text-neutral-400">Choose the client and architect from Contact Book / Specific Book.</Text>
        )}
      </Card>

      <RecipientPicker
        visible={picker}
        projectId={projectId}
        selected={recipients}
        title="Client & architect"
        onlyCategories={['client', 'architect']}
        onClose={() => setPicker(false)}
        onDone={(list) => {
          setRecipients(list);
          setPicker(false);
        }}
      />
    </View>
  );
}
