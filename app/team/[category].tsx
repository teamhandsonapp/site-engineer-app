import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchTeamAttendanceSummary, type EngineerAttendanceSummary } from '../../lib/attendanceReview';
import { formatTime12h } from '../../lib/formatTime';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConsultantTeamsContent } from '../../components/team/ConsultantTeamsContent';

type CategorySlug = 'architect' | 'client' | 'consultant' | 'contractor' | 'vendor' | 'site-engineer';

const CATEGORY_CONFIG: Record<CategorySlug, { title: string; icon: keyof typeof Ionicons.glyphMap; color: string; kind: 'attendance' | 'checklist' | 'reports' | 'consultant-teams' }> = {
  architect: { title: 'Architect', icon: 'compass-outline', color: '#7C3AED', kind: 'checklist' },
  client: { title: 'Client', icon: 'person-outline', color: '#2563EB', kind: 'reports' },
  consultant: { title: 'Consultant', icon: 'bulb-outline', color: '#0D9488', kind: 'consultant-teams' },
  contractor: { title: 'Contractor', icon: 'hammer-outline', color: '#EA580C', kind: 'checklist' },
  vendor: { title: 'Vendor', icon: 'cart-outline', color: '#DB2777', kind: 'checklist' },
  'site-engineer': { title: 'Site Engineer', icon: 'construct-outline', color: '#16A34A', kind: 'attendance' },
};

// Placeholder — illustrative checklist names/due-dates, not real
// procurement/checklist data yet.
const DUMMY_CHECKLIST_DUE = [
  { name: 'Material Delivery Checklist', dueInDays: 2 },
  { name: 'Site Safety Compliance', dueInDays: 3 },
  { name: 'Quality Inspection Sign-off', dueInDays: 5 },
  { name: 'Payment Milestone Review', dueInDays: 7 },
];

function ProjectPickRow({ name, onPress }: { name: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-2.5 flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <View className="w-9 h-9 rounded-xl items-center justify-center bg-brand-navy/10">
            <Ionicons name="briefcase-outline" size={16} color="#0F1F33" />
          </View>
          <Text className="text-sm font-bold text-neutral-900">{name}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </Card>
    </Pressable>
  );
}

