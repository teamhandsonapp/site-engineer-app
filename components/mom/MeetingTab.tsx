// MoM → Meeting tab. Create an offline meeting (title, date, time, venue,
// invitees from Contact Book / Specific Book), then on the meeting's own
// page: add to Google Calendar, send invites by WhatsApp / email, collect
// agenda points from invitees and send the final agenda, record the
// meeting from the mic, and mark attendance.

import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../ui/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '../ui/Card';
import { DateField } from '../ui/DateField';
import { newId } from '../../lib/mom/store';
import {
  agendaRequestMessage,
  finalAgendaMessage,
  formatDateLong,
  formatDuration,
  formatTime12,
  googleCalendarUrl,
  inviteMessage,
  meetingEnd,
  meetingStart,
  openLink,
} from '../../lib/mom/share';
import { todayIST } from '../../lib/mom/taskData';
import type { AttendanceMark, Meeting, MomProjectData, Recipient, SendChannel } from '../../lib/mom/types';
import { sendMeetingWhatsAppTest, WA_TEST_ENABLED } from '../../lib/mom/whatsappTest';
import { MeetingRecorder } from './MeetingRecorder';
import { RecipientPicker } from './RecipientPicker';
import { SendPanel } from './SendPanel';
import { Banner, Button, Chip, Field, NAVY, Row, SectionTitle, TimeField } from './ui';

type Update = (fn: (d: MomProjectData) => MomProjectData) => Promise<void>;

const DURATIONS = [30, 60, 90, 120];
const VENUE_PRESETS = ['Site office', 'Head office', 'Client office'];

function statusOf(m: Meeting, now = Date.now()): { label: string; color: string } {
  const start = meetingStart(m).getTime();
  const end = meetingEnd(m).getTime();
  if (now >= start && now <= end) return { label: 'In progress', color: '#DC2626' };
  if (now > end) return { label: 'Completed', color: '#6B7280' };
  if (m.date === todayIST()) return { label: 'Today', color: '#D97706' };
  return { label: 'Upcoming', color: '#2563EB' };
}

export function MeetingTab({
  projectId,
  projectName,
  data,
  update,
  me,
}: {
  projectId: string;
  projectName: string;
  data: MomProjectData;
  update: Update;
  me: { id: string; name: string };
}) {
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'form'; editing: Meeting | null } | { kind: 'detail'; id: string }>({ kind: 'list' });
  const [banner, setBanner] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Re-sorted into Upcoming / Past once a minute, not on every render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const meetings = useMemo(
    () => [...data.meetings].sort((a, b) => meetingStart(b).getTime() - meetingStart(a).getTime()),
    [data.meetings]
  );

  if (view.kind === 'form') {
    return (
      <MeetingForm
        projectId={projectId}
        initial={view.editing}
        onCancel={() => setView(view.editing ? { kind: 'detail', id: view.editing.id } : { kind: 'list' })}
        onSave={async (m) => {
          await update((d) => ({
            ...d,
            meetings: d.meetings.some((x) => x.id === m.id) ? d.meetings.map((x) => (x.id === m.id ? m : x)) : [...d.meetings, m],
          }));
          setBanner(view.editing ? 'Meeting updated.' : 'Meeting created. Next: send the invites and add it to Google Calendar.');
          setView({ kind: 'detail', id: m.id });
          // No automatic WhatsApp send on save: invites go out only from the
          // Invite card's button (one send path, no duplicate messages).
        }}
        me={me}
      />
    );
  }

  if (view.kind === 'detail') {
    const m = data.meetings.find((x) => x.id === view.id);
    if (!m) {
      return (
        <View>
          <Text className="text-sm text-neutral-500">This meeting was deleted.</Text>
          <Button label="Back to meetings" variant="secondary" onPress={() => setView({ kind: 'list' })} />
        </View>
      );
    }
    return (
      <MeetingDetail
        meeting={m}
        projectName={projectName}
        banner={banner}
        clearBanner={() => setBanner(null)}
        me={me}
        onBack={() => {
          setBanner(null);
          setView({ kind: 'list' });
        }}
        onEdit={() => setView({ kind: 'form', editing: m })}
        onDelete={async () => {
          try {
            await update((d) => ({ ...d, meetings: d.meetings.filter((x) => x.id !== m.id) }));
            setView({ kind: 'list' });
          } catch (err) {
            setSaveError(`Couldn't delete the meeting — ${err instanceof Error ? err.message : 'storage error'}.`);
          }
        }}
        onChange={(patch) =>
          update((d) => ({ ...d, meetings: d.meetings.map((x) => (x.id === m.id ? { ...x, ...patch(x) } : x)) }))
            .then(() => true)
            .catch((err) => {
              setBanner(null);
              setSaveError(`Couldn't save that change — ${err instanceof Error ? err.message : 'storage error'}. Try again.`);
              return false;
            })
        }
        saveError={saveError}
        clearSaveError={() => setSaveError(null)}
      />
    );
  }

  const upcoming = meetings.filter((m) => meetingEnd(m).getTime() >= now).reverse();
  const past = meetings.filter((m) => meetingEnd(m).getTime() < now);

  return (
    <View>
      <View className="mb-4">
        <Button label="Create meeting" icon="add-circle-outline" onPress={() => setView({ kind: 'form', editing: null })} />
      </View>

      {meetings.length === 0 && (
        <Card className="items-center py-8">
          <Ionicons name="people-circle-outline" size={36} color="#9CA3AF" />
          <Text className="text-sm font-semibold text-neutral-700 mt-2">No meetings yet</Text>
          <Text className="text-xs text-neutral-500 mt-1 text-center">Create a meeting, invite people from your Contact Book, and send the invites by WhatsApp or email.</Text>
        </Card>
      )}

      {upcoming.length > 0 && <SectionTitle>Upcoming ({upcoming.length})</SectionTitle>}
      {upcoming.map((m) => (
        <MeetingCard key={m.id} meeting={m} onPress={() => setView({ kind: 'detail', id: m.id })} />
      ))}
      {past.length > 0 && <SectionTitle>Past ({past.length})</SectionTitle>}
      {past.map((m) => (
        <MeetingCard key={m.id} meeting={m} onPress={() => setView({ kind: 'detail', id: m.id })} />
      ))}
    </View>
  );
}

