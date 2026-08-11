import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchAllProjectStats, type GlobalStats, type ProjectStat } from '../../lib/projectStats';
import { timeOfDayGreeting, firstName } from '../../lib/greeting';
import { useDependencyCompletionsRealtime } from '../../lib/dependencyCompletionsRealtime';
import { Card } from '../ui/Card';
import { ProgressRing } from '../ui/ProgressRing';
import { EmptyState } from '../ui/EmptyState';

// Icon sits in its own soft-tinted chip (accentColor at ~13% alpha, RN's
// native #RRGGBBAA support) instead of floating bare over the card — carries
// the stat's color identity on its own, so the card no longer also needs
// Card's left-border accent (two signals for one piece of information).
function StatCard({
  icon,
  label,
  value,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ width: '47%' }}>
      <Card style={{ paddingVertical: 14 }}>
        <View className="w-9 h-9 rounded-xl items-center justify-center mb-3" style={{ backgroundColor: `${color}22` }}>
          <Ionicons name={icon} size={17} color={color} />
        </View>
        <Text className="text-2xl font-extrabold text-neutral-900">{value}</Text>
        <Text className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mt-1">{label}</Text>
      </Card>
    </Pressable>
  );
}

// A progress RING (not a thin linear bar) anchors each row — enough visual
// weight to read as the row's hero element at a glance — plus a real task
// count and, when relevant, the same overdue/pending semantics already
// established for alert cards elsewhere (status.urgent/warn — see
// tailwind.config.js's own comment on why that vocabulary exists), not new
// ad-hoc colors invented just for this row.
function ProjectRow({ project, onPress }: { project: ProjectStat; onPress: () => void }) {
  const hasFlags = project.overdueTasks > 0 || project.pendingClientResponses > 0;
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-2.5 flex-row items-center">
        <ProgressRing percent={project.progressPct} />
        <View className="flex-1 ml-3.5 pr-2">
          <Text className="text-md font-bold text-neutral-900" numberOfLines={1}>{project.projectName}</Text>
          <Text className="text-xs text-neutral-400 mt-0.5" numberOfLines={1}>
            {project.completedTasks} of {project.totalTasks} tasks done
          </Text>
          {hasFlags && (
            <View className="flex-row items-center gap-1.5 mt-2">
              {project.overdueTasks > 0 && (
                <View className="flex-row items-center gap-1 px-1.5 py-0.5 rounded-full bg-status-urgentBg">
                  <View className="w-1.5 h-1.5 rounded-full bg-status-urgent" />
                  <Text className="text-2xs font-bold text-status-urgent">{project.overdueTasks} overdue</Text>
                </View>
              )}
              {project.pendingClientResponses > 0 && (
                <View className="flex-row items-center gap-1 px-1.5 py-0.5 rounded-full bg-status-warnBg">
                  <View className="w-1.5 h-1.5 rounded-full bg-status-warn" />
                  <Text className="text-2xs font-bold text-status-warn">{project.pendingClientResponses} pending</Text>
                </View>
              )}
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color="#D4D4D4" />
      </Card>
    </Pressable>
  );
}

// The App Home landing screen for staff — global, cross-project stats plus
// a project picker, replacing the previous project-agnostic "pending
// client responses" feed (that exact feed still exists, just one tap away
// now, at /critical-alerts — this screen summarizes it as a stat card
// instead of duplicating the full list inline).
export function AppHome() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const { setSelectedProjectId } = useProject();

  const [projects, setProjects] = useState<ProjectStat[]>([]);
  const [global, setGlobal] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { projects: p, global: g } = await fetchAllProjectStats();
      setProjects(p);
      setGlobal(g);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Same live-refresh convention as the previous StaffHome feed — a status
  // change anywhere immediately updates the stat cards, not just whichever
  // screen someone happens to be on.
  useDependencyCompletionsRealtime(load);

  const greeting = `${timeOfDayGreeting()}, ${profile ? firstName(profile.fullName) : ''}`;

  function openProject(projectId: string) {
    setSelectedProjectId(projectId);
    router.push('/project-dashboard');
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-neutral-50" contentContainerClassName="px-4 pt-5 pb-10">
      {/* The personalized greeting carries the page's real hero weight now
          (it's the one line that's actually specific to this person/moment)
          — "Overview" was competing with it as a second, more generic
          heading right below; demoted to a plain subtitle instead of
          dropped outright, so the screen still reads as "a summary" at a
          glance. */}
      <Text className="text-xl font-extrabold text-neutral-900 mb-1">{greeting}</Text>
      <Text className="text-sm text-neutral-400 mb-5">Here&apos;s how things are looking across your projects.</Text>

      {error && (
        <Card className="mb-3 border-red-200 bg-red-50">
          <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
          <Pressable onPress={load} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </Card>
      )}

      {global && (
        <>
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Overview</Text>
          <View className="flex-row flex-wrap justify-between gap-y-3 mb-6">
            <StatCard
              icon="briefcase-outline"
              label="Total Projects"
              value={global.totalProjects}
              color="#1C3358"
              onPress={() => {}}
            />
            <StatCard
              icon="chatbox-ellipses-outline"
              label="Pending Client Responses"
              value={global.totalPendingClientResponses}
              color="#B45309"
              onPress={() => router.push('/critical-alerts')}
            />
            <StatCard
              icon="cart-outline"
              label="Overdue Procurement"
              value={global.totalOverdueProcurement}
              color="#DC2626"
              onPress={() => router.push('/critical-alerts')}
            />
            <StatCard
              icon="warning-outline"
              label="Critical Alerts"
              value={global.totalCriticalAlerts}
              color="#DC2626"
              onPress={() => router.push('/critical-alerts')}
            />
          </View>
        </>
      )}

      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Your Projects</Text>
      {projects.length === 0 ? (
        <EmptyState icon="briefcase-outline" iconColor="#9CA3AF" title="No projects yet" subtitle="Nothing to show here yet." />
      ) : (
        projects.map((p) => <ProjectRow key={p.projectId} project={p} onPress={() => openProject(p.projectId)} />)
      )}
    </ScrollView>
  );
}
