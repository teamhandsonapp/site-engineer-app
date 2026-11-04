import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { DrawerContentComponentProps } from 'expo-router/drawer';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Logo } from './Logo';
import { NewProjectModal } from './NewProjectModal';
import { appRoleFor, isFieldRole, roleLabel, useAuth } from '../lib/AuthContext';
import { useProject } from '../lib/ProjectContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSafeBottomOffset } from '../lib/useSafeBottomOffset';

// Renders "Not available for this account" for a client role (see its own
// isStaff check) — showing it in the drawer anyway would just be a menu
// item that dead-ends the moment a client taps it, so it's filtered out
// here rather than relying on the screen's own gate as the only defense.
// Documents is here too — every non-client staff role can view/assign a
// document to a task; only the Upload action inside the screen itself is
// further narrowed to admin (see documents.tsx's own isAdmin check).
const STAFF_ONLY_ROUTES = new Set(['critical-alerts', 'documents', 'project-contacts']);

// Attendance's check-in/out button is about the field role's OWN presence
// on site — admin/manager have no reason to use it themselves (their view
// of everyone's attendance is admin-web's own /attendance review page),
// same defense-in-depth reasoning as STAFF_ONLY_ROUTES above. DPR (daily-
// updates) is admin's OWN exception below — see the filter loop — since
// admin now also views/edits/submits DPR from mobile, by explicit request
// (there's one shared dpr_entries row per task+day, not per-user, so
// admin editing it is the same record a site engineer filled in).
const FIELD_ROLE_ONLY_ROUTES = new Set(['attendance', 'day-timeline', 'daily-updates', 'completed-tasks']);

// Access & Roles and Invoices are admin/manager-only (Part 3.5's own words:
// "only users with sufficient access... should be able to reach this
// screen at all") — hidden here for everyone else, same defense-in-depth
// reasoning as STAFF_ONLY_ROUTES above. The real enforcement is server-side
// in the manage-user/send-invoice Edge Functions (which check the caller's
// role themselves), not this filter — this just keeps the menu itself from
// offering a screen/action a lower-access account would get rejected from
// anyway.
const ADMIN_MANAGER_ONLY_ROUTES = new Set(['access-roles', 'invoices', 'settings', 'devices', 'team-attendance', 'engineer-attendance', 'leave-log', 'notifications']);

// Stricter than ADMIN_MANAGER_ONLY_ROUTES above — Contact Book is
// admin-only per its own requirement, explicitly excluding manager/site
// roles — enforced by contacts.tsx's own isAdmin check plus the contacts
// table's admin-only RLS policies (add-contacts.sql), this is just the
// same defense-in-depth menu filter as every other set here.
const ADMIN_ONLY_ROUTES = new Set(['contacts', 'dpr-edit-requests']);

// gantt.tsx and flowchart.tsx are still real files under app/(authenticated)/,
// so Expo Router auto-registers them as drawer routes regardless of whether
// a <Drawer.Screen> declares options for them — removing that declaration
// only drops the label/icon, not the route itself. Filtered out here so they
// no longer show up as raw "gantt"/"flowchart" rows in the menu.
// dpr-edit-requests is rendered as a sub-item under DPR instead (by
// explicit request), so it's hidden as its own top-level row.
// leave-log likewise sits under Attendance (team-attendance) as a sub-item,
// and mom (Minutes of Meeting) under Meeting.
const HIDDEN_ROUTES = new Set(['gantt', 'flowchart', 'task-list', 'critical-alerts', 'dpr-edit-requests', 'leave-log', 'engineer-attendance', 'devices', 'mom']);

// Top-level rows that carry collapsible sub-items (parent route -> children).
const SUBMENUS: Record<string, { route: string; label: string }[]> = {
  'daily-updates': [{ route: 'dpr-edit-requests', label: 'Edit Requests' }],
  settings: [{ route: 'devices', label: 'Devices & Logins' }],
  meetings: [{ route: 'mom', label: 'MoM' }],
  'team-attendance': [
    { route: 'engineer-attendance', label: 'Site Engineer Attendance' },
    { route: 'leave-log', label: 'Leave Log' },
  ],
};

