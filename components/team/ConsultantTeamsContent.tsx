import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';

// Placeholder — a consultant discipline (e.g. "HVAC Consultant") is its own
// team with its own member roster; more disciplines get added as new tabs
// by the admin (Electrical Consultant, Structural Consultant, etc.), same
// "wire it up later" placeholder as the rest of the team category screens.
interface ConsultantMember {
  id: string;
  name: string;
}
interface ConsultantTeam {
  id: string;
  name: string;
  members: ConsultantMember[];
}

const DUMMY_MEMBER_NAMES = [
  'Ravi Shankar', 'Prakash Iyer', 'Suresh Menon', 'Anil Nair', 'Kiran Rao',
  'Deepak Pillai', 'Manoj Varma', 'Sunil Kumar', 'Ramesh Babu', 'Vinod Chandran',
  'Ashok Kutty', 'Girish Bhat', 'Naveen Shetty', 'Mahesh Achari', 'Sanjay Poduval',
  'Rajesh Kannan', 'Vikram Sarma', 'Harish Nambiar', 'Praveen Unni', 'Arun Balan',
];

function makeInitialTeams(): ConsultantTeam[] {
  return [
    {
      id: 'hvac',
      name: 'HVAC Consultant',
      members: DUMMY_MEMBER_NAMES.map((name, i) => ({ id: `hvac-${i}`, name })),
    },
  ];
}

type AttendanceStatus = 'Present' | 'Absent';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function attendanceDayKey(memberId: string, year: number, month: number, day: number): string {
  return `${memberId}-${year}-${month}-${day}`;
}

