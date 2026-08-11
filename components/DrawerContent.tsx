import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DrawerContentComponentProps } from 'expo-router/drawer';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Logo } from './Logo';
import { appRoleFor, isFieldRole, roleLabel, useAuth } from '../lib/AuthContext';

// Renders "Not available for this account" for a client role (see its own
// isStaff check) — showing it in the drawer anyway would just be a menu
// item that dead-ends the moment a client taps it, so it's filtered out
// here rather than relying on the screen's own gate as the only defense.
const STAFF_ONLY_ROUTES = new Set(['critical-alerts', 'daily-updates']);

// A registered Drawer.Screen (unlike Template Kit/Checklist Templates
// below, which aren't Drawer screens at all) — kept out of the generic
// per-route loop entirely so it can be rendered once, in its own indented
// position under Flowchart, instead of also getting a normal top-level row
// from the loop.
const NESTED_ROUTES = new Set(['task-list']);

// Attendance's check-in/out button is about the field role's OWN presence
// on site — admin/manager have no reason to use it themselves (their view
// of everyone's attendance is admin-web's own /attendance review page),
// same defense-in-depth reasoning as STAFF_ONLY_ROUTES above.
const FIELD_ROLE_ONLY_ROUTES = new Set(['attendance', 'day-timeline']);

// Access & Roles and Invoices are admin/manager-only (Part 3.5's own words:
// "only users with sufficient access... should be able to reach this
// screen at all") — hidden here for everyone else, same defense-in-depth
// reasoning as STAFF_ONLY_ROUTES above. The real enforcement is server-side
// in the manage-user/send-invoice Edge Functions (which check the caller's
// role themselves), not this filter — this just keeps the menu itself from
// offering a screen/action a lower-access account would get rejected from
// anyway.
const ADMIN_MANAGER_ONLY_ROUTES = new Set(['access-roles', 'invoices', 'settings', 'team-attendance', 'leave-log']);

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: 'home-outline',
  gantt: 'bar-chart-outline',
  flowchart: 'git-network-outline',
  'critical-alerts': 'warning-outline',
  'daily-updates': 'document-text-outline',
  attendance: 'finger-print-outline',
  'day-timeline': 'map-outline',
  'task-list': 'list-outline',
  'team-attendance': 'finger-print-outline',
  'leave-log': 'airplane-outline',
  'access-roles': 'people-outline',
  invoices: 'receipt-outline',
  settings: 'settings-outline',
};