// Reports submenu — restructured (by explicit request) into "Report by
// time" (Daily/Weekly/Monthly/Custom duration) + stakeholder/department
// reports (Architect/Client/Vendor/Department/Contractor), all under the
// one Reports entry, and ALL nine sharing one parameterized screen
// (app/reports/activity-report.tsx) — Weekly/Monthly/Custom used to point
// at their own older, due_date-based screens, but by explicit follow-up
// request they now behave exactly like Day Report (real DPR-submission
// list + cumulative % rollup), just over a longer default window. See that
// screen's own header comment for why this needed a new report engine.
const REPORT_SUBMENU: { label: string; href: string; params?: Record<string, string>; staffOnly?: boolean }[] = [
  { label: 'Status by time — Daily', href: '/reports/activity-report', params: { preset: 'day', title: 'Daily Status' } },
  { label: 'Status by time — Weekly', href: '/reports/activity-report', params: { preset: 'week', title: 'Weekly Status' } },
  { label: 'Status by time — Monthly', href: '/reports/activity-report', params: { preset: 'month', title: 'Monthly Status' } },
  { label: 'Status by time — Custom duration', href: '/reports/activity-report', params: { preset: 'custom', title: 'Custom Date-Range Status' } },
  // Live snapshot — pending checklist inputs + downstream delay impact —
  // not a date-range list, so these point at a different screen/engine
  // from the 4 above (see stakeholder-report.tsx's own header comment).
  { label: 'Architect Status', href: '/reports/stakeholder-report', params: { category: 'architect', title: 'Architect Status' } },
  { label: 'Client Status', href: '/reports/stakeholder-report', params: { category: 'client', title: 'Client Status' } },
  { label: 'Vendor Status', href: '/reports/stakeholder-report', params: { category: 'procurement', title: 'Vendor Status' } },
  { label: 'Department Status', href: '/reports/stakeholder-report', params: { title: 'Department Status' } },
  { label: 'Contractor Status', href: '/reports/stakeholder-report', params: { category: 'contractor', title: 'Contractor Status' } },
  // One engineer's attendance + DPR history (lib/reports/siteEngineerReport.ts)
  // — staffOnly: unlike the Report-by-X screens above, this surfaces an
  // individual engineer's check-in times/scores, internal staff-performance
  // data rather than a client-facing progress view, so it's filtered out
  // for a client the same way STAFF_ONLY_ROUTES filters top-level routes
  // below (the screen itself also redirects a client as defense-in-depth).
  { label: 'Site Engineer Status', href: '/reports/site-engineer-report', staffOnly: true },
  { label: 'Task Based Status', href: '/reports/general-parameter-report' },
];

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: 'home-outline',
  notifications: 'notifications-outline',
  'critical-alerts': 'warning-outline',
  'daily-updates': 'document-text-outline',
  'completed-tasks': 'checkmark-done-outline',
  attendance: 'finger-print-outline',
  'day-timeline': 'map-outline',
  'task-list': 'list-outline',
  'team-attendance': 'finger-print-outline',
  'leave-log': 'airplane-outline',
  'access-roles': 'people-outline',
  invoices: 'receipt-outline',
  settings: 'settings-outline',
  devices: 'phone-portrait-outline',
  contacts: 'call-outline',
  documents: 'folder-open-outline',
  files: 'folder-outline',
  meetings: 'people-circle-outline',
  mom: 'clipboard-outline',
};

