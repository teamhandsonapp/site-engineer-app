import { Redirect } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { useAuth } from '../../lib/AuthContext';
import { AppDrawerContent } from '../../components/DrawerContent';
import { NotificationBell } from '../../components/NotificationBell';

export default function AuthenticatedLayout() {
  const { state } = useAuth();

  // Session-restore loading/error states are already handled by the root
  // AuthGate (app/_layout.tsx) before this layout can ever mount — by the
  // time this renders, state is only ever 'signed-in' or 'signed-out' in
  // practice. Redirecting on anything else is a safe fallback, not a real
  // code path (e.g. the theoretically-unreachable 'error' case, or a
  // real-time sign-out while already deep in the app).
  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }

  return (
    <Drawer
      drawerContent={(props) => <AppDrawerContent {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: '#0F1F33' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '500' },
        drawerStyle: { backgroundColor: '#0F1F33', width: 264 },
        // Registered once here (not per-screen) so the bell — and its badge
        // count — stays visible and consistent across every drawer screen,
        // not just Home.
        headerRight: () => <NotificationBell />,
      }}
    >
      <Drawer.Screen name="home" options={{ title: 'Home', drawerLabel: 'Home' }} />
      <Drawer.Screen name="gantt" options={{ title: 'Gantt Chart', drawerLabel: 'Gantt Chart' }} />
      <Drawer.Screen name="flowchart" options={{ title: 'Flowchart', drawerLabel: 'Flowchart' }} />
      {/* Nested under Flowchart in the drawer (DrawerContent.tsx), same
          demoted position as Checklist Templates under Template Kit — a
          flat, searchable, virtualized alternative view of the exact same
          task data (lib/flowchart/data.ts's fetchFlowchartData), for
          quickly locating one task by name/code rather than panning/
          zooming the graph. */}
      <Drawer.Screen name="task-list" options={{ title: 'Task List', drawerLabel: 'Task List' }} />
      <Drawer.Screen name="critical-alerts" options={{ title: 'Critical Alerts', drawerLabel: 'Critical Alerts' }} />
      <Drawer.Screen name="daily-updates" options={{ title: 'Daily Updates', drawerLabel: 'Daily Updates' }} />
      <Drawer.Screen name="attendance" options={{ title: 'Attendance', drawerLabel: 'Attendance' }} />
      {/* Sections 1-2 — the map trail + checklist view of the field role's
          OWN day, built on top of attendance/leave/geofence/red-zone data
          that already exists once check-in has happened. Same field-role-
          only gate as "attendance" above (DrawerContent.tsx's
          FIELD_ROLE_ONLY_ROUTES). */}
      <Drawer.Screen name="day-timeline" options={{ title: 'Day Timeline', drawerLabel: 'Day Timeline' }} />
      {/* Admin/manager's own team-wide attendance review — a different
          screen from "attendance" above (that one is the field role's own
          check-in/out button), same drawerLabel since the two are mutually
          exclusive per role (see DrawerContent.tsx's FIELD_ROLE_ONLY_ROUTES
          / ADMIN_MANAGER_ONLY_ROUTES split) and never shown to the same
          account at once. */}
      <Drawer.Screen name="team-attendance" options={{ title: 'Attendance', drawerLabel: 'Attendance' }} />
      {/* New admin tab — a rollup of every engineer's "Leave" events across
          every project/day, distinct from Critical Alerts (which is about
          system-detected boundary/red-zone/tracking events, not manually
          logged trips) — named to avoid that confusion. Admin/manager only,
          same gate as team-attendance/access-roles/invoices. */}
      <Drawer.Screen name="leave-log" options={{ title: 'Leave Log', drawerLabel: 'Leave Log' }} />
      <Drawer.Screen name="access-roles" options={{ title: 'Access & Roles', drawerLabel: 'Access & Roles' }} />
      <Drawer.Screen name="invoices" options={{ title: 'Invoices', drawerLabel: 'Invoices' }} />
      <Drawer.Screen name="settings" options={{ title: 'Settings', drawerLabel: 'Settings' }} />
    </Drawer>
  );
}
