import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { Pressable } from '../ui/Pressable';
import { router, useFocusEffect } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import Ionicons from '@expo/vector-icons/Ionicons';
import { isFieldRole, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchAllProjectStats, type ProjectStat } from '../../lib/projectStats';
import { fetchHomeToday, type DprToday, type HomeToday, type Metric } from '../../lib/homeToday';
import { todayDateKey } from '../../lib/dprEntries';
import { timeOfDayGreeting, firstName } from '../../lib/greeting';
import { useDependencyCompletionsRealtime } from '../../lib/dependencyCompletionsRealtime';
import { colors, radius, shadow, space } from '../../lib/theme';
import { haptic } from '../../lib/haptics';
import { useModalBottomPadding } from '../../lib/useSafeBottomOffset';
import { ProgressRing } from '../ui/ProgressRing';
import { EmptyState } from '../ui/EmptyState';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { ListRow, ListSection } from '../ui/List';
import { Screen } from '../ui/Screen';
import { SkeletonBlock, SkeletonCard } from '../ui/States';

// Staff Home (redesigned 2026-11-19, brief: .impeccable/surfaces/
// app-authenticated-home-tsx.md). One project's day: today's DPR first, then
// what's holding the site back, then what waits on the user or the client.
// Colour: logo orange only on the DPR action / progress and the project
// switcher's chevron; red only for open critical alerts and overdue; every
// other icon grey. All numbers are live (lib/homeToday.ts); no placeholder data.

const TAP = 48; // minimum tap target on this screen (outdoor use)

// ── Small building blocks ──────────────────────────────────────────────────

function Heading({ children }: { children: string }) {
  return (
    <AppText variant="section" accessibilityRole="header" style={{ marginTop: space.xl, marginBottom: space.sm, paddingHorizontal: 2 }}>
      {children}
    </AppText>
  );
}

// Project switcher, shown as the header title. Opens the Switch project sheet.
function HeaderProjectSwitcher({ name, onPress }: { name: string | null; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name ? `Project ${name}. Switch project` : 'Choose a project'}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: TAP,
        maxWidth: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: space.sm,
        marginLeft: -space.sm,
        borderRadius: radius.sm,
        backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent',
      })}
    >
      <AppText numberOfLines={1} style={{ flexShrink: 1, color: colors.textInverse, fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 17, lineHeight: 22 }}>
        {name ?? 'Choose a project'}
      </AppText>
      <Ionicons name="chevron-down" size={18} color={colors.amber} />
    </Pressable>
  );
}

type Tone = 'default' | 'critical' | 'muted';

