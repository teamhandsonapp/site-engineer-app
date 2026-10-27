import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isFieldRole, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchAllProjectStats, type ProjectStat } from '../../lib/projectStats';
import { timeOfDayGreeting, firstName } from '../../lib/greeting';
import { useDependencyCompletionsRealtime } from '../../lib/dependencyCompletionsRealtime';
import { Card } from '../ui/Card';
import { ProgressRing } from '../ui/ProgressRing';
import { EmptyState } from '../ui/EmptyState';
import { QuickLink } from '../ui/QuickLink';

// Placeholder headcount-style strip — one row per team/role category, an
// icon chip + label on the left, count on the right. Each category gets its
// own fixed color so rows read apart at a glance without relying on the
// label text alone; Critical Alerts keeps the app's one reserved
// urgent/critical red (status.urgent) rather than a generic identity hue, so
// it never gets mistaken for "just another category." Values are hardcoded
// placeholders; real counts get wired up later.
const CATEGORY_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; slug: string }> = {
  Architect: { icon: 'compass-outline', color: '#7C3AED', slug: 'architect' },
  Client: { icon: 'person-outline', color: '#2563EB', slug: 'client' },
  Consultant: { icon: 'bulb-outline', color: '#0D9488', slug: 'consultant' },
  Contractor: { icon: 'hammer-outline', color: '#EA580C', slug: 'contractor' },
  Vendor: { icon: 'cart-outline', color: '#DB2777', slug: 'vendor' },
  'Site Engineer': { icon: 'construct-outline', color: '#16A34A', slug: 'site-engineer' },
};

const TEAM_COUNTS: { label: string; value: number }[] = [
  { label: 'Architect', value: 4 },
  { label: 'Client', value: 12 },
  { label: 'Consultant', value: 6 },
  { label: 'Contractor', value: 9 },
  { label: 'Vendor', value: 15 },
  { label: 'Site Engineer', value: 22 },
];

// Each row opens /team/[category] — a project-pick step, then the view
// that category actually cares about (attendance for Site Engineer, a
// due-checklist list for Vendor/Contractor/Consultant/Architect, the real
// Reports hub for Client). See app/team/[category].tsx.
function CountStrip({ items }: { items: { label: string; value: number }[] }) {
  return (
    <Card style={{ paddingVertical: 4 }}>
      {items.map((item, i) => {
        const meta = CATEGORY_META[item.label];
        return (
          <Pressable
            key={item.label}
            onPress={() => router.push(`/team/${meta.slug}`)}
            className={`flex-row items-center justify-between py-3 ${i < items.length - 1 ? 'border-b border-neutral-100' : ''}`}
          >
            <View className="flex-row items-center gap-3">
              <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${meta.color}1F` }}>
                <Ionicons name={meta.icon} size={15} color={meta.color} />
              </View>
              <Text className="text-sm font-semibold text-neutral-800">{item.label}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              {/* tabular-nums — this is a column of numbers stacked
                  vertically that should line up, unlike a lone hero figure. */}
              <Text className="text-md font-extrabold text-neutral-900" style={{ fontVariant: ['tabular-nums'] }}>
                {item.value}
              </Text>
              <Ionicons name="chevron-forward" size={15} color="#D4D4D4" />
            </View>
          </Pressable>
        );
      })}
    </Card>
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

// Collapsed by default — a folder, not a permanently-open list, per
// explicit request. Same "Pressable header with count + chevron, tap to
// reveal" convention as NotificationsScreen's own CategorySection, rather
// than inventing a new expand/collapse pattern for this one spot.
function ProjectsFolder({
  projects,
  onOpenProject,
}: {
  projects: ProjectStat[];
  onOpenProject: (projectId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <Card style={{ paddingVertical: 4 }}>
        <Pressable onPress={() => setExpanded((v) => !v)} className="flex-row items-center justify-between py-3">
          <View className="flex-row items-center gap-3">
            <View className="w-8 h-8 rounded-lg items-center justify-center bg-neutral-100">
              <Ionicons name="folder-outline" size={16} color="#57534E" />
            </View>
            <Text className="text-sm font-semibold text-neutral-800">Your Projects</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <Text className="text-xs font-bold text-neutral-400" style={{ fontVariant: ['tabular-nums'] }}>{projects.length}</Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color="#D4D4D4" />
          </View>
        </Pressable>
      </Card>
      {expanded && (
        <View className="mt-2.5">
          {projects.length === 0 ? (
            <EmptyState icon="briefcase-outline" iconColor="#9CA3AF" title="No projects yet" subtitle="Nothing to show here yet." />
          ) : (
            projects.map((p) => <ProjectRow key={p.projectId} project={p} onPress={() => onOpenProject(p.projectId)} />)
          )}
        </View>
      )}
    </View>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { projects: p } = await fetchAllProjectStats();
      setProjects(p);
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
      <Text className="text-xl font-extrabold text-neutral-900 mb-5">{greeting}</Text>

      {error && (
        <Card className="mb-3 border-red-200 bg-red-50">
          <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
          <Pressable onPress={load} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </Card>
      )}

      {/* Right here on Home itself, not one tap away behind a project card
          — the explicit point of this section. Notifications, Gantt Chart,
          and Flowchart were removed from here by explicit request (still
          reachable from the sidebar) — everything left already handles an
          unselected project on its own, so no project-picker prompt is
          needed here anymore. First section on the page, per explicit
          reorder request (was last). */}
      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Quick Links</Text>
      <QuickLink icon="warning-outline" label="Critical Alerts" color="#DC2626" onPress={() => router.push('/critical-alerts')} />
      <QuickLink icon="checkbox-outline" label="Checklist" color="#0284C7" onPress={() => router.push('/checklist-templates')} />
      {/* Home isn't project-scoped, so this lands on Files' project picker. */}
      <QuickLink icon="folder-open-outline" label="Files" color="#2563EB" onPress={() => router.push({ pathname: '/files', params: { projectId: '' } })} />
      {/* Same access rule as daily-updates.tsx's own gate (field role or
          admin specifically, not manager) — no point linking someone
          straight to its "Not available for this account". */}
      {(profile != null && (isFieldRole(profile.role) || profile.role === 'admin')) && (
        <QuickLink icon="document-text-outline" label="DPR" color="#0F1F33" onPress={() => router.push('/daily-updates')} />
      )}

      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5 mt-6">Overview</Text>
      <View className="mb-6">
        <CountStrip items={TEAM_COUNTS} />
      </View>

      {/* Collapsed folder, not a permanently-open list — per explicit
          request. Last section on the page (was first). */}
      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Projects</Text>
      <ProjectsFolder projects={projects} onOpenProject={openProject} />
    </ScrollView>
  );
}
