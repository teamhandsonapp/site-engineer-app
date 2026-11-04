// MoM → Reports tab.
//  • Automated: set up recurring reports (weekly / monthly) with recipients.
//    App UI only for now — schedules are saved, but nothing sends on its own
//    until a server-side sender (email / WhatsApp API) is connected. "Send
//    now" runs the same report by hand meanwhile.
//  • Send manually: Task Based Report or Project Health Report, picked and
//    sent to clients (PDF via share sheet, or a summary by email/WhatsApp).
//  • History: everything sent from the MoM section, newest first.

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { fetchProjectProgress } from '../../lib/projectProgress';
import { previewPrintout, sharePrintout } from '../../lib/reports/projectPrintouts';
import { newId } from '../../lib/mom/store';
import { pendingUpcomingHtml, projectHealthHtml, taskListText, taskReportHtml } from '../../lib/mom/reportHtml';
import { computeProjectHealth, fetchProjectTasks, todayIST, type ProjectTask } from '../../lib/mom/taskData';
import { formatDateLong, formatTime12 } from '../../lib/mom/share';
import {
  REPORT_TYPE_LABEL,
  type MomProjectData,
  type Recipient,
  type ReportFrequency,
  type ReportHistoryEntry,
  type ReportSchedule,
  type ReportType,
  type SendChannel,
} from '../../lib/mom/types';
import { logError } from '../../lib/sentryLog';
import { RecipientPicker } from './RecipientPicker';
import { SendPanel } from './SendPanel';
import { Banner, Button, Chip, NAVY, Row, SectionTitle, TimeField } from './ui';

type Update = (fn: (d: MomProjectData) => MomProjectData) => Promise<void>;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function addHistory(update: Update, entry: Omit<ReportHistoryEntry, 'id' | 'sentAtISO'>) {
  return update((d) => ({ ...d, history: [{ ...entry, id: newId(), sentAtISO: new Date().toISOString() }, ...d.history].slice(0, 200) }));
}

// Project tasks + SFT progress, loaded once per project for this tab.
function useReportData(projectId: string) {
  const [tasks, setTasks] = useState<ProjectTask[] | null>(null);
  const [sft, setSft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTasks(null);
    setError(null);
    fetchProjectTasks(projectId)
      .then((t) => !cancelled && setTasks(t))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    fetchProjectProgress(projectId)
      .then((p) => !cancelled && setSft(p.percentage))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return { tasks, sft, error };
}

export function buildReportHtml(type: ReportType, tasks: ProjectTask[], projectName: string, sft: number | null, departments: string[] | null): string {
  if (type === 'project_health') return projectHealthHtml(tasks, projectName, sft);
  if (type === 'task_status') return taskReportHtml(tasks, projectName, departments);
  return pendingUpcomingHtml(tasks, projectName, { pending: true, upcoming: true });
}

export function buildReportText(type: ReportType, tasks: ProjectTask[], projectName: string, sft: number | null, departments: string[] | null): string {
  if (type === 'pending_upcoming') return taskListText(tasks, projectName, { pending: true, upcoming: true });
  const h = computeProjectHealth(departments ? tasks.filter((t) => departments.includes(t.workName)) : tasks);
  const lines = [
    `${projectName} — ${REPORT_TYPE_LABEL[type]} (${formatDateLong(todayIST())})`,
    '',
    `Tasks completed: ${h.byStatus.completed} of ${h.total} (${h.completedPercent}%)`,
    ...(type === 'project_health' && sft != null ? [`Built-up area completed: ${sft}%`] : []),
    `In progress: ${h.byStatus.in_progress} · Overdue: ${h.overdue.length} · Starting in 30 days: ${h.upcoming.length}`,
    '',
    '*By department*',
    ...h.byDepartment.map((d) => `• ${d.workName}: ${d.completed}/${d.total} done${d.overdue ? `, ${d.overdue} overdue` : ''}`),
    '',
    'The full PDF report is attached / will follow.',
  ];
  return lines.join('\n');
}

export function ReportsTab({ projectId, projectName, data, update }: { projectId: string; projectName: string; data: MomProjectData; update: Update }) {
  const [section, setSection] = useState<'automated' | 'manual' | 'history'>('automated');
  const report = useReportData(projectId);

  return (
    <View>
      <View className="flex-row gap-2 mb-3">
        <Chip label="Automated" active={section === 'automated'} onPress={() => setSection('automated')} />
        <Chip label="Send manually" active={section === 'manual'} onPress={() => setSection('manual')} />
        <Chip label={`History (${data.history.length})`} active={section === 'history'} onPress={() => setSection('history')} />
      </View>
      {report.error && <Banner tone="error">Could not load project tasks: {report.error}</Banner>}
      {section === 'automated' && <AutomatedSection projectId={projectId} projectName={projectName} data={data} update={update} report={report} />}
      {section === 'manual' && <ManualSection projectId={projectId} projectName={projectName} update={update} report={report} />}
      {section === 'history' && <HistorySection history={data.history} />}
    </View>
  );
}

// ---------------- automated ----------------

function nextRun(s: ReportSchedule, now = new Date()): Date {
  const [h, m] = s.time.split(':').map(Number);
  // Work in IST wall-clock.
  const istNow = new Date(now.getTime() + 5.5 * 3600_000);
  const candidate = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), h, m));
  if (s.frequency === 'weekly') {
    let add = (s.dayOfWeek - candidate.getUTCDay() + 7) % 7;
    if (add === 0 && candidate <= istNow) add = 7;
    candidate.setUTCDate(candidate.getUTCDate() + add);
  } else {
    candidate.setUTCDate(s.dayOfMonth);
    if (candidate <= istNow) candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  }
  return new Date(candidate.getTime() - 5.5 * 3600_000);
}