// One live number: grey icon, label + short status line, the number on the
// right. Zero reads grey; only `critical` turns red.
function StatusRow({
  icon,
  title,
  value,
  detail,
  tone,
  failed,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
  detail: string;
  tone: Tone;
  failed?: boolean;
  onPress: () => void;
}) {
  const valueColor = failed || tone === 'muted' ? colors.textMuted : tone === 'critical' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${failed ? "couldn't load" : value}. ${failed ? '' : detail}`}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
      })}
    >
      <Ionicons name={icon} size={22} color={tone === 'critical' && !failed ? colors.danger : colors.textMuted} />
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" numberOfLines={2} style={{ marginTop: 1, color: failed ? colors.danger : colors.textMuted }}>
          {failed ? "Couldn't load" : detail}
        </AppText>
      </View>
      <AppText variant="title" numberOfLines={1} style={{ color: valueColor, fontVariant: ['tabular-nums'] }}>
        {failed ? '–' : value}
      </AppText>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <View style={[{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.md }, shadow.card]}>
      {children}
    </View>
  );
}

// ── Today's DPR ────────────────────────────────────────────────────────────

function DprCard({ metric }: { metric: Metric<DprToday> }) {
  const openDpr = () => router.push('/daily-updates');
  if (!metric.ok) {
    return (
      <Card>
        <AppText variant="section">Today&apos;s DPR</AppText>
        <AppText variant="body" style={{ color: colors.danger }}>
          Couldn&apos;t load today&apos;s DPR.
        </AppText>
        <Button label="Open DPR" variant="secondary" size="lg" onPress={openDpr} />
      </Card>
    );
  }
  const { due, submitted } = metric.value;
  if (due === 0) {
    return (
      <Card>
        <AppText variant="section">Today&apos;s DPR</AppText>
        <AppText variant="body" tone="muted">
          No DPR due today. Tasks show up here once their planned start date arrives.
        </AppText>
        <Button label="Open DPR" variant="secondary" size="lg" onPress={openDpr} />
      </Card>
    );
  }
  if (submitted >= due) {
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Ionicons name="checkmark-circle" size={24} color={colors.navy} />
          <AppText variant="section" style={{ flex: 1 }}>
            Today&apos;s DPR submitted
          </AppText>
          <AppText variant="bodyStrong" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
            {submitted} of {due}
          </AppText>
        </View>
        <Button label="View DPR" variant="secondary" size="lg" onPress={openDpr} />
      </Card>
    );
  }
  const pct = Math.round((submitted / due) * 100);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
        <AppText variant="section" style={{ flex: 1 }}>
          Today&apos;s DPR
        </AppText>
        <AppText variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {submitted} of {due} submitted
        </AppText>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: due, now: submitted }}
        style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}
      >
        <View style={{ width: `${pct}%`, height: 8, borderRadius: 4, backgroundColor: colors.amber }} />
      </View>
      <Button label="Submit today's DPR" variant="accent" size="lg" haptics="press" onPress={openDpr} />
    </Card>
  );
}

// ── Today on site / Pending ───────────────────────────────────────────────

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function workersDetail(w: { present: number; absent: number; total: number }): string {
  if (w.total === 0) return 'No workers added yet';
  const unmarked = w.total - w.present - w.absent;
  if (unmarked === 0 && w.absent === 0) return 'Everyone is present';
  const parts = [];
  if (w.absent > 0) parts.push(`${w.absent} absent`);
  if (unmarked > 0) parts.push(`${unmarked} not marked`);
  return parts.join(' · ');
}

function failedOf(...metrics: (Metric<unknown> | null | undefined)[]): string[] {
  return metrics.filter((m): m is { ok: false; error: string } => !!m && !m.ok).map((m) => m.error);
}

function LoadError({ all, onRetry }: { all: boolean; onRetry: () => void }) {
  return (
    <View
      accessibilityRole="alert"
      style={{ marginTop: space.lg, padding: space.lg, gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: '#F5C2C2', backgroundColor: colors.dangerSoft }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
        <AppText variant="bodyStrong" style={{ color: colors.danger, flex: 1 }}>
          {all ? "Couldn't load today's numbers" : "Some numbers couldn't load"}
        </AppText>
      </View>
      <AppText variant="body" tone="secondary">
        Check your internet connection, then retry.
      </AppText>
      <Button label="Retry" icon="refresh" variant="secondary" size="lg" onPress={onRetry} />
    </View>
  );
}

function TodaySkeleton({ withDpr }: { withDpr: boolean }) {
  return (
    <View accessibilityLabel="Loading today's numbers" style={{ marginTop: space.lg, gap: space.md }}>
      {withDpr && <SkeletonCard lines={3} />}
      <SkeletonBlock width="40%" height={18} style={{ marginTop: space.md }} />
      <SkeletonCard lines={4} />
    </View>
  );
}

// ── Projects (unchanged behaviour, quieter colours) ───────────────────────

function ProjectRow({ project, onPress }: { project: ProjectStat; onPress: () => void }) {
  const hasFlags = project.overdueTasks > 0 || project.pendingClientResponses > 0;
  return (
    <ListRow
      title={project.projectName}
      subtitle={`${project.completedTasks} of ${project.totalTasks} tasks done`}
      leading={<ProgressRing percent={project.progressPct} />}
      onPress={onPress}
      trailing={
        hasFlags ? (
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            {project.overdueTasks > 0 && <Pill tone="danger" label={`${project.overdueTasks} overdue`} />}
            {project.pendingClientResponses > 0 && <Pill tone="neutral" label={`${project.pendingClientResponses} pending`} />}
          </View>
        ) : undefined
      }
    />
  );
}

function Pill({ tone, label }: { tone: 'danger' | 'neutral'; label: string }) {
  const fg = tone === 'danger' ? colors.danger : colors.textSecondary;
  const bg = tone === 'danger' ? colors.dangerSoft : colors.surfaceMuted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: bg }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />
      <AppText variant="caption" style={{ color: fg, fontFamily: 'IBMPlexSans_600SemiBold' }}>
        {label}
      </AppText>
    </View>
  );
}

// Collapsed by default — a folder, not a permanently-open list, per explicit request.
function ProjectsFolder({ projects, onOpenProject }: { projects: ProjectStat[]; onOpenProject: (projectId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const total = projects.length + 1; // + PMC Portal
  return (
    <ListSection>
      <ListRow
        title="All projects"
        icon="folder-outline"
        iconColor={colors.textSecondary}
        iconBg={colors.surfaceMuted}
        chevron={false}
        accessibilityLabel={`All projects, ${total}. ${expanded ? 'Collapse' : 'Expand'}`}
        trailing={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <AppText variant="bodyStrong" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
              {total}
            </AppText>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
          </View>
        }
        onPress={() => setExpanded((v) => !v)}
      />
      {/* PMC Portal: tracks the app itself, not a site project. Opens its own
          screen (app/pmc-portal.tsx) instead of the project dashboard. */}
      {expanded && (
        <ListRow
          title="PMC Portal"
          subtitle="App Progress"
          icon="phone-portrait-outline"
          iconColor={colors.textSecondary}
          iconBg={colors.surfaceMuted}
          onPress={() => router.push('/pmc-portal')}
        />
      )}
      {expanded &&
        (projects.length === 0 ? (
          <EmptyState icon="briefcase-outline" iconColor={colors.textMuted} title="No projects yet" subtitle="Projects you're added to will show here." />
        ) : (
          projects.map((p) => <ProjectRow key={p.projectId} project={p} onPress={() => onOpenProject(p.projectId)} />)
        ))}
    </ListSection>
  );
}

function ProjectPickerSheet({
  visible,
  projects,
  selectedId,
  onPick,
  onClose,
  onOpenPmcPortal,
}: {
  visible: boolean;
  projects: { id: string; name: string }[];
  selectedId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  onOpenPmcPortal: () => void;
}) {
  // Last project row stays above the navigation bar; a long list scrolls.
  const bottomPad = useModalBottomPadding(space.lg);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,31,51,0.35)', justifyContent: 'flex-end' }} onPress={onClose} accessibilityLabel="Close">
        <Pressable onPress={() => {}} style={{ maxHeight: '85%', backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: space.lg }}>
          <AppText variant="section" style={{ marginBottom: space.md, paddingHorizontal: space.lg }}>
            Switch project
          </AppText>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: bottomPad }}>
            {projects.map((p) => {
              const active = p.id === selectedId;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    haptic.select();
                    onPick(p.id);
                  }}
                  style={({ pressed }) => ({
                    minHeight: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.md,
                    borderRadius: radius.sm,
                    backgroundColor: active ? colors.navySoft : pressed ? colors.surfaceMuted : 'transparent',
                  })}
                >
                  <Ionicons name="business-outline" size={20} color={active ? colors.navy : colors.textMuted} />
                  <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {p.name}
                  </AppText>
                  {active && <Ionicons name="checkmark" size={20} color={colors.navy} />}
                </Pressable>
              );
            })}
            {/* PMC Portal last: it opens its own screen, not a site project. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="PMC Portal"
              onPress={() => {
                haptic.select();
                onOpenPmcPortal();
              }}
              style={({ pressed }) => ({
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingHorizontal: space.md,
                borderRadius: radius.sm,
                backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
              })}
            >
              <Ionicons name="phone-portrait-outline" size={20} color={colors.textMuted} />
              <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                PMC Portal
              </AppText>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export function AppHome() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const { projects: projectOptions, selectedProjectId, setSelectedProjectId } = useProject();

  const isAdmin = profile?.role === 'admin';
  const isAdminOrManager = isAdmin || profile?.role === 'manager';
  // Same access rule as daily-updates.tsx (field role or admin).
  const withDpr = profile != null && (isFieldRole(profile.role) || isAdmin);

  // All-projects stats (projects folder + "Waiting on client").
  const [stats, setStats] = useState<Metric<ProjectStat[]> | null>(null);
  // Today's numbers, tagged with the project they belong to: after a project
  // switch the old project's numbers are never shown (skeleton until the new ones arrive).
  const [loaded, setLoaded] = useState<{ projectId: string; data: HomeToday } | null>(null);
  const today = loaded && loaded.projectId === selectedProjectId ? loaded.data : null;
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const requestId = useRef(0);

  const loadStats = useCallback(async () => {
    try {
      const { projects } = await fetchAllProjectStats();
      setStats({ ok: true, value: projects });
    } catch (err) {
      setStats({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const loadToday = useCallback(async () => {
    if (!selectedProjectId || !profile) return;
    const projectId = selectedProjectId;
    const id = ++requestId.current;
    let result: HomeToday;
    try {
      result = await fetchHomeToday({
        projectId,
        userId: profile.id,
        todayKey: todayDateKey(),
        withDpr,
        withEditRequests: isAdmin,
      });
    } catch (err) {
      // fetchHomeToday settles every number itself; this only guards the unexpected.
      const failed = { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      result = { dpr: withDpr ? failed : null, criticalAlerts: failed, checklist: failed, workers: failed, delayed: failed, editRequests: isAdmin ? failed : null };
    }
    // A slower answer for a project the user has since switched away from is dropped.
    if (id !== requestId.current) return;
    setLoaded({ projectId, data: result });
  }, [selectedProjectId, profile, withDpr, isAdmin]);

  // A checklist answer anywhere updates the stats live (as before).
  useDependencyCompletionsRealtime(loadStats);

  // Load (and reload) whenever Home comes into view, e.g. after submitting a
  // DPR, and when the project changes.
  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats])
  );
  useFocusEffect(
    useCallback(() => {
      loadToday();
    }, [loadToday])
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadStats(), loadToday()]);
    setRefreshing(false);
  }

  function retry() {
    loadStats();
    loadToday();
  }

  const greeting = `${timeOfDayGreeting()}, ${profile ? firstName(profile.fullName) : ''}`;
  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const selectedName = projectOptions.find((p) => p.id === selectedProjectId)?.name ?? null;
  const selectedStat = stats?.ok ? (stats.value.find((p) => p.projectId === selectedProjectId) ?? null) : null;

  const waitingOnClient: Metric<number> | null = !isAdminOrManager
    ? null
    : stats == null
      ? null
      : stats.ok
        ? { ok: true, value: selectedStat?.pendingClientResponses ?? 0 }
        : { ok: false, error: stats.error };

  const errors = today
    ? failedOf(today.dpr, today.criticalAlerts, today.checklist, today.workers, today.delayed, today.editRequests, waitingOnClient)
    : [];
  const metricCount = today ? [today.dpr, today.criticalAlerts, today.checklist, today.workers, today.delayed, today.editRequests, waitingOnClient].filter(Boolean).length : 0;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Drawer.Screen options={{ headerTitle: () => <HeaderProjectSwitcher name={selectedName} onPress={() => setPickerOpen(true)} /> }} />

      <View>
        <AppText variant="title" accessibilityRole="header">
          {greeting}
        </AppText>
        <AppText variant="caption" style={{ marginTop: 2 }}>
          {todayLabel}
        </AppText>
      </View>

      {!selectedProjectId ? (
        <View style={{ marginTop: space.lg }}>
          <Card>
            <AppText variant="section">Choose a project</AppText>
            <AppText variant="body" tone="muted">
              Pick the project you&apos;re working on to see today&apos;s DPR, alerts and attendance.
            </AppText>
            <Button label="Choose project" variant="primary" size="lg" onPress={() => setPickerOpen(true)} />
          </Card>
        </View>
      ) : !today ? (
        <TodaySkeleton withDpr={withDpr} />
      ) : (
        <>
          {errors.length > 0 && <LoadError all={errors.length === metricCount} onRetry={retry} />}

          {today.dpr && (
            <View style={{ marginTop: space.lg }}>
              <DprCard metric={today.dpr} />
            </View>
          )}

          <Heading>Today on site</Heading>
          <ListSection style={{ marginBottom: 0 }}>
            <StatusRow
              icon="warning-outline"
              title="Critical alerts"
              failed={!today.criticalAlerts.ok}
              value={today.criticalAlerts.ok ? String(today.criticalAlerts.value) : ''}
              detail={today.criticalAlerts.ok && today.criticalAlerts.value > 0 ? 'Waiting for you to acknowledge' : 'No critical alerts'}
              tone={today.criticalAlerts.ok && today.criticalAlerts.value > 0 ? 'critical' : 'muted'}
              onPress={() => router.push('/critical-alerts')}
            />
            <StatusRow
              icon="checkbox-outline"
              title="Checklist items pending"
              failed={!today.checklist.ok}
              value={today.checklist.ok ? String(today.checklist.value.pendingItems) : ''}
              detail={
                today.checklist.ok && today.checklist.value.pendingItems > 0
                  ? `${plural(today.checklist.value.tasksWaiting, 'task', 'tasks')} can't start until cleared`
                  : 'All checklists clear'
              }
              tone={today.checklist.ok && today.checklist.value.pendingItems > 0 ? 'default' : 'muted'}
              onPress={() => router.push({ pathname: '/reports/stakeholder-report', params: { title: 'Department Status' } })}
            />
            <StatusRow
              icon="people-outline"
              title="Workers present"
              failed={!today.workers.ok}
              value={today.workers.ok ? (today.workers.value.total > 0 ? `${today.workers.value.present} / ${today.workers.value.total}` : '0') : ''}
              detail={today.workers.ok ? workersDetail(today.workers.value) : ''}
              tone={today.workers.ok && today.workers.value.present > 0 ? 'default' : 'muted'}
              onPress={() => router.push('/team-attendance')}
            />
            <StatusRow
              icon="time-outline"
              title="Delayed tasks"
              failed={!today.delayed.ok}
              value={today.delayed.ok ? String(today.delayed.value) : ''}
              detail={today.delayed.ok && today.delayed.value > 0 ? 'Behind their planned dates' : 'No delayed tasks'}
              tone={today.delayed.ok && today.delayed.value > 0 ? 'default' : 'muted'}
              onPress={() => router.push('/gantt')}
            />
          </ListSection>

          {(today.editRequests || waitingOnClient) && (
            <>
              <Heading>Pending</Heading>
              <ListSection style={{ marginBottom: 0 }}>
                {today.editRequests && (
                  <StatusRow
                    icon="create-outline"
                    title="DPR edit requests"
                    failed={!today.editRequests.ok}
                    value={today.editRequests.ok ? String(today.editRequests.value) : ''}
                    detail={today.editRequests.ok && today.editRequests.value > 0 ? 'Waiting for your approval' : 'No edit requests'}
                    tone={today.editRequests.ok && today.editRequests.value > 0 ? 'default' : 'muted'}
                    onPress={() => router.push('/dpr-edit-requests')}
                  />
                )}
                {waitingOnClient && (
                  <StatusRow
                    icon="person-outline"
                    title="Waiting on client"
                    failed={!waitingOnClient.ok}
                    value={waitingOnClient.ok ? String(waitingOnClient.value) : ''}
                    detail={waitingOnClient.ok && waitingOnClient.value > 0 ? "Checklist answers the client hasn't given" : 'Nothing waiting on the client'}
                    tone={waitingOnClient.ok && waitingOnClient.value > 0 ? 'default' : 'muted'}
                    onPress={() => router.push({ pathname: '/reports/stakeholder-report', params: { category: 'client', title: 'Client Status' } })}
                  />
                )}
              </ListSection>
            </>
          )}
        </>
      )}

      <Heading>Your projects</Heading>
      {stats == null ? (
        <SkeletonCard lines={1} />
      ) : !stats.ok ? (
        <ListSection>
          <ListRow title="Couldn't load projects" subtitle="Pull down to refresh." icon="cloud-offline-outline" iconColor={colors.danger} iconBg={colors.dangerSoft} />
        </ListSection>
      ) : (
        <ProjectsFolder
          projects={stats.value}
          onOpenProject={(projectId) => {
            setSelectedProjectId(projectId);
            router.push('/project-dashboard');
          }}
        />
      )}

      <ProjectPickerSheet
        visible={pickerOpen}
        projects={projectOptions}
        selectedId={selectedProjectId}
        onClose={() => setPickerOpen(false)}
        onOpenPmcPortal={() => {
          setPickerOpen(false);
          router.push('/pmc-portal');
        }}
        onPick={(id) => {
          setSelectedProjectId(id);
          setPickerOpen(false);
        }}
      />
    </Screen>
  );
}