function MeetingCard({ meeting: m, onPress }: { meeting: Meeting; onPress: () => void }) {
  const s = statusOf(m);
  const present = Object.values(m.attendance).filter((v) => v === 'present').length;
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-2.5" accentColor={s.color}>
        <View className="flex-row items-start gap-2">
          <View className="flex-1">
            <Text className="text-sm font-bold text-neutral-900">{m.title}</Text>
            <Text className="text-xs text-neutral-500 mt-0.5">
              {formatDateLong(m.date)} · {formatTime12(m.time)}
            </Text>
            <Text className="text-xs text-neutral-500">{m.venue}</Text>
          </View>
          <Text className="text-2xs font-bold" style={{ color: s.color }}>
            {s.label}
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-x-4 gap-y-1 mt-2">
          <Meta icon="people-outline" text={`${m.invitees.length} invited`} />
          {m.attendanceSavedAtISO && <Meta icon="checkmark-circle-outline" text={`${present} attended`} />}
          {m.finalAgenda.length > 0 && <Meta icon="list-outline" text={`${m.finalAgenda.length} agenda points`} />}
          {m.recordings.length > 0 && <Meta icon="mic-outline" text={`${m.recordings.length} recording${m.recordings.length > 1 ? 's' : ''}`} />}
        </View>
      </Card>
    </Pressable>
  );
}

function Meta({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons name={icon} size={13} color="#6B7280" />
      <Text className="text-2xs text-neutral-600">{text}</Text>
    </View>
  );
}

// ---------------- create / edit ----------------

