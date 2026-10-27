import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/ui/Card';
import { DateField } from '../../components/ui/DateField';
import { useProject } from '../../lib/ProjectContext';
import { useSafeBottomOffset } from '../../lib/useSafeBottomOffset';
import { PEOPLE, personInitial, type Person } from '../../lib/dummyPeople';

// Meeting — rough first version, by explicit request: Schedule Meeting
// (title, date, time, duration, venue, people invited, reminder), then from a
// meeting's own page add more invitees and Send Reminder. Project-specific
// (selected project), same as the MoM tab. DUMMY / IN-MEMORY ONLY: nothing
// is written to Supabase and no real invite/reminder is delivered — sends
// are recorded on the meeting and confirmed on screen only.

const TIME_SLOTS = [
  '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM',
  '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM', '05:00 PM', '05:30 PM', '06:00 PM',
];
const DURATIONS = ['30 min', '1 hr', '1.5 hr', '2 hr'];
const VENUES = ['Site', 'Office', 'Online'];
const REMINDERS = ['15 min before', '30 min before', '1 hr before', '1 day before'];

interface Meeting {
  id: string;
  projectId: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string;
  duration: string;
  venue: string;
  location: string; // address or meeting link
  agenda: string;
  inviteeIds: string[];
  reminder: string;
  remindersSent: string[]; // timestamps of manual "Send Reminder" presses
}

