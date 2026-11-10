import EngineerAttendanceScreen from './engineer-attendance';

// Attendance tab (drawer + bottom bar). Workers' "Workforce Attendance"
// (planned vs actual people per department, components/team/
// WorkforceAttendance.tsx) was removed on request (2026-11-09), so this
// route now shows Site Engineer Attendance. The route name stays
// team-attendance so the drawer, bottom tab and notification links keep
// working unchanged.
export default function TeamAttendanceScreen() {
  return <EngineerAttendanceScreen />;
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