function MeetingForm({
  projectId,
  initial,
  onCancel,
  onSave,
  me,
}: {
  projectId: string;
  initial: Meeting | null;
  onCancel: () => void;
  onSave: (m: Meeting) => Promise<void>;
  me: { id: string; name: string };
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [date, setDate] = useState<string | null>(initial?.date ?? null);
  const [time, setTime] = useState<string | null>(initial?.time ?? null);
  const [duration, setDuration] = useState(initial?.durationMinutes ?? 60);
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [invitees, setInvitees] = useState<Recipient[]>(initial?.invitees ?? []);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return setError('Enter a meeting title.');
    if (!date) return setError('Pick the meeting date.');
    if (!time) return setError('Pick the meeting time.');
    if (!venue.trim()) return setError('Enter where the meeting will be held.');
    if (invitees.length === 0) return setError('Invite at least one person.');
    setSaving(true);
    try {
    const base: Meeting = initial ?? {
      id: newId(),
      projectId,
      title: '',
      date: '',
      time: '',
      durationMinutes: 60,
      venue: '',
      notes: '',
      invitees: [],
      createdById: me.id,
      createdByName: me.name,
      createdAtISO: new Date().toISOString(),
      calendarAddedAtISO: null,
      sendLog: [],
      attendance: {},
      attendanceSavedAtISO: null,
      agendaSubmissions: [],
      finalAgenda: [],
      finalAgendaSentAtISO: null,
      recordings: [],
    };
    const keep = new Set(invitees.map((i) => i.key));
    await onSave({
      ...base,
      title: title.trim(),
      date,
      time,
      durationMinutes: duration,
      venue: venue.trim(),
      notes: notes.trim(),
      invitees,
      attendance: Object.fromEntries(Object.entries(base.attendance).filter(([k]) => keep.has(k))),
    });
    } catch (err) {
      setError(`Couldn't save the meeting — ${err instanceof Error ? err.message : 'storage error'}. Try again.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <Pressable onPress={onCancel} className="flex-row items-center gap-1 mb-3">
        <Ionicons name="chevron-back" size={16} color={NAVY} />
        <Text className="text-sm font-semibold" style={{ color: NAVY }}>
          {initial ? 'Back to meeting' : 'All meetings'}
        </Text>
      </Pressable>
      <Text className="text-lg font-bold text-neutral-900 mb-3">{initial ? 'Edit meeting' : 'Create meeting'}</Text>
      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}

      <Card className="mb-3 gap-3">
        <Field label="Meeting title" value={title} onChangeText={setTitle} placeholder="e.g. Weekly site review" />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <DateField label="Date" value={date} minDate={initial ? null : todayIST()} onChange={setDate} />
          </View>
          <View className="flex-1">
            <TimeField label="Time" value={time} onChange={setTime} />
          </View>
        </View>
        <View>
          <Text className="text-xs text-neutral-400 mb-1">Duration</Text>
          <Row gap={6}>
            {DURATIONS.map((d) => (
              <Chip key={d} label={formatDuration(d)} active={duration === d} onPress={() => setDuration(d)} />
            ))}
          </Row>
        </View>
      </Card>

      <Card className="mb-3 gap-3">
        <View className="flex-row items-center gap-2">
          <Ionicons name="location-outline" size={16} color={NAVY} />
          <Text className="text-sm font-bold text-neutral-900">Offline meeting — venue</Text>
        </View>
        <Row gap={6}>
          {VENUE_PRESETS.map((v) => (
            <Chip key={v} label={v} active={venue === v} onPress={() => setVenue(v)} />
          ))}
        </Row>
        <Field value={venue} onChangeText={setVenue} placeholder="Or type the address / room" />
        <Field label="Notes for invitees (optional)" value={notes} onChangeText={setNotes} multiline placeholder="Anything people should bring or know" />
      </Card>

      <Card className="mb-4">
        <SectionTitle right={<Button small label="Add from Contact Book" icon="person-add-outline" variant="secondary" onPress={() => setPicker(true)} />}>
          Invitees ({invitees.length})
        </SectionTitle>
        {invitees.length === 0 && <Text className="text-xs text-neutral-400">No one invited yet.</Text>}
        {invitees.map((r) => (
          <View key={r.key} className="flex-row items-center gap-3 py-2 border-t border-neutral-100">
            <View className="flex-1">
              <Text className="text-sm font-semibold text-neutral-900">{r.name}</Text>
              <Text className="text-2xs text-neutral-500">{[r.company, r.phone, r.email].filter(Boolean).join(' · ')}</Text>
            </View>
            <Pressable hitSlop={8} onPress={() => setInvitees((list) => list.filter((x) => x.key !== r.key))}>
              <Ionicons name="close-circle" size={18} color="#9CA3AF" />
            </Pressable>
          </View>
        ))}
      </Card>

      <Button label={initial ? 'Save changes' : 'Create meeting'} icon="checkmark" busy={saving} onPress={save} />

      <RecipientPicker
        visible={picker}
        projectId={projectId}
        selected={invitees}
        title="Invite people"
        onClose={() => setPicker(false)}
        onDone={(list) => {
          setInvitees(list);
          setPicker(false);
        }}
      />
    </View>
  );
}

// ---------------- meeting page ----------------

type DetailTab = 'invite' | 'agenda' | 'record' | 'attendance';

function MeetingDetail({
  meeting: m,
  projectName,
  banner,
  clearBanner,
  me,
  onBack,
  onEdit,
  onDelete,
  onChange,
  saveError,
  clearSaveError,
}: {
  meeting: Meeting;
  projectName: string;
  banner: string | null;
  clearBanner: () => void;
  me: { id: string; name: string };
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  // Resolves false (and shows saveError) if the change couldn't be stored.
  onChange: (patch: (m: Meeting) => Partial<Meeting>) => Promise<boolean>;
  saveError: string | null;
  clearSaveError: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>(() => {
    const now = Date.now();
    return now >= meetingStart(m).getTime() - 15 * 60_000 && now <= meetingEnd(m).getTime() ? 'record' : 'invite';
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const s = statusOf(m);

  function logSend(what: 'invite' | 'agenda-request' | 'final-agenda', channel: SendChannel, keys: string[], via?: 'api' | 'link'): Promise<boolean> {
    return onChange((x) => ({
      sendLog: [...x.sendLog, { what, channel, ...(via ? { via } : {}), recipientKeys: keys, atISO: new Date().toISOString() }],
      ...(what === 'final-agenda' ? { finalAgendaSentAtISO: new Date().toISOString() } : {}),
    }));
  }

  const sentFor = (what: string) => new Set(m.sendLog.filter((l) => l.what === what && l.channel === 'whatsapp').flatMap((l) => l.recipientKeys));

  return (
    <View>
      <Pressable onPress={onBack} className="flex-row items-center gap-1 mb-3">
        <Ionicons name="chevron-back" size={16} color={NAVY} />
        <Text className="text-sm font-semibold" style={{ color: NAVY }}>
          All meetings
        </Text>
      </Pressable>
      {banner && <Banner tone="ok" onClose={clearBanner}>{banner}</Banner>}
      {saveError && <Banner tone="error" onClose={clearSaveError}>{saveError}</Banner>}

      <Card className="mb-3" accentColor={s.color}>
        <View className="flex-row items-start gap-2">
          <Text className="text-base font-bold text-neutral-900 flex-1">{m.title}</Text>
          <Text className="text-2xs font-bold" style={{ color: s.color }}>
            {s.label}
          </Text>
        </View>
        <Text className="text-xs text-neutral-600 mt-1">
          {formatDateLong(m.date)} · {formatTime12(m.time)} · {formatDuration(m.durationMinutes)}
        </Text>
        <Text className="text-xs text-neutral-600">📍 {m.venue}</Text>
        {m.notes ? <Text className="text-xs text-neutral-500 mt-1">{m.notes}</Text> : null}
        <View className="flex-row gap-2 mt-3">
          <View className="flex-1">
            <Button
              small
              label={m.calendarAddedAtISO ? 'Added to Calendar ✓' : 'Add to Google Calendar'}
              icon="calendar-outline"
              variant="secondary"
              onPress={async () => {
                try {
                  await openLink(googleCalendarUrl(m, projectName));
                } catch {
                  return; // no browser / Calendar app — nothing was added
                }
                await onChange(() => ({ calendarAddedAtISO: new Date().toISOString() }));
              }}
            />
          </View>
          <Button small label="Edit" icon="create-outline" variant="secondary" onPress={onEdit} />
        </View>
      </Card>

      <View className="flex-row rounded-xl bg-neutral-100 p-1 mb-3">
        {(
          [
            ['invite', 'Invite', 'paper-plane-outline'],
            ['agenda', 'Agenda', 'list-outline'],
            ['record', 'Record', 'mic-outline'],
            ['attendance', 'Attendance', 'checkmark-circle-outline'],
          ] as [DetailTab, string, keyof typeof Ionicons.glyphMap][]
        ).map(([key, label, icon]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            className="flex-1 items-center rounded-lg py-2"
            style={{ backgroundColor: tab === key ? '#fff' : 'transparent' }}
          >
            <Ionicons name={icon} size={15} color={tab === key ? NAVY : '#6B7280'} />
            <Text className="text-2xs font-bold mt-0.5" style={{ color: tab === key ? NAVY : '#6B7280' }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'invite' && (
        <Card className="mb-3">
          <SectionTitle>Send invitation to {m.invitees.length} people</SectionTitle>
          <SendPanel
            recipients={m.invitees}
            subject={`Meeting: ${m.title} — ${formatDateLong(m.date)}`}
            message={inviteMessage(m, projectName)}
            sentKeys={sentFor('invite')}
            onSent={(c, keys, via) => logSend('invite', c, keys, via)}
            apiSend={WA_TEST_ENABLED ? (people) => sendMeetingWhatsAppTest(m, projectName, people) : undefined}
          />
          <SendLog meeting={m} what="invite" />
        </Card>
      )}

      {tab === 'agenda' && <AgendaSection meeting={m} projectName={projectName} me={me} onChange={onChange} logSend={logSend} sentFor={sentFor} />}

      {tab === 'record' && (
        <Card className="mb-3">
          <SectionTitle>Meeting recording</SectionTitle>
          <MeetingRecorder
            recordings={m.recordings}
            onAdd={(r) => onChange((x) => ({ recordings: [...x.recordings, r] }))}
            onDelete={(id) => onChange((x) => ({ recordings: x.recordings.filter((r) => r.id !== id) }))}
          />
        </Card>
      )}

      {tab === 'attendance' && <AttendanceSection meeting={m} onChange={onChange} />}

      <View className="mt-4 mb-2">
        {confirmDelete ? (
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button label="Yes, delete meeting" variant="danger" onPress={onDelete} />
            </View>
            <View className="flex-1">
              <Button label="Cancel" variant="secondary" onPress={() => setConfirmDelete(false)} />
            </View>
          </View>
        ) : (
          <Button label="Delete meeting" icon="trash-outline" variant="ghost" onPress={() => setConfirmDelete(true)} />
        )}
      </View>
    </View>
  );
}

function SendLog({ meeting, what }: { meeting: Meeting; what: 'invite' | 'agenda-request' | 'final-agenda' }) {
  const entries = meeting.sendLog.filter((l) => l.what === what);
  if (entries.length === 0) return null;
  const names = new Map(meeting.invitees.map((i) => [i.key, i.name]));
  return (
    <View className="mt-3 pt-3 border-t border-neutral-100">
      <Text className="text-2xs font-bold text-neutral-500 mb-1">SENT</Text>
      {entries
        .slice(-6)
        .reverse()
        .map((l, i) => (
          <Text key={i} className="text-2xs text-neutral-500">
            {new Date(l.atISO).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} ·{' '}
            {l.channel === 'whatsapp' ? (l.via === 'api' ? 'WhatsApp API (test number)' : 'WhatsApp') : 'Email'} →{l.recipientKeys.map((k) => names.get(k) ?? '—').join(', ')}
          </Text>
        ))}
    </View>
  );
}

// ---------------- agenda ----------------

function AgendaSection({
  meeting: m,
  projectName,
  me,
  onChange,
  logSend,
  sentFor,
}: {
  meeting: Meeting;
  projectName: string;
  me: { id: string; name: string };
  onChange: (patch: (m: Meeting) => Partial<Meeting>) => Promise<boolean>;
  logSend: (what: 'invite' | 'agenda-request' | 'final-agenda', channel: SendChannel, keys: string[]) => Promise<boolean>;
  sentFor: (what: string) => Set<string>;
}) {
  const [step, setStep] = useState<'collect' | 'final'>(m.finalAgenda.length ? 'final' : 'collect');
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showRequest, setShowRequest] = useState(false);
  const [finalDraft, setFinalDraft] = useState('');

  const people: { key: string; name: string }[] = [{ key: 'admin', name: `${me.name} (you)` }, ...m.invitees.map((i) => ({ key: i.key, name: i.name }))];
  const submissionFor = (key: string) => m.agendaSubmissions.find((s) => s.from === key);
  const received = m.agendaSubmissions.filter((s) => s.points.length > 0).length;

  function startEdit(key: string) {
    setEditingFor(key);
    setDraft((submissionFor(key)?.points ?? []).join('\n'));
  }

  async function saveSubmission(key: string, name: string) {
    const points = draft
      .split('\n')
      .map((p) => p.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim())
      .filter(Boolean);
    const ok = await onChange((x) => ({
      agendaSubmissions: [
        ...x.agendaSubmissions.filter((s) => s.from !== key),
        ...(points.length ? [{ from: key, fromName: name, points, receivedAtISO: new Date().toISOString() }] : []),
      ],
    }));
    if (ok) setEditingFor(null);
  }

  function buildFinal() {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const p of people) {
      for (const point of submissionFor(p.key)?.points ?? []) {
        const k = point.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(point);
        }
      }
    }
    onChange(() => ({ finalAgenda: merged }));
    setStep('final');
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= m.finalAgenda.length) return;
    const next = [...m.finalAgenda];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(() => ({ finalAgenda: next }));
  }

  return (
    <View>
      <View className="flex-row flex-wrap gap-2 mb-3">
        <Chip label={`1. Collect points (${received}/${people.length})`} active={step === 'collect'} onPress={() => setStep('collect')} />
        <Chip label={`2. Final agenda (${m.finalAgenda.length})`} active={step === 'final'} onPress={() => setStep('final')} />
      </View>

      {step === 'collect' && (
        <>
          <Card className="mb-3">
            <SectionTitle
              right={<Button small label={showRequest ? 'Hide' : 'Ask invitees'} icon="chatbubbles-outline" variant="secondary" onPress={() => setShowRequest((v) => !v)} />}
            >
              Ask everyone for agenda points
            </SectionTitle>
            <Text className="text-2xs text-neutral-500">Each invitee sends you their points; you enter what they reply below, plus your own.</Text>
            {showRequest && (
              <View className="mt-3">
                <SendPanel
                  recipients={m.invitees}
                  subject={`Agenda points for: ${m.title}`}
                  message={agendaRequestMessage(m, projectName)}
                  sentKeys={sentFor('agenda-request')}
                  onSent={(c, keys) => logSend('agenda-request', c, keys)}
                />
              </View>
            )}
          </Card>

          {people.map((p) => {
            const sub = submissionFor(p.key);
            const editing = editingFor === p.key;
            return (
              <Card key={p.key} className="mb-2">
                <View className="flex-row items-center gap-2">
                  <Ionicons name={sub ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={sub ? '#16A34A' : '#9CA3AF'} />
                  <Text className="text-sm font-semibold text-neutral-900 flex-1">{p.name}</Text>
                  {!editing && <Button small label={sub ? 'Edit' : 'Add points'} variant="secondary" onPress={() => startEdit(p.key)} />}
                </View>
                {!editing && sub && (
                  <View className="mt-2 gap-0.5">
                    {sub.points.map((pt, i) => (
                      <Text key={i} className="text-xs text-neutral-700">
                        • {pt}
                      </Text>
                    ))}
                  </View>
                )}
                {editing && (
                  <View className="mt-2 gap-2">
                    <Field value={draft} onChangeText={setDraft} multiline placeholder="One point per line" autoFocus />
                    <View className="flex-row gap-2">
                      <View className="flex-1">
                        <Button small label="Save" icon="checkmark" onPress={() => saveSubmission(p.key, p.name)} />
                      </View>
                      <View className="flex-1">
                        <Button small label="Cancel" variant="secondary" onPress={() => setEditingFor(null)} />
                      </View>
                    </View>
                  </View>
                )}
              </Card>
            );
          })}

          <View className="mt-2">
            <Button label="Build final agenda from all points" icon="git-merge-outline" disabled={received === 0} onPress={buildFinal} />
          </View>
        </>
      )}

      {step === 'final' && (
        <>
          <Card className="mb-3">
            <SectionTitle>Final agenda</SectionTitle>
            {m.finalAgenda.length === 0 && <Text className="text-xs text-neutral-400">No points yet — collect points first or add them here.</Text>}
            {m.finalAgenda.map((p, i) => (
              <View key={`${i}-${p}`} className="flex-row items-center gap-2 py-1.5 border-t border-neutral-100">
                <Text className="text-xs font-bold text-neutral-400 w-5">{i + 1}.</Text>
                <Text className="text-sm text-neutral-800 flex-1">{p}</Text>
                <Pressable hitSlop={6} onPress={() => move(i, -1)}>
                  <Ionicons name="chevron-up" size={16} color="#9CA3AF" />
                </Pressable>
                <Pressable hitSlop={6} onPress={() => move(i, 1)}>
                  <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
                </Pressable>
                <Pressable hitSlop={6} onPress={() => onChange((x) => ({ finalAgenda: x.finalAgenda.filter((_, k) => k !== i) }))}>
                  <Ionicons name="close" size={16} color="#9CA3AF" />
                </Pressable>
              </View>
            ))}
            <View className="flex-row gap-2 mt-2 items-center">
              <View className="flex-1">
                <Field value={finalDraft} onChangeText={setFinalDraft} placeholder="Add a point" />
              </View>
              <Button
                small
                label="Add"
                icon="add"
                disabled={!finalDraft.trim()}
                onPress={() => {
                  const v = finalDraft.trim();
                  onChange((x) => ({ finalAgenda: [...x.finalAgenda, v] }));
                  setFinalDraft('');
                }}
              />
            </View>
          </Card>

          {m.finalAgenda.length > 0 && (
            <Card className="mb-3">
              <SectionTitle>Send agenda to all invitees</SectionTitle>
              {m.finalAgendaSentAtISO && (
                <Text className="text-2xs text-green-700 mb-2">
                  Last sent {new Date(m.finalAgendaSentAtISO).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </Text>
              )}
              <SendPanel
                recipients={m.invitees}
                subject={`Agenda: ${m.title} — ${formatDateLong(m.date)}`}
                message={finalAgendaMessage(m, projectName)}
                sentKeys={sentFor('final-agenda')}
                onSent={(c, keys) => logSend('final-agenda', c, keys)}
              />
            </Card>
          )}
        </>
      )}
    </View>
  );
}

// ---------------- attendance ----------------

function AttendanceSection({ meeting: m, onChange }: { meeting: Meeting; onChange: (patch: (m: Meeting) => Partial<Meeting>) => Promise<boolean> }) {
  const [marks, setMarks] = useState<Record<string, AttendanceMark>>(m.attendance);
  const [saved, setSaved] = useState(false);
  const present = Object.values(marks).filter((v) => v === 'present').length;
  const absent = Object.values(marks).filter((v) => v === 'absent').length;
  const unmarked = m.invitees.length - present - absent;

  function set(key: string, v: AttendanceMark) {
    setSaved(false);
    setMarks((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <Card className="mb-3">
      <SectionTitle right={<Button small label="All present" variant="secondary" onPress={() => { setSaved(false); setMarks(Object.fromEntries(m.invitees.map((i) => [i.key, 'present' as const]))); }} />}>
        Attendance
      </SectionTitle>
      <View className="flex-row gap-4 mb-2">
        <Text className="text-xs font-semibold text-green-700">{present} present</Text>
        <Text className="text-xs font-semibold text-red-600">{absent} absent</Text>
        {unmarked > 0 && <Text className="text-xs text-neutral-500">{unmarked} not marked</Text>}
      </View>
      {m.invitees.map((r) => {
        const v = marks[r.key];
        return (
          <View key={r.key} className="flex-row items-center gap-2 py-2 border-t border-neutral-100">
            <View className="flex-1">
              <Text className="text-sm font-semibold text-neutral-900">{r.name}</Text>
              {r.company && <Text className="text-2xs text-neutral-500">{r.company}</Text>}
            </View>
            <Chip label="Present" active={v === 'present'} color="#16A34A" onPress={() => set(r.key, 'present')} />
            <Chip label="Absent" active={v === 'absent'} color="#DC2626" onPress={() => set(r.key, 'absent')} />
          </View>
        );
      })}
      <View className="mt-3">
        <Button
          label={saved ? 'Attendance saved ✓' : 'Save attendance'}
          icon="save-outline"
          onPress={async () => {
            if (await onChange(() => ({ attendance: marks, attendanceSavedAtISO: new Date().toISOString() }))) setSaved(true);
          }}
        />
      </View>
      {m.attendanceSavedAtISO && (
        <Text className="text-2xs text-neutral-400 mt-2">
          Last saved {new Date(m.attendanceSavedAtISO).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
        </Text>
      )}
    </Card>
  );
}
