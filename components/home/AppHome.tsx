import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { isFieldRole, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchAllProjectStats, type ProjectStat } from '../../lib/projectStats';
import { timeOfDayGreeting, firstName } from '../../lib/greeting';
import { useDependencyCompletionsRealtime } from '../../lib/dependencyCompletionsRealtime';
import { colors, radius, shadow, space } from '../../lib/theme';
import { haptic } from '../../lib/haptics';
import { useModalBottomPadding } from '../../lib/useSafeBottomOffset';
import { ProgressRing } from '../ui/ProgressRing';
import { EmptyState } from '../ui/EmptyState';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { ListRow, ListSection, SectionHeader } from '../ui/List';
import { Screen } from '../ui/Screen';
import { InlineError, SkeletonBlock, SkeletonList } from '../ui/States';

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
function OverviewList({ items }: { items: { label: string; value: number }[] }) {
  return (
    <ListSection title="Overview">
      {items.map((item) => {
        const meta = CATEGORY_META[item.label];
        return (
          <ListRow
            key={item.label}
            title={item.label}
            icon={meta.icon}
            iconColor={meta.color}
            iconBg={`${meta.color}1A`}
            value={item.value}
            onPress={() => router.push(`/team/${meta.slug}`)}
            accessibilityLabel={`${item.label}: ${item.value}`}
          />
        );
      })}
    </ListSection>
  );
}

// 2x2 quick-action tiles — bigger targets and far less empty space than the
// old full-width rows.
function QuickTile({ icon, label, color, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [
        {
          flexBasis: '47%',
          flexGrow: 1,
          minHeight: 92,
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          padding: space.md,
          justifyContent: 'space-between',
        },
        shadow.card,
      ]}
    >
      <View style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: `${color}1A`, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      {/* Two lines so "Critical Alerts" isn't cut off at large font sizes. */}
      <AppText variant="bodyStrong" numberOfLines={2}>
        {label}
      </AppText>
    </Pressable>
  );
}

// A progress RING anchors each row, plus a real task count and, when
// relevant, overdue / pending pills (same status colours as alert cards).
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
            {project.pendingClientResponses > 0 && <Pill tone="warning" label={`${project.pendingClientResponses} pending`} />}
          </View>
        ) : undefined
      }
    />
  );
}

function Pill({ tone, label }: { tone: 'danger' | 'warning'; label: string }) {
  const fg = tone === 'danger' ? colors.danger : colors.warning;
  const bg = tone === 'danger' ? colors.dangerSoft : colors.warningSoft;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: bg }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />
      <AppText variant="caption" style={{ color: fg, fontFamily: 'IBMPlexSans_600SemiBold' }}>
        {label}
      </AppText>
    </View>
  );
}

// Collapsed by default — a folder, not a permanently-open list, per
// explicit request.
function ProjectsFolder({ projects, onOpenProject, showPmcPortal }: { projects: ProjectStat[]; onOpenProject: (projectId: string) => void; showPmcPortal: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const total = projects.length + (showPmcPortal ? 1 : 0);
  return (
    <ListSection title="Projects">
      <ListRow
        title="Your Projects"
        icon="folder-outline"
        iconColor={colors.textSecondary}
        iconBg={colors.surfaceMuted}
        chevron={false}
        accessibilityLabel={`Your projects, ${total}. ${expanded ? 'Collapse' : 'Expand'}`}
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
      {expanded && showPmcPortal && (
        <ListRow
          title="PMC Portal"
          subtitle="App Progress"
          icon="phone-portrait-outline"
          iconColor="#F0A227"
          iconBg="#F0A2271A"
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

// Current project, shown under the greeting; tap to switch.
function ProjectChip({ name, onPress }: { name: string | null; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name ? `Current project ${name}. Change project` : 'Choose a project'}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: pressed ? colors.navySoft : colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        maxWidth: '100%',
      })}
    >
      <Ionicons name="business-outline" size={15} color={colors.navy} />
      <AppText variant="label" tone="brand" numberOfLines={1} style={{ flexShrink: 1 }}>
        {name ?? 'Choose a project'}
      </AppText>
      <Ionicons name="chevron-down" size={14} color={colors.navy} />
    </Pressable>
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
          {/* PMC Portal first: it opens its own screen, not a site project. */}
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
            <Ionicons name="phone-portrait-outline" size={18} color="#F0A227" />
            <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              PMC Portal
            </AppText>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
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
                <Ionicons name="business" size={18} color={colors.navy} />
                <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                  {p.name}
                </AppText>
                {active && <Ionicons name="checkmark" size={18} color={colors.navy} />}
              </Pressable>
            );
          })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HomeSkeleton() {
  return (
    <View style={{ padding: space.lg }}>
      <SkeletonBlock width="60%" height={24} />
      <SkeletonBlock width="35%" height={14} style={{ marginTop: space.sm, marginBottom: space.xl }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.xl }}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} width="47%" height={92} style={{ flexGrow: 1, borderRadius: radius.md }} />
        ))}
      </View>
      <SkeletonList rows={5} />
    </View>
  );
}

// The App Home landing screen for staff — greeting, quick actions, team
// overview and the projects folder. Data and navigation are unchanged from
// before; only the layout was redesigned.
export function AppHome() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const { projects: projectOptions, selectedProjectId, setSelectedProjectId } = useProject();

  const [projects, setProjects] = useState<ProjectStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  // Same live-refresh convention as before — a status change anywhere
  // immediately updates the stats.
  useDependencyCompletionsRealtime(load);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const greeting = `${timeOfDayGreeting()}, ${profile ? firstName(profile.fullName) : ''}`;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const selectedName = projectOptions.find((p) => p.id === selectedProjectId)?.name ?? null;
  const showDpr = profile != null && (isFieldRole(profile.role) || profile.role === 'admin');

  function openProject(projectId: string) {
    setSelectedProjectId(projectId);
    router.push('/project-dashboard');
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <HomeSkeleton />
      </View>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ marginBottom: space.xl, gap: space.sm }}>
        <View>
          <AppText variant="title" accessibilityRole="header">
            {greeting}
          </AppText>
          <AppText variant="caption" style={{ marginTop: 2 }}>
            {today}
          </AppText>
        </View>
        {projectOptions.length > 0 && <ProjectChip name={selectedName} onPress={() => setPickerOpen(true)} />}
      </View>

      {error && (
        <View style={{ marginBottom: space.lg, gap: space.sm }}>
          <InlineError message={`Couldn't load project stats — ${error}`} />
          <Button label="Try again" icon="refresh" variant="secondary" size="sm" onPress={load} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}

      {/* Quick links — first section on the page, per explicit request. */}
      <SectionHeader title="Quick links" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.xl }}>
        <QuickTile icon="warning-outline" label="Critical Alerts" color={colors.danger} onPress={() => router.push('/critical-alerts')} />
        <QuickTile icon="checkbox-outline" label="Checklist" color="#0284C7" onPress={() => router.push('/checklist-templates')} />
        {/* Home isn't project-scoped, so this lands on Files' project picker. */}
        <QuickTile icon="folder-open-outline" label="Files" color="#2563EB" onPress={() => router.push({ pathname: '/files', params: { projectId: '' } })} />
        {/* Same access rule as daily-updates.tsx (field role or admin). */}
        {showDpr && <QuickTile icon="document-text-outline" label="DPR" color={colors.navy} onPress={() => router.push('/daily-updates')} />}
      </View>

      <OverviewList items={TEAM_COUNTS} />

      <ProjectsFolder
        projects={projects}
        onOpenProject={openProject}
        showPmcPortal
      />

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
