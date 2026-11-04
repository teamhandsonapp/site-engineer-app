import { useAuth } from '../../lib/AuthContext';
import { WorkforceAttendance } from '../../components/team/WorkforceAttendance';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { colors } from '../../lib/theme';

// Site Attendance (drawer) / "Workforce Attendance" (project dashboard) —
// workers' planned vs actual workforce by department and date. The site
// engineers' own attendance scores moved to engineer-attendance.tsx ("Site
// Engineer Attendance"), listed under this tab in the drawer.
export default function TeamAttendanceScreen() {
  const { state } = useAuth();
  const isAdminOrManager = state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');

  if (!isAdminOrManager) {
    return (
      <Screen>
        <EmptyState icon="lock-closed-outline" iconColor={colors.textMuted} title="Not available for this account" subtitle="Site Attendance is for admin and manager accounts." />
      </Screen>
    );
  }

  return (
    <Screen>
      <WorkforceAttendance />
    </Screen>
  );
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