// Real data — same fetchTeamAttendanceSummary(projectId) call the
// team-attendance drawer screen uses, scoped to whichever project was
// picked above. Tapping an engineer opens the SAME real
// team-attendance-detail/[userId] screen (logs + map), not a placeholder —
// that screen already exists and reads its own project scope off
// useProject(), so no project param needs to be passed through here.
function AttendanceContent({ projectId }: { projectId: string }) {
  const [engineers, setEngineers] = useState<EngineerAttendanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setEngineers(await fetchTeamAttendanceSummary(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
        <Pressable onPress={load} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
          <Text className="text-xs font-semibold text-red-600">Retry</Text>
        </Pressable>
      </Card>
    );
  }

  if (!engineers) {
    return (
      <View className="items-center py-8">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  if (engineers.length === 0) {
    return <EmptyState icon="construct-outline" iconColor="#9CA3AF" title="No site engineers yet" subtitle="Nothing to show here yet." />;
  }

  return (
    <Card style={{ paddingVertical: 4 }}>
      {engineers.map((engineer, i) => (
        <Pressable
          key={engineer.userId}
          onPress={() => router.push({ pathname: '/team-attendance-detail/[userId]', params: { userId: engineer.userId, fullName: engineer.fullName } })}
          className={`flex-row items-center justify-between py-3 ${i < engineers.length - 1 ? 'border-b border-neutral-100' : ''}`}
        >
          <View className="flex-1 pr-2">
            <Text className="text-sm font-semibold text-neutral-800">{engineer.fullName}</Text>
            <Text className="text-xs text-neutral-400 mt-0.5">
              {engineer.todayCheckInTime ? `In ${formatTime12h(engineer.todayCheckInTime)}` : 'No check-in today'}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View
              className="px-2 py-1 rounded-full"
              style={{ backgroundColor: engineer.todayCheckInTime ? '#EAF7EE' : '#FDECEC' }}
            >
              <Text className="text-2xs font-bold" style={{ color: engineer.todayCheckInTime ? '#16A34A' : '#DC2626' }}>
                {engineer.todayCheckInTime ? 'Present' : 'Absent'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color="#D4D4D4" />
          </View>
        </Pressable>
      ))}
    </Card>
  );
}

function ChecklistDueContent() {
  return (
    <Card style={{ paddingVertical: 4 }}>
      {DUMMY_CHECKLIST_DUE.map((row, i) => (
        <View
          key={row.name}
          className={`flex-row items-center justify-between py-3 ${i < DUMMY_CHECKLIST_DUE.length - 1 ? 'border-b border-neutral-100' : ''}`}
        >
          <Text className="text-sm font-semibold text-neutral-800 flex-1 pr-2">{row.name}</Text>
          <View className="px-2 py-1 rounded-full bg-status-warnBg">
            <Text className="text-2xs font-bold text-status-warn">Due in {row.dueInDays}d</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

function ReportsContent() {
  return (
    <>
      <Pressable onPress={() => router.push('/reports/general-parameter-report')}>
        <Card className="mb-3 flex-row items-center justify-between">
          <View className="flex-1 pr-2">
            <Text className="text-sm font-bold text-neutral-900">Task Based Report</Text>
            <Text className="text-xs text-neutral-400 mt-0.5">Checklist completion, delay, and quantity for one task</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </Card>
      </Pressable>
      <Pressable onPress={() => router.push({ pathname: '/reports/activity-report', params: { preset: 'week', title: 'Weekly Report' } } as never)}>
        <Card className="mb-3 flex-row items-center justify-between">
          <View className="flex-1 pr-2">
            <Text className="text-sm font-bold text-neutral-900">Weekly Report</Text>
            <Text className="text-xs text-neutral-400 mt-0.5">Tasks reported this week, with a cumulative % rollup</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </Card>
      </Pressable>
      <Pressable onPress={() => router.push({ pathname: '/reports/activity-report', params: { preset: 'month', title: 'Monthly Report' } } as never)}>
        <Card className="mb-3 flex-row items-center justify-between">
          <View className="flex-1 pr-2">
            <Text className="text-sm font-bold text-neutral-900">Monthly Report</Text>
            <Text className="text-xs text-neutral-400 mt-0.5">Tasks reported this month, with a cumulative % rollup</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </Card>
      </Pressable>
    </>
  );
}

// One screen per Home Overview category (Architect/Client/Consultant/
// Contractor/Vendor/Site Engineer) — pick a project first, then show
// whatever that category actually cares about: attendance for Site
// Engineer, a due-checklist list for the other stakeholder roles (Vendor/
// Contractor/Consultant/Architect — dummy for now, same "wire it up later"
// placeholder as the Home Overview counts), or the real Reports hub for
// Client (that one already exists and fits, so it's real, not a
// placeholder). A top-level Stack route (outside the Drawer group), same
// convention as reports.tsx/checklist-templates.tsx — back arrow, not the
// hamburger menu.
export default function TeamCategoryScreen() {
  const { state } = useAuth();
  const { category } = useLocalSearchParams<{ category: string }>();
  const { projects, setSelectedProjectId } = useProject();
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);

  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }

  const config = CATEGORY_CONFIG[category as CategorySlug];
  if (!config) {
    return <Redirect href="/home" />;
  }

  const pickedProject = projects.find((p) => p.id === pickedProjectId);

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title: config.title,
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />
      <ScrollView contentContainerClassName="px-4 pt-4 pb-8">
        {!pickedProject ? (
          <>
            <Text className="text-xs text-neutral-500 mb-4">Select a project to view {config.title.toLowerCase()} details.</Text>
            {projects.length === 0 ? (
              <EmptyState icon="briefcase-outline" iconColor="#9CA3AF" title="No projects yet" subtitle="Nothing to show here yet." />
            ) : (
              projects.map((p) => (
                <ProjectPickRow
                  key={p.id}
                  name={p.name}
                  onPress={() => {
                    setPickedProjectId(p.id);
                    setSelectedProjectId(p.id);
                  }}
                />
              ))
            )}
          </>
        ) : (
          <>
            <Pressable onPress={() => setPickedProjectId(null)} className="flex-row items-center gap-1.5 mb-4">
              <Ionicons name="chevron-back" size={14} color="#0F1F33" />
              <Text className="text-xs font-semibold text-neutral-500">{pickedProject.name} · change project</Text>
            </Pressable>
            {config.kind === 'attendance' && <AttendanceContent projectId={pickedProject.id} />}
            {config.kind === 'checklist' && <ChecklistDueContent />}
            {config.kind === 'reports' && <ReportsContent />}
            {config.kind === 'consultant-teams' && <ConsultantTeamsContent />}
          </>
        )}
      </ScrollView>
    </View>
  );
}