export function AppDrawerContent(props: DrawerContentComponentProps) {
  const { state, descriptors, navigation } = props;
  const { state: authState, signOut } = useAuth();
  const profile = authState.status === 'signed-in' ? authState.profile : null;
  const initials = (profile?.fullName || profile?.email || '?').trim().charAt(0).toUpperCase();
  const isClient = profile != null && appRoleFor(profile.role) === 'client';
  const isAdminOrManager = profile != null && (profile.role === 'admin' || profile.role === 'manager');
  const isAdmin = profile != null && profile.role === 'admin';
  const isField = profile != null && isFieldRole(profile.role);
  const { projects, selectedProjectId, setSelectedProjectId, reload: reloadProjects } = useProject();
  const [newProjectModalVisible, setNewProjectModalVisible] = useState(false);

  // Sub-items (Task/Weekly/Monthly Report under Reports) used to always
  // render open — real feedback wanted them collapsed by default, a folder
  // that only expands on tap, not a permanently-expanded list. Keyed by a
  // fixed section id ('reports'), not route name, since Reports has no host
  // route of its own to key off. Collapsed (false/absent) by default every
  // fresh mount — deliberately not persisted.
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  function toggleSection(key: string) {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function openProject(projectId: string) {
    setSelectedProjectId(projectId);
    router.push('/project-dashboard');
  }

  async function handleLogOut() {
    await signOut();
    router.replace('/login');
  }

  // Logout gets EXTRA clearance beyond the shared baseline (not just the
  // hook's own floor) — an explicit ask, not a guess: "move it up enough
  // that it is comfortably clear... with visible margin, not just
  // technically un-clipped by a pixel or two." Logout is also the one
  // control here it's genuinely costly to mis-tap (signs the user out),
  // so it gets the largest margin of any bottom-anchored element in the
  // app rather than the generic default.
  const bottomPadding = useSafeBottomOffset(20);
  // Real top inset instead of a fixed pt-14 — notch (iPhone 13, 47pt) and
  // Dynamic Island (iPhone 17 Pro Max, ~62pt) phones differ, and a fixed
  // value either crowds the island or leaves a gap on older phones.
  const { top: topInset } = useSafeAreaInsets();

  return (
    // overflow-hidden — same web-only flex-min-size fix as GestureHandlerRootView
    // in app/_layout.tsx: without it, this panel could grow past the
    // drawer's real height once the menu list got long, pushing Log Out
    // below the fold instead of letting the Nav ScrollView below scroll
    // internally.
    <View className="flex-1 bg-brand-navy overflow-hidden">
      {/* Brand bar */}
      {/* Breathing room under the status bar/punch-hole: Android 15 draws
          the app edge-to-edge (e.g. CMF Phone 2 Pro), so topInset is the
          status bar itself — +24 keeps the brand clear of it like the
          system's own apps do, instead of butting against the clock. */}
      <View className="flex-row items-center gap-3 border-b border-white/10 px-5 pb-5" style={{ paddingTop: Math.max(topInset, 20) + 24 }}>
        <Logo size={38} />
        <View>
          <Text className="text-md font-bold tracking-tight text-white">PMC Portal</Text>
          <Text className="text-2xs text-white/55 mt-0.5">Construction management</Text>
        </View>
      </View>

      {/* Profile */}
      <View className="flex-row items-center gap-3 border-b border-white/10 px-5 py-4">
        {/* Plain solid-colour avatar with the user's initial — by explicit
            request, replacing the old per-role emoji (looked odd). */}
        <View className="h-9 w-9 items-center justify-center rounded-full bg-brand-amber">
          <Text className="text-sm font-bold text-brand-navy">{initials}</Text>
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

      {/* Nav — a ScrollView, not a plain View: an admin/manager account
          sees enough menu items (plus Reports' own 3 sub-items) that this
          list can genuinely be taller than the screen on a shorter device
          (confirmed live on a Redmi 13C 5G) — a fixed View just clips
          whatever doesn't fit, with no way to reach it. Logout below is
          deliberately OUTSIDE this ScrollView (its own fixed footer, not
          just the last scrollable item) so it's always reachable
          regardless of how tall the menu above it grows, rather than
          requiring a scroll to find it — the more robust fix for an
          action this important, not just "now it's technically reachable
          if you scroll all the way down." */}
      <ScrollView className="flex-1" contentContainerClassName="px-3 pt-5 pb-4">
        {/* white/55 (~5.9:1) — was white/30 (~2.7:1), a clear AA failure. */}
        <Text className="px-2 pb-2 text-2xs font-bold uppercase tracking-[1.4px] text-white/55">
          Menu
        </Text>
        <View className="gap-1">
          {state.routes.map((route, index) => {
            if (isClient && STAFF_ONLY_ROUTES.has(route.name)) return null;
            if (!isField && !(isAdmin && route.name === 'daily-updates') && FIELD_ROLE_ONLY_ROUTES.has(route.name)) return null;
            if (!isAdminOrManager && ADMIN_MANAGER_ONLY_ROUTES.has(route.name)) return null;
            if (!isAdmin && ADMIN_ONLY_ROUTES.has(route.name)) return null;
            // Admin reaches Specific Book from inside Contact Book instead
            // of as its own top-level menu row (by explicit request) — but
            // it stays a normal top-level row for everyone else, since
            // non-admin staff don't have Contact Book in their menu at all
            // and would otherwise lose access to it entirely.
            if (isAdmin && route.name === 'project-contacts') return null;
            if (HIDDEN_ROUTES.has(route.name)) return null;
            const { options } = descriptors[route.key];
            // "Home" used to bounce staff OUT of the drawer to a sidebar-
            // less /project-dashboard (Part 6) — the drawer is now visible
            // from the moment the home screen loads (home.tsx is itself
            // the cross-project overview for staff), so Home behaves like
            // every other route again: navigate within the drawer, no
            // special-casing. A client's Home (ClientHome) was already
            // unaffected either way.
            const label = (options.drawerLabel ?? options.title ?? route.name) as string;
            const focused = state.index === index;
            const icon = ICONS[route.name] ?? 'ellipse-outline';
            // Edit Requests under DPR (admin only); Leave Log under
            // Attendance (team-attendance is already admin/manager only).
            const submenu = SUBMENUS[route.name];
            const hasSubmenu = submenu != null && (route.name !== 'daily-updates' || isAdmin);
            const focusedRouteName = state.routes[state.index]?.name;
            const childFocused = submenu != null && submenu.some((c) => c.route === focusedRouteName);
            const submenuOpen = hasSubmenu && (expandedSections[route.name] || childFocused);

            return (
              <View key={route.key}>
                <Pressable
                  // Files from the menu always starts at its project picker
                  // (a project dashboard opens it with a projectId instead).
                  onPress={() => (route.name === 'files' ? navigation.navigate('files', { projectId: undefined }) : navigation.navigate(route.name))}
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
                  {hasSubmenu && (
                    <Pressable hitSlop={10} onPress={() => toggleSection(route.name)}>
                      <Ionicons
                        name={submenuOpen ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color="rgba(255,255,255,0.45)"
                      />
                    </Pressable>
                  )}
                </Pressable>

                {submenuOpen &&
                  submenu?.map((child) => {
                    const active = focusedRouteName === child.route;
                    return (
                      <Pressable
                        key={child.route}
                        onPress={() => navigation.navigate(child.route)}
                        className="flex-row items-center gap-2.5 rounded-xl pr-3"
                        style={{ minHeight: 36, paddingLeft: 30, backgroundColor: active ? 'rgba(240,162,39,0.14)' : 'transparent' }}
                      >
                        <Text style={{ color: 'rgba(255,255,255,0.35)' }}>—</Text>
                        <Text className="text-sm font-medium" style={{ color: active ? '#F0A227' : 'rgba(255,255,255,0.65)' }}>
                          {child.label}
                        </Text>
                      </Pressable>
                    );
                  })}

                {/* Template Kit isn't a registered Drawer.Screen (it's a
                    top-level route, browse+apply only reachable before this
                    via a Project Dashboard quick-link) — rendered here right
                    after Notifications, by explicit request, instead of as
                    its own block after the whole loop. Staff-only, matching
                    the screen's own isStaff gate — no point offering a
                    client a menu item that just dead-ends. */}
                {route.name === 'notifications' && !isClient && (
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
                )}
              </View>
            );
          })}

          {/* Projects — a drawer-level switcher for the shared
              useProject() selection (lib/ProjectContext.tsx), same
              expand/collapse shell as Reports below. Staff-only: a client's
              `projects` list is always empty (their one project is fixed to
              profile.clientProjectId), so there'd be nothing to pick from. */}
          {!isClient && (
            <View>
              <Pressable
                onPress={() => toggleSection('projects')}
                className="flex-row items-center gap-3 rounded-xl px-3"
                style={{ minHeight: 44, backgroundColor: 'transparent' }}
              >
                <Ionicons name="briefcase-outline" size={18} color="rgba(255,255,255,0.55)" />
                <Text className="text-base font-medium flex-1" style={{ color: 'rgba(255,255,255,0.8)' }}>
                  Projects
                </Text>
                <Ionicons
                  name={expandedSections.projects ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="rgba(255,255,255,0.45)"
                />
              </Pressable>

              {expandedSections.projects && (
                <>
                  {projects.map((p) => {
                    const active = p.id === selectedProjectId;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => openProject(p.id)}
                        className="flex-row items-center gap-2.5 rounded-xl pr-3"
                        style={{ minHeight: 36, paddingLeft: 30, backgroundColor: active ? 'rgba(240,162,39,0.14)' : 'transparent' }}
                      >
                        <Text style={{ color: 'rgba(255,255,255,0.35)' }}>—</Text>
                        <Text
                          numberOfLines={1}
                          className="text-sm font-medium flex-1"
                          style={{ color: active ? '#F0A227' : 'rgba(255,255,255,0.65)' }}
                        >
                          {p.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {/* Admin-only — matches the projects table's own
                      "projects insertable by admin" RLS policy
                      (add-projects-insert-by-admin.sql); project creation
                      previously only existed on admin-web. */}
                  {isAdmin && (
                    <Pressable
                      onPress={() => setNewProjectModalVisible(true)}
                      className="flex-row items-center gap-2.5 rounded-xl pr-3"
                      style={{ minHeight: 36, paddingLeft: 30 }}
                    >
                      <Ionicons name="add-circle-outline" size={16} color="#F0A227" />
                      <Text className="text-sm font-semibold" style={{ color: '#F0A227' }}>
                        Add New Project
                      </Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          )}

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
                Status
              </Text>
              <Pressable hitSlop={10} onPress={() => toggleSection('reports')}>
                <Ionicons
                  name={expandedSections.reports ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="rgba(255,255,255,0.45)"
                />
              </Pressable>
            </Pressable>

            {expandedSections.reports &&
              REPORT_SUBMENU.filter((item) => !item.staffOnly || !isClient).map((item) => (
                <Pressable
                  key={item.label}
                  onPress={() => router.push((item.params ? { pathname: item.href, params: item.params } : item.href) as never)}
                  className="flex-row items-center gap-2.5 rounded-xl pr-3"
                  style={{ minHeight: 36, paddingLeft: 30 }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.35)' }}>—</Text>
                  <Text className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
          </View>
        </View>
      </ScrollView>

      {/* Logout — deliberately a sibling of the ScrollView above, not its
          last item, so it stays visible without scrolling regardless of
          menu length. paddingBottom uses the real safe-area inset (gesture
          nav bar height varies by device) rather than a fixed guess, same
          convention as FlowchartCanvas's own zoom controls. */}
      <View className="border-t border-white/10 px-3 pt-3" style={{ paddingBottom: bottomPadding }}>
        <Pressable onPress={handleLogOut} className="flex-row items-center gap-3 rounded-xl px-3" style={{ minHeight: 44 }}>
          <Ionicons name="log-out-outline" size={18} color="rgba(255,255,255,0.65)" />
          <Text className="text-base font-medium text-white/80">Log Out</Text>
        </Pressable>
      </View>

      <NewProjectModal
        visible={newProjectModalVisible}
        onClose={() => setNewProjectModalVisible(false)}
        onCreated={(projectId) => {
          reloadProjects();
          openProject(projectId);
        }}
      />
    </View>
  );
}