export function AppDrawerContent(props: DrawerContentComponentProps) {
  const { state, descriptors, navigation } = props;
  const { state: authState, signOut } = useAuth();
  const profile = authState.status === 'signed-in' ? authState.profile : null;
  const initials = (profile?.fullName || profile?.email || '?').trim().charAt(0).toUpperCase();
  const isClient = profile != null && appRoleFor(profile.role) === 'client';
  const isAdminOrManager = profile != null && (profile.role === 'admin' || profile.role === 'manager');
  const isField = profile != null && isFieldRole(profile.role);

  // Sub-items (Task List/Template Kit/Checklist Templates under Flowchart,
  // Task/Weekly/Monthly Report under Reports) used to always render open —
  // real feedback wanted them collapsed by default, a folder that only
  // expands on tap, not a permanently-expanded list. Keyed by a fixed
  // section id ('flowchart'/'reports'), not route name, since Reports has
  // no host route of its own to key off. Collapsed (false/absent) by
  // default every fresh mount — deliberately not persisted, same
  // session-only convention as FlowchartCanvas's own isUnlocked reset.
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  function toggleSection(key: string) {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleLogOut() {
    await signOut();
    router.replace('/login');
  }

  return (
    <View className="flex-1 bg-brand-navy">
      {/* Brand bar */}
      <View className="flex-row items-center gap-3 border-b border-white/10 px-4 pt-14 pb-4">
        <Logo size={28} />
        <Text className="text-md font-bold tracking-tight text-white">PMC Portal</Text>
      </View>

      {/* Profile */}
      <View className="flex-row items-center gap-3 border-b border-white/10 px-4 py-4">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-brand-amber/20">
          <Text className="text-sm font-bold text-brand-amber">{initials}</Text>
        </View>
        <View className="flex-1">
          <Text numberOfLines={1} className="text-base font-medium text-white">
            {profile?.fullName || profile?.email || 'Unknown user'}
          </Text>
          {/* white/65 (~7.2:1 on the navy bg) — was white/40 (~3.8:1),
              below the 4.5:1 AA minimum. Computed, not eyeballed. */}
          {profile && <Text className="text-xs text-white/65 mt-0.5">{roleLabel(profile.role)}</Text>}
        </View>
      </View>

      {/* Nav */}
      <View className="flex-1 px-3 pt-5">
        {/* white/55 (~5.9:1) — was white/30 (~2.7:1), a clear AA failure. */}
        <Text className="px-2 pb-2 text-2xs font-bold uppercase tracking-[1.4px] text-white/55">
          Menu
        </Text>
        <View className="gap-1">
          {state.routes.map((route, index) => {
            if (isClient && STAFF_ONLY_ROUTES.has(route.name)) return null;
            if (!isField && FIELD_ROLE_ONLY_ROUTES.has(route.name)) return null;
            if (!isAdminOrManager && ADMIN_MANAGER_ONLY_ROUTES.has(route.name)) return null;
            if (NESTED_ROUTES.has(route.name)) return null;
            const { options } = descriptors[route.key];
            // For staff specifically, "home" is re-pointed at the CURRENT
            // project's own dashboard rather than the drawer's own home.tsx
            // (which now just relays to the top-level, sidebar-less
            // /app-home — see Part 6). Landing back on the global
            // multi-project picker from three screens deep inside one
            // project (e.g. Flowchart) skipped a level real feedback wanted
            // kept: project context first, "back to all projects" (already
            // a real button on that screen) second. A client's one project
            // has no such distinction — home.tsx already renders ClientHome
            // directly for them — so this only changes staff's behavior.
            const isStaffHome = route.name === 'home' && !isClient;
            const label = isStaffHome ? 'Project Dashboard' : ((options.drawerLabel ?? options.title ?? route.name) as string);
            const focused = state.index === index;
            const icon = ICONS[route.name] ?? 'ellipse-outline';
            // Only Flowchart has sub-items right now (Task List/Template
            // Kit/Checklist Templates) — the chevron only appears where
            // there's actually something to collapse/expand.
            const hasChildren = route.name === 'flowchart';
            const sectionExpanded = hasChildren && !!expandedSections[route.name];

            return (
              <View key={route.key}>
                <Pressable
                  onPress={() => (isStaffHome ? router.push('/project-dashboard') : navigation.navigate(route.name))}
                  className="flex-row items-center gap-3 rounded-xl px-3"
                  style={{ minHeight: 44, backgroundColor: focused ? 'rgba(240,162,39,0.14)' : 'transparent' }}
                >
                  <Ionicons
                    name={icon}
                    size={18}
                    color={focused ? '#F0A227' : 'rgba(255,255,255,0.55)'}
                  />
                  <Text
                    className="text-base font-medium flex-1"
                    style={{ color: focused ? '#F0A227' : 'rgba(255,255,255,0.8)' }}
                  >
                    {label}
                  </Text>
                  {hasChildren && (
                    <Pressable hitSlop={10} onPress={() => toggleSection(route.name)}>
                      <Ionicons
                        name={sectionExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color="rgba(255,255,255,0.45)"
                      />
                    </Pressable>
                  )}
                </Pressable>

                {/* Flowchart Template Kit isn't a registered Drawer.Screen
                    (it's a top-level route, browse+apply only reachable
                    before this via a Project Dashboard quick-link) — real
                    feedback wanted it reachable from the sidebar directly,
                    not buried a level deeper. Rendered right after
                    Flowchart itself (same conceptual group) rather than via
                    the state.routes loop above, since there's no actual
                    route entry to map over. Staff-only, matching the
                    screen's own isStaff gate — no point offering a client a
                    menu item that just dead-ends.

                    Checklist Templates is nested directly inside this same
                    block (not its own independent `flowchart`-gated block
                    anymore) — it's a genuine sub-item of Template Kit now,
                    not of Flowchart, so its render is structurally tied to
                    Template Kit's own presence rather than coincidentally
                    following it. Same indented/dash-marker demotion as
                    before, just relocated one level down. The global AC/AV
                    checklist editor itself is unchanged — only its
                    position/parent in this list moved. */}
                {/* Task List — a real Drawer.Screen (registered in
                    app/(authenticated)/_layout.tsx, unlike Template Kit/
                    Checklist Templates below), just excluded from the loop
                    above (NESTED_ROUTES) and rendered here instead, right
                    after Flowchart's own row, so it keeps the Drawer's
                    normal screen lifecycle (freeze/resume on tab switch)
                    while still reading as a demoted sub-item visually. Same
                    audience as Flowchart itself (no !isClient gate) —
                    unlike Template Kit, it's a read-only alternate view of
                    data a client can already see in the graph. */}
                {route.name === 'flowchart' && sectionExpanded && (() => {
                  const taskListRoute = state.routes.find((r) => r.name === 'task-list');
                  if (!taskListRoute) return null;
                  const taskListFocused = state.routes[state.index]?.name === 'task-list';
                  return (
                    <Pressable
                      onPress={() => navigation.navigate('task-list')}
                      className="flex-row items-center gap-2.5 rounded-xl pr-3"
                      style={{ minHeight: 36, paddingLeft: 30, backgroundColor: taskListFocused ? 'rgba(240,162,39,0.14)' : 'transparent' }}
                    >
                      <Text style={{ color: 'rgba(255,255,255,0.35)' }}>—</Text>
                      <Text className="text-sm font-medium" style={{ color: taskListFocused ? '#F0A227' : 'rgba(255,255,255,0.65)' }}>
                        Task List
                      </Text>
                    </Pressable>
                  );
                })()}

                {route.name === 'flowchart' && sectionExpanded && !isClient && (
                  <>
                    <Pressable
                      onPress={() => router.push('/flowchart-templates')}
                      className="flex-row items-center gap-3 rounded-xl px-3"
                      style={{ minHeight: 44, backgroundColor: 'transparent' }}
                    >
                      <Ionicons name="albums-outline" size={18} color="rgba(255,255,255,0.55)" />
                      <Text className="text-base font-medium" style={{ color: 'rgba(255,255,255,0.8)' }}>
                        Template Kit
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => router.push('/checklist-templates')}
                      className="flex-row items-center gap-2.5 rounded-xl pr-3"
                      style={{ minHeight: 36, paddingLeft: 30 }}
                    >
                      <Text style={{ color: 'rgba(255,255,255,0.35)' }}>—</Text>
                      <Text className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>
                        Checklist Templates
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            );
          })}

          {/* Reports — visible to BOTH staff and client (unlike Template Kit
              above, no isClient gate: a client can view their own project's
              reports, matching admin-web's separate client-facing Client
              Progress Report precedent). Same 44px-parent + 36px-demoted-
              sub-row visual as Template Kit -> Checklist Templates, just
              with 2 children instead of 1. Reports has no host route to
              piggyback on the way Template Kit rides along with 'flowchart',
              so it's rendered as its own block here instead. */}
          <View>
            <Pressable
              onPress={() => router.push('/reports')}
              className="flex-row items-center gap-3 rounded-xl px-3"
              style={{ minHeight: 44, backgroundColor: 'transparent' }}
            >
              <Ionicons name="stats-chart-outline" size={18} color="rgba(255,255,255,0.55)" />
              <Text className="text-base font-medium flex-1" style={{ color: 'rgba(255,255,255,0.8)' }}>
                Reports
              </Text>
              <Pressable hitSlop={10} onPress={() => toggleSection('reports')}>
                <Ionicons
                  name={expandedSections.reports ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="rgba(255,255,255,0.45)"
                />
              </Pressable>
            </Pressable>

            {expandedSections.reports && (
              <>
                <Pressable
                  onPress={() => router.push('/reports/task-report')}
                  className="flex-row items-center gap-2.5 rounded-xl pr-3"
                  style={{ minHeight: 36, paddingLeft: 30 }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.35)' }}>—</Text>
                  <Text className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>
                    Task Report
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => router.push('/reports/weekly-report')}
                  className="flex-row items-center gap-2.5 rounded-xl pr-3"
                  style={{ minHeight: 36, paddingLeft: 30 }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.35)' }}>—</Text>
                  <Text className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>
                    Weekly Report
                  </Text>
                </Pressable>

                {/* Already a real, working screen (app/reports/monthly-report.tsx,
                    also listed on the Reports hub page) — just never added here
                    alongside its two siblings. */}
                <Pressable
                  onPress={() => router.push('/reports/monthly-report')}
                  className="flex-row items-center gap-2.5 rounded-xl pr-3"
                  style={{ minHeight: 36, paddingLeft: 30 }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.35)' }}>—</Text>
                  <Text className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>
                    Monthly Report
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>

      {/* Logout */}
      <View className="border-t border-white/10 px-3 py-3">
        <Pressable onPress={handleLogOut} className="flex-row items-center gap-3 rounded-xl px-3" style={{ minHeight: 44 }}>
          <Ionicons name="log-out-outline" size={18} color="rgba(255,255,255,0.65)" />
          <Text className="text-base font-medium text-white/80">Log Out</Text>
        </Pressable>
      </View>
    </View>
  );
}