// Module-level so meetings survive leaving the screen (session-only).
const STORE: Meeting[] = [];
const seeded = new Set<string>();

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${dt.toLocaleString('en-US', { weekday: 'short' })}, ${String(d).padStart(2, '0')} ${dt.toLocaleString('en-US', { month: 'short' })} ${y}`;
}

function nowLabel(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

function seedFor(projectId: string) {
  if (seeded.has(projectId)) return;
  seeded.add(projectId);
  STORE.push(
    {
      id: `seed1-${projectId}`, projectId, title: 'Weekly Site Progress Review', date: isoOffset(1), time: '11:00 AM', duration: '1 hr',
      venue: 'Site', location: 'Site office, ground floor', agenda: 'Progress vs schedule, pending drawings, material deliveries',
      inviteeIds: ['p1', 'p3', 'p4', 'p6'], reminder: '1 hr before', remindersSent: [],
    },
    {
      id: `seed2-${projectId}`, projectId, title: 'Client Design Walkthrough', date: isoOffset(4), time: '03:00 PM', duration: '1.5 hr',
      venue: 'Online', location: 'meet.google.com/pmc-roast', agenda: 'Kitchen and living room interiors — finish selection',
      inviteeIds: ['p1', 'p4', 'p5'], reminder: '1 day before', remindersSent: [],
    },
  );
}

const emptyMeeting = (projectId: string): Meeting => ({
  id: '', projectId, title: '', date: isoOffset(1), time: '', duration: '1 hr', venue: 'Site', location: '', agenda: '',
  inviteeIds: [], reminder: '30 min before', remindersSent: [],
});

function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o) => {
        const active = value === o;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            className={`px-3 py-1.5 rounded-full border ${active ? 'bg-brand-navy border-brand-navy' : 'bg-white border-neutral-200'}`}
          >
            <Text className={`text-xs font-semibold ${active ? 'text-white' : 'text-neutral-700'}`}>{o}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Label({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text className="text-xs font-bold text-neutral-600 mb-1 mt-2.5">
      {text}
      {required && <Text style={{ color: '#DC2626' }}> *</Text>}
    </Text>
  );
}

// Checkbox list of people with search — used both when scheduling and when
// adding more invitees to an existing meeting.
function PeoplePicker({ selected, onToggle, exclude = [] }: { selected: string[]; onToggle: (id: string) => void; exclude?: string[] }) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const list = PEOPLE.filter((p) => !exclude.includes(p.id) && (!q || p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q)));
  return (
    <View>
      <View className="flex-row items-center gap-2 border border-neutral-200 rounded-lg px-2.5 mb-1 bg-white">
        <Ionicons name="search" size={14} color="#9CA3AF" />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search people" placeholderTextColor="#9CA3AF" className="flex-1 py-2 text-sm text-neutral-900" />
      </View>
      {list.length === 0 && <Text className="text-xs text-neutral-400 py-2">Everyone is already invited.</Text>}
      {list.map((p) => {
        const on = selected.includes(p.id);
        return (
          <Pressable key={p.id} onPress={() => onToggle(p.id)} className="flex-row items-center gap-3 py-2 border-b border-neutral-50">
            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? '#0F1F33' : '#9CA3AF'} />
            <Avatar person={p} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-neutral-900">{p.name}</Text>
              <Text className="text-2xs text-neutral-500">{p.role}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Avatar({ person, size = 32 }: { person: Person; size?: number }) {
  return (
    <View className="items-center justify-center rounded-full bg-brand-amber" style={{ width: size, height: size }}>
      <Text className="text-xs font-bold text-brand-navy">{personInitial(person)}</Text>
    </View>
  );
}

export default function MeetingsScreen() {
  const { projects, selectedProjectId, setSelectedProjectId } = useProject();
  const bottomPadding = useSafeBottomOffset(24);
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const [mode, setMode] = useState<'list' | 'form' | 'view'>('list');
  const [draft, setDraft] = useState<Meeting | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [addingPeople, setAddingPeople] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? 'Project';

  function flash(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 3000);
  }

  const renderBanner = () =>
    banner ? (
      <View className="flex-row items-center gap-2 mb-3 px-3 py-2.5 rounded-xl" style={{ backgroundColor: '#DCFCE7' }}>
        <Ionicons name="checkmark-circle" size={16} color="#15803D" />
        <Text className="text-xs font-bold flex-1" style={{ color: '#15803D' }}>{banner}</Text>
      </View>
    ) : null;

  if (!selectedProjectId) {
    return (
      <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}>
        <Text className="text-lg font-bold text-neutral-900">Select a Project</Text>
        <Text className="text-xs text-neutral-500 mt-0.5 mb-4">Meetings are scheduled per project.</Text>
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
  const today = isoOffset(0);
  const meetings = STORE.filter((m) => m.projectId === selectedProjectId).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const upcoming = meetings.filter((m) => m.date >= today);
  const past = meetings.filter((m) => m.date < today).reverse();

  // ---------- Meeting detail ----------
  const viewing = viewingId ? STORE.find((m) => m.id === viewingId) : null;
  if (mode === 'view' && viewing) {
    const invitees = PEOPLE.filter((p) => viewing.inviteeIds.includes(p.id));
    return (
      <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => { setMode('list'); setAddingPeople(null); }} className="flex-row items-center gap-1 mb-3 self-start">
          <Ionicons name="arrow-back" size={16} color="#0F1F33" />
          <Text className="text-sm font-bold text-brand-navy">All Meetings</Text>
        </Pressable>
        {renderBanner()}
        <Card className="mb-3">
          <Text className="text-base font-bold text-neutral-900">{viewing.title}</Text>
          <Text className="text-2xs text-neutral-500 mb-3">{projectName}</Text>
          {[
            ['calendar-outline', prettyDate(viewing.date)],
            ['time-outline', `${viewing.time} · ${viewing.duration}`],
            [viewing.venue === 'Online' ? 'videocam-outline' : 'location-outline', `${viewing.venue}${viewing.location ? ` — ${viewing.location}` : ''}`],
            ['notifications-outline', `Reminder ${viewing.reminder}`],
          ].map(([icon, text]) => (
            <View key={icon} className="flex-row items-center gap-2 mb-1.5">
              <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color="#0F1F33" />
              <Text className="text-sm text-neutral-800 flex-1">{text}</Text>
            </View>
          ))}
          {!!viewing.agenda && (
            <>
              <Text className="text-xs font-bold text-neutral-700 mt-2 mb-0.5">Agenda</Text>
              <Text className="text-xs text-neutral-700 leading-5">{viewing.agenda}</Text>
            </>
          )}
        </Card>

        <Card className="mb-3">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400">People Invited ({invitees.length})</Text>
            {addingPeople == null && (
              <Pressable onPress={() => setAddingPeople([])} className="flex-row items-center gap-1">
                <Ionicons name="person-add-outline" size={14} color="#0F1F33" />
                <Text className="text-xs font-bold text-brand-navy">Add People</Text>
              </Pressable>
            )}
          </View>
          {invitees.map((p) => (
            <View key={p.id} className="flex-row items-center gap-3 py-1.5">
              <Avatar person={p} />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-neutral-900">{p.name}</Text>
                <Text className="text-2xs text-neutral-500">{p.role}</Text>
              </View>
              <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: '#DCFCE7' }}>
                <Text className="text-2xs font-bold" style={{ color: '#15803D' }}>Invited</Text>
              </View>
            </View>
          ))}

          {addingPeople != null && (
            <View className="mt-3 pt-3 border-t border-neutral-100">
              <Text className="text-xs font-bold text-neutral-700 mb-2">Add more people</Text>
              <PeoplePicker
                selected={addingPeople}
                exclude={viewing.inviteeIds}
                onToggle={(id) => setAddingPeople((prev) => (prev?.includes(id) ? prev.filter((x) => x !== id) : [...(prev ?? []), id]))}
              />
              <View className="flex-row gap-2 mt-3">
                <Pressable onPress={() => setAddingPeople(null)} className="flex-1 items-center py-2.5 rounded-xl bg-white border border-neutral-300">
                  <Text className="text-sm font-bold text-neutral-600">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (addingPeople.length === 0) return;
                    viewing.inviteeIds = [...viewing.inviteeIds, ...addingPeople];
                    flash(`Invite sent to ${addingPeople.length} more ${addingPeople.length === 1 ? 'person' : 'people'}`);
                    setAddingPeople(null);
                    refresh();
                  }}
                  className="flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand-navy"
                  style={{ opacity: addingPeople.length === 0 ? 0.5 : 1 }}
                >
                  <Ionicons name="send" size={14} color="#fff" />
                  <Text className="text-sm font-bold text-white">Add & Invite{addingPeople.length ? ` (${addingPeople.length})` : ''}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </Card>

        <Pressable
          onPress={() => {
            viewing.remindersSent = [...viewing.remindersSent, nowLabel()];
            flash(`Reminder sent to ${viewing.inviteeIds.length} ${viewing.inviteeIds.length === 1 ? 'person' : 'people'}`);
            refresh();
          }}
          className="flex-row items-center justify-center gap-2 py-3 rounded-xl"
          style={{ backgroundColor: '#F0A227' }}
        >
          <Ionicons name="notifications" size={16} color="#0F1F33" />
          <Text className="text-sm font-bold text-brand-navy">Send Reminder Now</Text>
        </Pressable>
        <Text className="text-2xs text-neutral-500 text-center mt-2">
          {viewing.remindersSent.length > 0
            ? `Last reminder sent ${viewing.remindersSent[viewing.remindersSent.length - 1]} · Auto reminder ${viewing.reminder}`
            : `Auto reminder will go out ${viewing.reminder}`}
        </Text>
      </ScrollView>
    );
  }

  // ---------- Schedule form ----------
  if (mode === 'form' && draft) {
    const update = (patch: Partial<Meeting>) => setDraft((d) => (d ? { ...d, ...patch } : d));
    return (
      <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => setMode('list')} className="flex-row items-center gap-1 mb-3 self-start">
          <Ionicons name="arrow-back" size={16} color="#0F1F33" />
          <Text className="text-sm font-bold text-brand-navy">Cancel</Text>
        </Pressable>
        <Text className="text-lg font-bold text-neutral-900">Schedule Meeting</Text>
        <Text className="text-xs text-neutral-500 mb-3">{projectName}</Text>

        <Card className="mb-3">
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400">Meeting Details</Text>
          <Label text="Meeting Title" required />
          <TextInput
            value={draft.title}
            onChangeText={(t) => update({ title: t })}
            placeholder="e.g. Weekly Site Progress Review"
            placeholderTextColor="#9CA3AF"
            className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white"
          />
          <Label text="Date" required />
          <DateField value={draft.date} minDate={today} onChange={(d) => update({ date: d })} />
          <Label text="Time" required />
          <Chips options={TIME_SLOTS} value={draft.time} onChange={(t) => update({ time: t })} />
          <Label text="Duration" />
          <Chips options={DURATIONS} value={draft.duration} onChange={(t) => update({ duration: t })} />
          <Label text="Venue" />
          <Chips options={VENUES} value={draft.venue} onChange={(t) => update({ venue: t })} />
          <TextInput
            value={draft.location}
            onChangeText={(t) => update({ location: t })}
            placeholder={draft.venue === 'Online' ? 'Meeting link' : 'Location / address'}
            placeholderTextColor="#9CA3AF"
            className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white mt-2"
          />
          <Label text="Agenda" />
          <TextInput
            value={draft.agenda}
            onChangeText={(t) => update({ agenda: t })}
            placeholder="What will be discussed (optional)"
            placeholderTextColor="#9CA3AF"
            multiline
            className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white"
            style={{ minHeight: 70, textAlignVertical: 'top' }}
          />
        </Card>

        <Card className="mb-3">
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">
            People Invited <Text style={{ color: '#DC2626' }}>*</Text>
          </Text>
          <PeoplePicker
            selected={draft.inviteeIds}
            onToggle={(id) => update({ inviteeIds: draft.inviteeIds.includes(id) ? draft.inviteeIds.filter((x) => x !== id) : [...draft.inviteeIds, id] })}
          />
          <Text className="text-2xs font-bold text-brand-navy mt-2">{draft.inviteeIds.length} selected</Text>
        </Card>

        <Card className="mb-3">
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">Reminder</Text>
          <Chips options={REMINDERS} value={draft.reminder} onChange={(t) => update({ reminder: t })} />
        </Card>

        {error && (
          <View className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <Text className="text-xs text-red-600">{error}</Text>
          </View>
        )}

        <Pressable
          onPress={() => {
            const missing: string[] = [];
            if (!draft.title.trim()) missing.push('Meeting Title');
            if (!draft.time) missing.push('Time');
            if (draft.inviteeIds.length === 0) missing.push('People Invited');
            if (missing.length > 0) {
              setError(`Please fill: ${missing.join(', ')}`);
              return;
            }
            const saved = { ...draft, id: `mtg-${Date.now()}` };
            STORE.push(saved);
            setDraft(null);
            setMode('list');
            flash(`Meeting scheduled — invites sent to ${saved.inviteeIds.length} ${saved.inviteeIds.length === 1 ? 'person' : 'people'}`);
          }}
          className="flex-row items-center justify-center gap-2 py-3 rounded-xl bg-brand-navy"
        >
          <Ionicons name="calendar" size={16} color="#fff" />
          <Text className="text-sm font-bold text-white">Schedule & Send Invites</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ---------- List ----------
  const renderMeetingCard = (m: Meeting, dim?: boolean) => {
    const invitees = PEOPLE.filter((p) => m.inviteeIds.includes(p.id));
    const [, mo, d] = m.date.split('-').map(Number);
    const monthShort = new Date(2000, mo - 1, 1).toLocaleString('en-US', { month: 'short' });
    return (
      <Pressable key={m.id} onPress={() => { setViewingId(m.id); setMode('view'); }}>
        <Card className="mb-2.5 flex-row gap-3" style={{ opacity: dim ? 0.6 : 1 }}>
          <View className="items-center justify-center rounded-xl" style={{ width: 52, height: 56, backgroundColor: '#0F1F330D' }}>
            <Text className="text-2xs font-bold uppercase text-brand-amber">{monthShort}</Text>
            <Text className="text-lg font-bold text-brand-navy">{d}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-sm font-bold text-neutral-900">{m.title}</Text>
            <Text className="text-2xs text-neutral-500 mt-0.5">
              {m.time} · {m.duration} · {m.venue}
            </Text>
            <View className="flex-row items-center mt-1.5">
              {invitees.slice(0, 4).map((p, i) => (
                <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -8, borderWidth: 2, borderColor: '#fff', borderRadius: 999 }}>
                  <Avatar person={p} size={22} />
                </View>
              ))}
              <Text className="text-2xs text-neutral-500 ml-1.5">{invitees.length} invited</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9CA3AF" style={{ alignSelf: 'center' }} />
        </Card>
      </Pressable>
    );
  };

  return (
    <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-lg font-bold text-neutral-900">Meetings</Text>
        <Pressable
          onPress={() => { setDraft(emptyMeeting(selectedProjectId)); setError(null); setMode('form'); }}
          className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-navy"
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text className="text-xs font-bold text-white">Schedule Meeting</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => setSelectedProjectId(null)} className="flex-row items-center gap-1 mb-3 self-start">
        <Ionicons name="business-outline" size={12} color="#6B7280" />
        <Text className="text-xs text-neutral-500">{projectName}</Text>
        <Text className="text-xs font-bold text-brand-navy"> · Change</Text>
      </Pressable>
      {renderBanner()}

      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">Upcoming ({upcoming.length})</Text>
      {upcoming.length === 0 && <Text className="text-xs text-neutral-400 mb-3">No upcoming meetings.</Text>}
      {upcoming.map((m) => renderMeetingCard(m))}
      {past.length > 0 && (
        <>
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2 mt-3">Past</Text>
          {past.map((m) => renderMeetingCard(m, true))}
        </>
      )}
    </ScrollView>
  );
}
