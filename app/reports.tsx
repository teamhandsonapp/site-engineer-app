import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack, router } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { useProject } from '../lib/ProjectContext';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';

// Reports hub — unlike Checklist Templates/Template Kit, this is visible to
// BOTH staff and client roles (no isStaff gate): a client can view their own
// project's reports, matching admin-web's separate client-facing Client
// Progress Report precedent. Project scoping (not a role gate) is what keeps
// a client's view to their own data — see lib/reports/*.ts.
function ReportLink({
  icon,
  label,
  subtitle,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-3 flex-row items-center justify-between">
        <View className="flex-row items-center gap-3 flex-1 pr-2">
          <View className="w-10 h-10 rounded-xl items-center justify-center" style={{ backgroundColor: `${color}22` }}>
            <Ionicons name={icon} size={18} color={color} />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-bold text-neutral-900">{label}</Text>
            <Text className="text-xs text-neutral-400 mt-0.5">{subtitle}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </Card>
    </Pressable>
  );
}

export default function ReportsHubScreen() {
  const { state } = useAuth();
  const { selectedProjectId, isClient } = useProject();

  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }

  // Was a silent <Redirect href="/home" /> — bounced straight back to Home
  // with zero explanation, which from the drawer just looked like the
  // Reports link did nothing. Same "no project selected" EmptyState
  // task-list.tsx already uses, not a new pattern.
  if (!selectedProjectId) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Stack.Screen
          options={{
            headerShown: true,
            title: 'Status',
            headerStyle: { backgroundColor: '#0F1F33' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '600' },
          }}
        />
        <EmptyState
          icon="bar-chart-outline"
          iconColor="#9CA3AF"
          title={isClient ? 'No project assigned' : 'No project selected'}
          subtitle={
            isClient
              ? "Your account isn't linked to a project yet. Contact your PMC office to get this set up."
              : 'Pick a project from Home to see its reports.'
          }
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Status',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />
      <View className="px-4 pt-4">
        <Text className="text-xs text-neutral-500 mb-4">Choose a report to view live progress for your project.</Text>
        <ReportLink
          icon="clipboard-outline"
          label="Task Based Status"
          subtitle="Checklist completion, delay, and quantity for one task"
          color="#1C3358"
          onPress={() => router.push('/reports/general-parameter-report')}
        />
        <ReportLink
          icon="calendar-outline"
          label="Weekly Status"
          subtitle="Tasks reported this week, with a cumulative % rollup"
          color="#F0A227"
          onPress={() => router.push({ pathname: '/reports/activity-report', params: { preset: 'week', title: 'Weekly Status' } } as never)}
        />
        <ReportLink
          icon="stats-chart-outline"
          label="Monthly Status"
          subtitle="Tasks reported this month, with a cumulative % rollup"
          color="#2E7D32"
          onPress={() => router.push({ pathname: '/reports/activity-report', params: { preset: 'month', title: 'Monthly Status' } } as never)}
        />
        {/* Staff-only — internal engineer attendance/performance data, not a
            client-facing progress view, same gate as the drawer's own
            REPORT_SUBMENU entry (components/DrawerContent.tsx). */}
        {!isClient && (
          <ReportLink
            icon="person-outline"
            label="Site Engineer Status"
            subtitle="One engineer's attendance and DPR submission history"
            color="#7C3AED"
            onPress={() => router.push('/reports/site-engineer-report')}
          />
        )}
      </View>
    </View>
  );
}
