import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isFieldRole, useAuth } from '../lib/AuthContext';
import { useProject } from '../lib/ProjectContext';
import { fetchAllProjectStats, findProjectStat, type ProjectStat } from '../lib/projectStats';
import { Card } from '../components/ui/Card';
import { QuickLink } from '../components/ui/QuickLink';
import { EmptyState } from '../components/ui/EmptyState';

// Same tinted-icon-chip treatment as App Home's own stat cards (Part 5) —
// this screen looked noticeably plainer than Home right next to it once
// that pass shipped, having been built earlier and never revisited.
function StatTile({ icon, label, value, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; color: string }) {
  return (
    <Card style={{ width: '47%', paddingVertical: 14 }}>
      <View className="w-9 h-9 rounded-xl items-center justify-center mb-3" style={{ backgroundColor: `${color}22` }}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <Text className="text-2xl font-extrabold text-neutral-900">{value}</Text>
      <Text className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mt-1">{label}</Text>
    </Card>
  );
}

// Reached only from App Home (tapping a project sets ProjectContext's
// selectedProjectId, then pushes this screen) — a top-level Stack screen,
// not a drawer item, matching /task/[taskId]'s same "detail view with a
// real back action" pattern rather than being one more drawer entry.
export default function ProjectDashboardScreen() {
  const { state } = useAuth();
  const { selectedProjectId, projects } = useProject();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isAdminOrManager = profile != null && (profile.role === 'admin' || profile.role === 'manager');
  const isField = profile != null && isFieldRole(profile.role);
  // Both routes are conceptually "Attendance," but they're two entirely
  // different screens gated to disjoint roles (FIELD_ROLE_ONLY_ROUTES vs
  // ADMIN_MANAGER_ONLY_ROUTES in DrawerContent.tsx) — a site_engineer
  // tapping a link hardcoded to admin's team-attendance screen landed on
  // its own "Not available for this account" dead end. Neither route for
  // a role that's neither (e.g. client) — Quick Links already isn't shown
  // to them in practice since this screen isn't part of their nav, but
  // this stays a safe null either way rather than guessing.
  const attendanceHref = isAdminOrManager ? '/team-attendance' : isField ? '/attendance' : null;

  const [stat, setStat] = useState<ProjectStat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      setError(null);
      const { projects: all } = await fetchAllProjectStats();
      setStat(findProjectStat(all, selectedProjectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }

  // No project chosen yet (e.g. a cold relaunch with router state restored
  // straight to this route) — send back to App Home to pick one, rather
  // than rendering a dashboard for nothing.
  if (!selectedProjectId) {
    return <Redirect href="/home" />;
  }

  const projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? stat?.projectName ?? 'Project';

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title: projectName,
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          // hitSlop alone does NOT expand the real tappable area on web —
          // confirmed live via elementsFromPoint: a plain 22x22 icon with
          // hitSlop={12} still only registers taps within its own literal
          // 22x25 rendered box; anything just past that (well within where
          // hitSlop should have extended it) hit the header background
          // instead, not the button. Real padding on the Pressable itself
          // is what actually grows the hit-tested box, not an invisible
          // slop RN-web doesn't apply the same way native does.
          headerLeft: () => (
            <Pressable onPress={() => router.replace('/home')} hitSlop={8} style={{ padding: 11 }}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>
          ),
        }}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : error ? (
        <View className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
          <Pressable onPress={load} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      ) : !stat ? (
        <EmptyState icon="briefcase-outline" iconColor="#9CA3AF" title="No data yet" subtitle="This project doesn't have any tasks to summarize yet." />
      ) : (
        <ScrollView contentContainerClassName="px-4 pt-4 pb-10">
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Overview</Text>
          <View className="flex-row flex-wrap justify-between gap-y-3">
            <StatTile icon="stats-chart-outline" label="Overall Progress" value={`${stat.progressPct}%`} color="#1C3358" />
            <StatTile icon="alert-circle-outline" label="Overdue Tasks" value={String(stat.overdueTasks)} color="#DC2626" />
            <StatTile icon="chatbox-ellipses-outline" label="Pending Client Responses" value={String(stat.pendingClientResponses)} color="#B45309" />
            <StatTile icon="cart-outline" label="Procurement Due Soon" value={String(stat.procurementDueSoon)} color="#F59E0B" />
          </View>

          <View className="flex-row items-center gap-2 mt-4 mb-1">
            <View className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
              <View className="h-full rounded-full bg-brand-amber" style={{ width: `${stat.progressPct}%` }} />
            </View>
            <Text className="text-2xs font-bold text-neutral-400">{stat.completedTasks}/{stat.totalTasks}</Text>
          </View>
          <Text className="text-xs text-neutral-400 mb-2">
            {stat.completedTasks} of {stat.totalTasks} tasks completed.
          </Text>

          {/* This screen sits OUTSIDE the drawer navigator (same pattern as
              /task/[taskId] — a stack screen with a real back action, not
              one more drawer item), so there's no hamburger/menu here to
              jump into Gantt/Flowchart/Alerts the way there is from Home.
              These quick-links are the direct path instead — each still
              lands on the same drawer-wrapped screen (its own header keeps
              the normal menu button), now correctly scoped to this project
              via the shared ProjectContext regardless of how it was reached. */}
          <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mt-4 mb-2.5">Quick Links</Text>
          {/* Critical Alerts, Files and DPR pinned to the top, by explicit
              request. Flowchart Template Kit was removed from this screen
              (still in the side menu). */}
          {/* Workforce + Site Engineer Attendance pinned at the very top for
              admin/manager, by explicit request. */}
          {isAdminOrManager && (
            <>
              <QuickLink icon="people-outline" label="Workforce Attendance" color="#16A34A" onPress={() => router.push('/team-attendance')} />
              <QuickLink icon="finger-print-outline" label="Site Engineer Attendance" color="#0891B2" onPress={() => router.push('/engineer-attendance')} />
            </>
          )}
          <QuickLink icon="warning-outline" label="Critical Alerts" color="#DC2626" onPress={() => router.push('/critical-alerts')} />
          <QuickLink
            icon="folder-open-outline"
            label="Files"
            color="#2563EB"
            onPress={() => selectedProjectId && router.push({ pathname: '/files', params: { projectId: selectedProjectId } })}
          />
          {/* Same access rule as daily-updates.tsx's own gate (field role
              or admin specifically, not manager) — no point linking
              someone straight to its "Not available for this account". */}
          {(isField || profile?.role === 'admin') && (
            <QuickLink icon="document-text-outline" label="DPR" color="#0F1F33" onPress={() => router.push('/daily-updates')} />
          )}
          <QuickLink icon="people-circle-outline" label="Meeting" color="#2563EB" onPress={() => router.push('/meetings')} />
          <QuickLink icon="clipboard-outline" label="MoM" color="#0D9488" onPress={() => router.push('/mom')} />
          {/* This project's own contact book (project-contacts, scoped to
              selectedProjectId — already set to this project). Staff-only,
              same as that screen's drawer gate. */}
          {(isAdminOrManager || isField) && (
            <QuickLink icon="call-outline" label="Contact Book" color="#0D9488" onPress={() => router.push('/project-contacts')} />
          )}
          <QuickLink icon="bar-chart-outline" label="Gantt Chart" color="#1C3358" onPress={() => router.push('/gantt')} />
          <QuickLink icon="git-network-outline" label="Flowchart" color="#F0A227" onPress={() => router.push('/flowchart')} />
          {/* Field roles' own check-in screen (admin/manager get the two
              attendance links at the top instead). */}
          {isField && !isAdminOrManager && attendanceHref && (
            <QuickLink icon="finger-print-outline" label="Attendance" color="#16A34A" onPress={() => router.push(attendanceHref)} />
          )}
          {isAdminOrManager && (
            <QuickLink icon="settings-outline" label="Settings" color="#0F1F33" onPress={() => router.push('/settings')} />
          )}
        </ScrollView>
      )}
    </View>
  );
}
