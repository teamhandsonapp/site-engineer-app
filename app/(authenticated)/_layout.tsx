import { Redirect } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { isFieldRole, useAuth } from '../../lib/AuthContext';
import { AppDrawerContent } from '../../components/DrawerContent';
import { NotificationBell } from '../../components/NotificationBell';
import { CriticalAlertPopup } from '../../components/CriticalAlertPopup';
import { useDeviceHeartbeat } from '../../lib/deviceActivity';

export default function AuthenticatedLayout() {
  const { state } = useAuth();
  useDeviceHeartbeat(state.status === 'signed-in' ? state.profile.id : null);

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
    <>
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
      {/* Cross-project notification center — every unresolved alert across
          EVERY project, not scoped to selectedProjectId like Critical
          Alerts. Staff-only (DrawerContent.tsx's STAFF_ONLY_ROUTES) — the
          underlying data (zone/boundary/lockout alerts about engineers)
          isn't something a client account should see, same reasoning as
          critical-alerts being staff-only. */}
      <Drawer.Screen name="notifications" options={{ title: 'Notifications', drawerLabel: 'Notifications' }} />
      <Drawer.Screen name="task-list" options={{ title: 'Task List', drawerLabel: 'Task List' }} />
      <Drawer.Screen name="critical-alerts" options={{ title: 'Critical Alerts', drawerLabel: 'Critical Alerts' }} />
      {/* Field-role only (site_engineer/senior_site_engineer, DrawerContent.
          tsx's FIELD_ROLE_ONLY_ROUTES) — filling in a daily report is the
          field role's own job; admin/manager would only ever land on a
          read-only screen with nothing to do. */}
      <Drawer.Screen name="daily-updates" options={{ title: 'Daily Progress Report', drawerLabel: 'DPR' }} />
      {/* Point 6 — a separate, read-only tab from the DPR form itself
          (daily-updates), not a section inside it. Same field-role-only
          gate as daily-updates above. */}
      <Drawer.Screen name="completed-tasks" options={{ title: 'Completed Tasks', drawerLabel: 'Completed Tasks' }} />
      {/* Project files organised into folders (Drawings, Transmittal, RA
          Bills, Quotes) — dummy data for now, see files.tsx. */}
      <Drawer.Screen name="files" options={{ title: 'Files', drawerLabel: 'Files' }} />
      {/* Meeting / MoM (Minutes of Meeting) — placeholder tabs for now,
          content still to be specified. MoM is a sub-item under Meeting in the
          drawer (DrawerContent.tsx SUBMENUS), not its own top-level row. */}
      <Drawer.Screen name="meetings" options={{ title: 'Meeting', drawerLabel: 'Meeting' }} />
      <Drawer.Screen name="mom" options={{ title: 'MoM', drawerLabel: 'MoM' }} />
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
      <Drawer.Screen name="team-attendance" options={{ title: 'Site Attendance', drawerLabel: 'Site Attendance' }} />
      {/* Site engineers' own attendance scores — a sub-item under Site
          Attendance in the drawer (DrawerContent.tsx SUBMENUS), admin/
          manager only like team-attendance. */}
      <Drawer.Screen name="engineer-attendance" options={{ title: 'Site Engineer Attendance', drawerLabel: 'Site Engineer Attendance' }} />
      {/* New admin tab — a rollup of every engineer's "Leave" events across
          every project/day, distinct from Critical Alerts (which is about
          system-detected boundary/red-zone/tracking events, not manually
          logged trips) — named to avoid that confusion. Admin/manager only,
          same gate as team-attendance/access-roles/invoices. */}
      <Drawer.Screen name="leave-log" options={{ title: 'Leave Log', drawerLabel: 'Leave Log' }} />
      <Drawer.Screen name="access-roles" options={{ title: 'Access & Roles', drawerLabel: 'Access & Roles' }} />
      {/* "Contact Admin" edit requests from the DPR lock — admin only
          (DrawerContent.tsx's ADMIN_ONLY_ROUTES, same as contacts). Shown
          in the menu as a sub-item under DPR, not its own top-level row. */}
      <Drawer.Screen name="dpr-edit-requests" options={{ title: 'DPR Edit Requests', drawerLabel: 'DPR Edit Requests' }} />
      <Drawer.Screen name="invoices" options={{ title: 'Invoices', drawerLabel: 'Invoices' }} />
      <Drawer.Screen name="settings" options={{ title: 'Settings', drawerLabel: 'Settings' }} />
      {/* Sub-item under Settings (DrawerContent.tsx SUBMENUS) — who is signed in on which phone. */}
      <Drawer.Screen name="devices" options={{ title: 'Devices & Logins', drawerLabel: 'Devices & Logins' }} />
      {/* Admin's own manually-entered address book (contractors/vendors/
          clients/architects/consultants) — admin-only per its own
          requirement (not admin-or-manager), see DrawerContent.tsx's own
          ADMIN_ONLY_ROUTES. */}
      <Drawer.Screen name="contacts" options={{ title: 'Contact Book', drawerLabel: 'Contact Book' }} />
      {/* "Specific Book" — the project-scoped sibling of Contact Book above,
          for whoever's assigned to the selected project (site engineers
          included), not admin-only. See DrawerContent.tsx for its menu
          gating (or lack of it). */}
      <Drawer.Screen name="project-contacts" options={{ title: 'Specific Book', drawerLabel: 'Specific Book' }} />
      {/* Admin uploads drawing/floor-plan documents (with a revision label
          + date); a site engineer opens one and assigns it to a task from
          a searchable picker. The tab itself is staff-only (DrawerContent.
          tsx's STAFF_ONLY_ROUTES — every non-client role can view/assign),
          not admin-only — only the Upload action inside the screen checks
          for admin specifically. */}
      <Drawer.Screen name="documents" options={{ title: 'Documents', drawerLabel: 'Documents' }} />
      {/* flowchart/gantt are still real files under this group (Expo Router
          auto-registers any file here as a route), so without their own
          entry the header title fell back to the raw lowercase filename
          ("flowchart") instead of a real title — confirmed live. Both are
          already hidden from the drawer MENU itself via DrawerContent.tsx's
          own HIDDEN_ROUTES (Template Kit/Project Dashboard link to them
          directly instead), so drawerLabel is irrelevant here; this only
          fixes the header. */}
      <Drawer.Screen name="flowchart" options={{ title: 'Flowchart' }} />
      <Drawer.Screen name="gantt" options={{ title: 'Gantt Chart' }} />
    </Drawer>
    {/* Field roles only — admin/manager are the senders of these. */}
    {isFieldRole(state.profile.role) && <CriticalAlertPopup userId={state.profile.id} />}
    </>
  );
}
