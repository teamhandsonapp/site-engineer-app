import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../lib/AuthContext';
import { WorkforceAttendance } from '../../components/team/WorkforceAttendance';

// Site Attendance (drawer) / "Workforce Attendance" (project dashboard) —
// workers' planned vs actual workforce by department and date. The site
// engineers' own attendance scores moved to engineer-attendance.tsx ("Site
// Engineer Attendance"), listed under this tab in the drawer.
export default function TeamAttendanceScreen() {
  const { state } = useAuth();
  const isAdminOrManager = state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');

  if (!isAdminOrManager) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-neutral-50" contentContainerClassName="px-4 pt-4 pb-8">
      <WorkforceAttendance />
    </ScrollView>
  );
}