function AutomatedSection({
  projectId,
  projectName,
  data,
  update,
  report,
}: {
  projectId: string;
  projectName: string;
  data: MomProjectData;
  update: Update;
  report: ReturnType<typeof useReportData>;
}) {
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (editing) {
    return (
      <ScheduleForm
        projectId={projectId}
        initial={editing}
        canDelete={data.schedules.some((x) => x.id === editing.id)}
        onCancel={() => setEditing(null)}
        onSave={async (s) => {
          await update((d) => ({
            ...d,
            schedules: d.schedules.some((x) => x.id === s.id) ? d.schedules.map((x) => (x.id === s.id ? s : x)) : [...d.schedules, s],
          }));
          setEditing(null);
          setMsg('Automated report saved.');
        }}
        onDelete={async () => {
          await update((d) => ({ ...d, schedules: d.schedules.filter((x) => x.id !== editing.id) }));
          setEditing(null);
        }}
      />
    );
  }

  async function sendNow(s: ReportSchedule) {
    if (!report.tasks) return;
    setSending(s.id);
    try {
      await sharePrintout(buildReportHtml(s.reportType, report.tasks, projectName, report.sft, null), `${REPORT_TYPE_LABEL[s.reportType]} — ${projectName}`);
      await addHistory(update, { projectId, kind: 'automated', title: `${REPORT_TYPE_LABEL[s.reportType]} (sent now)`, channel: 'pdf', recipientNames: s.recipients.map((r) => r.name) });
    } catch (e) {
      logError(e, 'mom_report_send_now');
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(null);
    }
  }

  const blank: ReportSchedule = {
    id: newId(),
    projectId,
    reportType: 'project_health',
    frequency: 'monthly',
    dayOfWeek: 1,
    dayOfMonth: 1,
    time: '09:00',
    channel: 'email',
    recipients: [],
    active: true,
    createdAtISO: new Date().toISOString(),
  };

  return (
    <View>
      <Banner tone="info">
        Set up reports to go out on a schedule. For now these are saved in the app only — automatic sending starts once the email / WhatsApp sender is connected. Use &quot;Send now&quot; meanwhile.
      </Banner>
      {msg && <Banner tone="ok" onClose={() => setMsg(null)}>{msg}</Banner>}
      <View className="mb-3">
        <Button label="New automated report" icon="add-circle-outline" onPress={() => setEditing(blank)} />
      </View>
      {data.schedules.length === 0 && <Text className="text-xs text-neutral-400 text-center mt-4">No automated reports yet.</Text>}
      {data.schedules.map((s) => {
        const next = nextRun(s);
        return (
          <Card key={s.id} className="mb-2.5" accentColor={s.active ? '#16A34A' : '#9CA3AF'}>
            <View className="flex-row items-start gap-2">
              <View className="flex-1">
                <Text className="text-sm font-bold text-neutral-900">{REPORT_TYPE_LABEL[s.reportType]}</Text>
                <Text className="text-xs text-neutral-500 mt-0.5">
                  {s.frequency === 'weekly' ? `Every ${WEEKDAYS[s.dayOfWeek]}` : `Monthly on day ${s.dayOfMonth}`} at {formatTime12(s.time)} ·{' '}
                  {s.channel === 'email' ? 'Email' : 'WhatsApp'}
                </Text>
                <Text className="text-xs text-neutral-500">To: {s.recipients.map((r) => r.name).join(', ') || '—'}</Text>
                {s.active && (
                  <Text className="text-2xs text-green-700 mt-1">
                    Next: {next.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </Text>
                )}
              </View>
              <Switch
                value={s.active}
                onValueChange={(v) => update((d) => ({ ...d, schedules: d.schedules.map((x) => (x.id === s.id ? { ...x, active: v } : x)) }))}
              />
            </View>
            <View className="flex-row gap-2 mt-3">
              <View className="flex-1">
                <Button small label="Send now" icon="paper-plane-outline" variant="secondary" busy={sending === s.id} disabled={!report.tasks} onPress={() => sendNow(s)} />
              </View>
              <View className="flex-1">
                <Button small label="Edit" icon="create-outline" variant="secondary" onPress={() => setEditing(s)} />
              </View>
            </View>
          </Card>
        );
      })}
    </View>
  );
}

function ScheduleForm({
  projectId,
  initial,
  canDelete,
  onCancel,
  onSave,
  onDelete,
}: {
  projectId: string;
  initial: ReportSchedule;
  canDelete: boolean;
  onCancel: () => void;
  onSave: (s: ReportSchedule) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [s, setS] = useState(initial);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ReportSchedule>) => setS((x) => ({ ...x, ...patch }));

  return (
    <View>
      <Pressable onPress={onCancel} className="flex-row items-center gap-1 mb-3">
        <Ionicons name="chevron-back" size={16} color={NAVY} />
        <Text className="text-sm font-semibold" style={{ color: NAVY }}>
          Automated reports
        </Text>
      </Pressable>
      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
      <Card className="mb-3 gap-3">
        <View>
          <Text className="text-xs text-neutral-400 mb-1">Report</Text>
          <Row gap={6}>
            {(Object.keys(REPORT_TYPE_LABEL) as ReportType[]).map((t) => (
              <Chip key={t} label={REPORT_TYPE_LABEL[t]} active={s.reportType === t} onPress={() => set({ reportType: t })} />
            ))}
          </Row>
        </View>
        <View>
          <Text className="text-xs text-neutral-400 mb-1">How often</Text>
          <Row gap={6}>
            {(['weekly', 'monthly'] as ReportFrequency[]).map((f) => (
              <Chip key={f} label={f === 'weekly' ? 'Weekly' : 'Monthly'} active={s.frequency === f} onPress={() => set({ frequency: f })} />
            ))}
          </Row>
        </View>
        {s.frequency === 'weekly' ? (
          <View>
            <Text className="text-xs text-neutral-400 mb-1">Day</Text>
            <Row gap={6}>
              {WEEKDAYS.map((d, i) => (
                <Chip key={d} label={d} active={s.dayOfWeek === i} onPress={() => set({ dayOfWeek: i })} />
              ))}
            </Row>
          </View>
        ) : (
          <View>
            <Text className="text-xs text-neutral-400 mb-1">Day of month</Text>
            <Row gap={6}>
              {[1, 5, 10, 15, 20, 25, 28].map((d) => (
                <Chip key={d} label={String(d)} active={s.dayOfMonth === d} onPress={() => set({ dayOfMonth: d })} />
              ))}
            </Row>
          </View>
        )}
        <TimeField label="Time" value={s.time} onChange={(t) => set({ time: t })} />
        <View>
          <Text className="text-xs text-neutral-400 mb-1">Send by</Text>
          <Row gap={6}>
            {(['email', 'whatsapp'] as SendChannel[]).map((c) => (
              <Chip key={c} label={c === 'email' ? 'Email' : 'WhatsApp'} active={s.channel === c} onPress={() => set({ channel: c })} />
            ))}
          </Row>
        </View>
      </Card>
      <Card className="mb-3">
        <SectionTitle right={<Button small label="Choose" icon="person-add-outline" variant="secondary" onPress={() => setPicker(true)} />}>
          Recipients ({s.recipients.length})
        </SectionTitle>
        {s.recipients.length === 0 ? (
          <Text className="text-xs text-neutral-400">No one yet.</Text>
        ) : (
          s.recipients.map((r) => (
            <Text key={r.key} className="text-sm text-neutral-800 py-1">
              • {r.name}
              <Text className="text-2xs text-neutral-500">{s.channel === 'email' ? `  ${r.email ?? '(no email)'}` : `  ${r.phone ?? '(no phone)'}`}</Text>
            </Text>
          ))
        )}
      </Card>
      <Row gap={8}>
        <View style={{ flex: 1 }}>
          <Button
            label="Save"
            icon="checkmark"
            onPress={() => (s.recipients.length === 0 ? setError('Choose at least one recipient.') : onSave(s))}
          />
        </View>
        {canDelete && (
          <View style={{ flex: 1 }}>
            <Button label="Delete" icon="trash-outline" variant="secondary" onPress={onDelete} />
          </View>
        )}
      </Row>
      <RecipientPicker
        visible={picker}
        projectId={projectId}
        selected={s.recipients}
        title="Report recipients"
        onClose={() => setPicker(false)}
        onDone={(list) => {
          set({ recipients: list });
          setPicker(false);
        }}
      />
    </View>
  );
}

// ---------------- manual ----------------

function ManualSection({
  projectId,
  projectName,
  update,
  report,
}: {
  projectId: string;
  projectName: string;
  update: Update;
  report: ReturnType<typeof useReportData>;
}) {
  const [type, setType] = useState<ReportType>('task_status');
  const [departments, setDepartments] = useState<string[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allDepartments = useMemo(() => Array.from(new Set((report.tasks ?? []).map((t) => t.workName))).sort(), [report.tasks]);
  const title = `${REPORT_TYPE_LABEL[type]} — ${projectName}`;

  async function run(kind: 'preview' | 'share') {
    if (!report.tasks) return;
    setBusy(kind);
    setError(null);
    try {
      const html = buildReportHtml(type, report.tasks, projectName, report.sft, type === 'task_status' ? departments : null);
      if (kind === 'preview') await previewPrintout(html);
      else {
        await sharePrintout(html, title);
        await addHistory(update, { projectId, kind: 'manual', title: REPORT_TYPE_LABEL[type], channel: 'pdf', recipientNames: recipients.map((r) => r.name) });
      }
    } catch (e) {
      logError(e, 'mom_manual_report');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View>
      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
      <Card className="mb-3 gap-3">
        <View>
          <Text className="text-xs text-neutral-400 mb-1">Report</Text>
          <Row gap={6}>
            <Chip label="Task Based Report" active={type === 'task_status'} onPress={() => setType('task_status')} />
            <Chip label="Project Health Report" active={type === 'project_health'} onPress={() => setType('project_health')} />
          </Row>
        </View>
        {type === 'task_status' && (
          <View>
            <Text className="text-xs text-neutral-400 mb-1">Departments</Text>
            {!report.tasks ? (
              <ActivityIndicator color={NAVY} />
            ) : (
              <Row gap={6}>
                <Chip label="All" active={departments == null} onPress={() => setDepartments(null)} />
                {allDepartments.map((d) => {
                  const on = departments?.includes(d) ?? false;
                  return (
                    <Chip
                      key={d}
                      label={d}
                      active={on}
                      onPress={() => {
                        const cur = departments ?? [];
                        const next = on ? cur.filter((x) => x !== d) : [...cur, d];
                        setDepartments(next.length ? next : null);
                      }}
                    />
                  );
                })}
              </Row>
            )}
          </View>
        )}
        <Row gap={8}>
          <View style={{ flex: 1 }}>
            <Button label="Preview PDF" icon="eye-outline" variant="secondary" busy={busy === 'preview'} disabled={!report.tasks} onPress={() => run('preview')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Share PDF" icon="share-outline" busy={busy === 'share'} disabled={!report.tasks} onPress={() => run('share')} />
          </View>
        </Row>
        <Text className="text-2xs text-neutral-500">Share PDF opens your phone&apos;s share menu — pick Gmail / Outlook / WhatsApp and the client.</Text>
      </Card>

      <Card className="mb-3">
        <SectionTitle right={<Button small label="Choose client" icon="person-add-outline" variant="secondary" onPress={() => setPicker(true)} />}>
          Or send a summary to ({recipients.length})
        </SectionTitle>
        {report.tasks && recipients.length > 0 ? (
          <SendPanel
            recipients={recipients}
            subject={title}
            message={buildReportText(type, report.tasks, projectName, report.sft, type === 'task_status' ? departments : null)}
            onSent={(channel, keys) =>
              addHistory(update, {
                projectId,
                kind: 'manual',
                title: `${REPORT_TYPE_LABEL[type]} (summary)`,
                channel,
                recipientNames: recipients.filter((r) => keys.includes(r.key)).map((r) => r.name),
              })
            }
          />
        ) : (
          <Text className="text-xs text-neutral-400">Choose the client(s) from Contact Book to email or WhatsApp a summary.</Text>
        )}
      </Card>

      <RecipientPicker
        visible={picker}
        projectId={projectId}
        selected={recipients}
        title="Send report to"
        onClose={() => setPicker(false)}
        onDone={(list) => {
          setRecipients(list);
          setPicker(false);
        }}
      />
    </View>
  );
}

// ---------------- history ----------------

const KIND_LABEL: Record<ReportHistoryEntry['kind'], string> = {
  automated: 'Automated',
  manual: 'Manual report',
  'task-list': 'Task list',
  alert: 'Alert',
};

const CHANNEL_LABEL: Record<ReportHistoryEntry['channel'], string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  pdf: 'PDF shared',
  notification: 'Live notification',
};

function HistorySection({ history }: { history: ReportHistoryEntry[] }) {
  if (history.length === 0) return <Text className="text-xs text-neutral-400 text-center mt-4">Nothing sent yet.</Text>;
  return (
    <View>
      {history.map((h) => (
        <Card key={h.id} className="mb-2">
          <View className="flex-row items-center gap-2">
            <Text className="text-sm font-semibold text-neutral-900 flex-1">{h.title}</Text>
            <Text className="text-2xs font-bold text-neutral-500">{KIND_LABEL[h.kind]}</Text>
          </View>
          <Text className="text-2xs text-neutral-500 mt-0.5">
            {new Date(h.sentAtISO).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · {CHANNEL_LABEL[h.channel]}
          </Text>
          {h.recipientNames.length > 0 && <Text className="text-2xs text-neutral-600 mt-0.5">To: {h.recipientNames.join(', ')}</Text>}
        </Card>
      ))}
    </View>
  );
}