// Deterministic pseudo-random default (seeded off member+date, not
// Math.random()) so a day's default status is a pure function of its key —
// safe to compute during render as many times as needed, with zero setState
// calls. Only an explicit tap (toggleAttendance) ever writes to real state.
function defaultStatusFor(memberId: string, year: number, month: number, day: number): AttendanceStatus {
  const seed = `${memberId}-${year}-${month}-${day}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100 < 85 ? 'Present' : 'Absent';
}

function AddNamePromptModal({
  title,
  placeholder,
  onCancel,
  onConfirm,
}: {
  title: string;
  placeholder: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onCancel}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380 }}>
          <Card>
            <Text className="text-sm font-bold text-neutral-900 mb-3">{title}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={placeholder}
              autoFocus
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-4"
            />
            <View className="flex-row justify-end gap-2">
              <Pressable onPress={onCancel} className="px-3.5 py-2 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => trimmed && onConfirm(trimmed)}
                disabled={!trimmed}
                className="px-3.5 py-2 rounded-lg bg-brand-navy"
                style={{ opacity: trimmed ? 1 : 0.5 }}
              >
                <Text className="text-xs font-semibold text-white">Add</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MonthlyAttendanceGrid({
  members,
  daysCount,
  getAttendance,
  onToggle,
}: {
  members: ConsultantMember[];
  daysCount: number;
  getAttendance: (memberId: string) => AttendanceStatus[];
  onToggle: (memberId: string, dayIdx: number) => void;
}) {
  const NAME_COL_WIDTH = 118;
  const DAY_COL_WIDTH = 30;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View className="flex-row items-center pb-2 mb-1.5 border-b border-neutral-200">
          <View style={{ width: NAME_COL_WIDTH }}>
            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400">Name</Text>
          </View>
          {Array.from({ length: daysCount }, (_, i) => (
            <View key={i} style={{ width: DAY_COL_WIDTH }} className="items-center">
              <Text className="text-2xs font-bold text-neutral-400">{i + 1}</Text>
            </View>
          ))}
        </View>

        {members.map((member, idx) => {
          const attendance = getAttendance(member.id);
          return (
            <View
              key={member.id}
              className={`flex-row items-center py-1.5 ${idx < members.length - 1 ? 'border-b border-neutral-50' : ''}`}
            >
              <View style={{ width: NAME_COL_WIDTH }}>
                <Text numberOfLines={1} className="text-xs font-semibold text-neutral-800 pr-2">
                  {member.name}
                </Text>
              </View>
              {attendance.map((status, dayIdx) => (
                <Pressable key={dayIdx} onPress={() => onToggle(member.id, dayIdx)} style={{ width: DAY_COL_WIDTH }} className="items-center">
                  <View
                    className="w-5 h-5 rounded items-center justify-center"
                    style={{ backgroundColor: status === 'Present' ? '#DCFCE7' : '#FEE2E2' }}
                  >
                    <Text className="text-2xs font-bold" style={{ color: status === 'Present' ? '#16A34A' : '#DC2626' }}>
                      {status === 'Present' ? 'P' : 'A'}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

// Consultant-only view (per explicit request) — one project can have
// several consultant disciplines (tabs), each with its own team roster and
// its own monthly attendance grid, editable (tap a day to toggle Present/
// Absent — a consultant's team members aren't app users with their own
// check-in, so someone on-site marks it by hand, same as the reference
// paper attendance sheet this feature is modeled on) and browsable month by
// month for as long as the project runs, not locked to one fixed month.
// Admin can create a new consultant discipline and add/remove team members
// within one. Everything here is local component state + randomized
// placeholder attendance — no backend wiring yet.
export function ConsultantTeamsContent() {
  const [teams, setTeams] = useState<ConsultantTeam[]>(makeInitialTeams);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(teams[0]?.id ?? null);
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);

  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  function goToPrevMonth() {
    setViewDate(({ year, month }) => (month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }));
  }
  function goToNextMonth() {
    setViewDate(({ year, month }) => (month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }));
  }

  // Keyed by member+year+month+day, holding ONLY explicit taps — the
  // untouched default for any day is derived on the fly from
  // defaultStatusFor (a pure function), so getAttendance never needs to
  // write state during render (that was the cause of a "Cannot update a
  // component while rendering a different component" error: the previous
  // version lazily cached a whole generated month via setState from inside
  // getAttendance, which MonthlyAttendanceGrid calls during its own render).
  const [overrides, setOverrides] = useState<Record<string, AttendanceStatus>>({});

  function getAttendance(memberId: string): AttendanceStatus[] {
    const count = daysInMonth(viewDate.year, viewDate.month);
    return Array.from({ length: count }, (_, i) => {
      const day = i + 1;
      const key = attendanceDayKey(memberId, viewDate.year, viewDate.month, day);
      return overrides[key] ?? defaultStatusFor(memberId, viewDate.year, viewDate.month, day);
    });
  }

  function toggleAttendance(memberId: string, dayIdx: number) {
    const day = dayIdx + 1;
    const key = attendanceDayKey(memberId, viewDate.year, viewDate.month, day);
    setOverrides((prev) => {
      const current = prev[key] ?? defaultStatusFor(memberId, viewDate.year, viewDate.month, day);
      return { ...prev, [key]: current === 'Present' ? 'Absent' : 'Present' };
    });
  }

  const activeTeam = useMemo(() => teams.find((t) => t.id === activeTeamId) ?? null, [teams, activeTeamId]);

  function addTeam(name: string) {
    const id = `team-${Date.now()}`;
    setTeams((prev) => [...prev, { id, name, members: [] }]);
    setActiveTeamId(id);
    setAddTeamOpen(false);
  }

  function addMember(name: string) {
    if (!activeTeam) return;
    const id = `${activeTeam.id}-${Date.now()}`;
    setTeams((prev) => prev.map((t) => (t.id === activeTeam.id ? { ...t, members: [...t.members, { id, name }] } : t)));
    setAddMemberOpen(false);
  }

  function removeMember(memberId: string) {
    if (!activeTeam) return;
    setTeams((prev) => prev.map((t) => (t.id === activeTeam.id ? { ...t, members: t.members.filter((m) => m.id !== memberId) } : t)));
  }

  return (
    <View>
      {/* Consultant discipline tabs — "+ Add Consultant" always sits at the
          end so the row can keep growing as more disciplines get created. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
        <View className="flex-row gap-2">
          {teams.map((team) => {
            const active = team.id === activeTeamId;
            return (
              <Pressable
                key={team.id}
                onPress={() => setActiveTeamId(team.id)}
                className="px-3.5 py-2 rounded-full"
                style={{ backgroundColor: active ? '#0F1F33' : '#F5F5F4' }}
              >
                <Text className="text-xs font-bold" style={{ color: active ? '#ffffff' : '#57534E' }}>
                  {team.name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setAddTeamOpen(true)}
            className="flex-row items-center gap-1 px-3.5 py-2 rounded-full border border-dashed border-neutral-300"
          >
            <Ionicons name="add" size={14} color="#0F1F33" />
            <Text className="text-xs font-bold text-brand-navy">Add Consultant</Text>
          </Pressable>
        </View>
      </ScrollView>

      {activeTeam && (
        <>
          <Card className="mb-4" style={{ paddingVertical: 4 }}>
            <View className="flex-row items-center justify-between py-3 border-b border-neutral-100">
              <Text className="text-sm font-bold text-neutral-900">{activeTeam.name} Team</Text>
              <Text className="text-xs font-semibold text-neutral-400">{activeTeam.members.length} members</Text>
            </View>

            {activeTeam.members.map((member, idx) => (
              <View
                key={member.id}
                className={`flex-row items-center justify-between py-2.5 ${idx < activeTeam.members.length - 1 ? 'border-b border-neutral-50' : ''}`}
              >
                <Text className="text-sm font-medium text-neutral-800">{member.name}</Text>
                <Pressable onPress={() => removeMember(member.id)} hitSlop={8} className="w-7 h-7 rounded-full items-center justify-center bg-red-50">
                  <Ionicons name="trash-outline" size={13} color="#DC2626" />
                </Pressable>
              </View>
            ))}

            <Pressable onPress={() => setAddMemberOpen(true)} className="flex-row items-center gap-1.5 py-2.5">
              <Ionicons name="add-circle-outline" size={15} color="#0F1F33" />
              <Text className="text-xs font-semibold text-brand-navy">Add member…</Text>
            </Pressable>
          </Card>

          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400">Monthly Attendance</Text>
            <View className="flex-row items-center gap-2">
              <Pressable onPress={goToPrevMonth} hitSlop={8}>
                <Ionicons name="chevron-back" size={16} color="#0F1F33" />
              </Pressable>
              <Text className="text-xs font-bold text-neutral-700" style={{ minWidth: 92, textAlign: 'center' }}>
                {MONTH_NAMES[viewDate.month]} {viewDate.year}
              </Text>
              <Pressable onPress={goToNextMonth} hitSlop={8}>
                <Ionicons name="chevron-forward" size={16} color="#0F1F33" />
              </Pressable>
            </View>
          </View>
          <Text className="text-2xs text-neutral-400 mb-2">Tap a day to mark Present/Absent — browse ahead through to the project's end date.</Text>
          <Card>
            {activeTeam.members.length === 0 ? (
              <Text className="text-xs text-neutral-400 py-2">No team members yet — add one above to see attendance.</Text>
            ) : (
              <MonthlyAttendanceGrid
                members={activeTeam.members}
                daysCount={daysInMonth(viewDate.year, viewDate.month)}
                getAttendance={getAttendance}
                onToggle={toggleAttendance}
              />
            )}
          </Card>
        </>
      )}

      {addTeamOpen && (
        <AddNamePromptModal
          title="Add Consultant"
          placeholder="e.g. Electrical Consultant"
          onCancel={() => setAddTeamOpen(false)}
          onConfirm={addTeam}
        />
      )}

      {addMemberOpen && (
        <AddNamePromptModal
          title={`Add Member — ${activeTeam?.name ?? ''}`}
          placeholder="Team member name"
          onCancel={() => setAddMemberOpen(false)}
          onConfirm={addMember}
        />
      )}
    </View>
  );
}
