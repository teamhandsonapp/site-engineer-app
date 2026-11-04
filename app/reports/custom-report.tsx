import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchRangeTaskReport, type RangeTaskRow } from '../../lib/reports/rangeTaskReport';
import { type DateRange, defaultLast7Days, formatDateLabel } from '../../lib/reports/dateRange';
import { DateRangeBar } from '../../components/reports/DateRangeBar';
import { ReportProjectPicker } from '../../components/reports/ReportProjectPicker';
import { ReportSection } from '../../components/reports/ReportSection';
import { RangeReportList } from '../../components/reports/RangeReportList';
import { RangeDebugPanel } from '../../components/reports/RangeDebugPanel';
import { SHOW_DEBUG_PARAM_CHECK } from '../../lib/debug/taskReportParamCheck';
import { EmptyState } from '../../components/ui/EmptyState';

// Any start/end date the user picks — no preset week/month constraint.
// Same shared engine as Weekly/Monthly (lib/reports/rangeTaskReport.ts),
// just handed an arbitrary range directly instead of a 7-day/calendar-
// month preset. DateRangeBar already supports any from/to (Weekly Report
// uses the identical component) — reused as-is rather than building a
// second date picker.
export default function CustomReportScreen() {
  const { state } = useAuth();
  const { selectedProjectId } = useProject();

  const [range, setRange] = useState<DateRange>(defaultLast7Days());
  const [rows, setRows] = useState<RangeTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      setError(null);
      setLoading(true);
      setRows(await fetchRangeTaskReport(selectedProjectId, range));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId, range]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Custom Date-Range Status',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10">
        <ReportProjectPicker />

        {!selectedProjectId ? (
          <EmptyState icon="bar-chart-outline" iconColor="#9CA3AF" title="Select a project" subtitle="Pick a project above to generate its report." />
        ) : (
          <>
            <DateRangeBar range={range} onChange={setRange} />
            <Text className="text-xs text-neutral-400 mb-3">
              Showing {formatDateLabel(range.from)} – {formatDateLabel(range.to)}
            </Text>

            {!loading && !error && SHOW_DEBUG_PARAM_CHECK && <RangeDebugPanel rows={rows} />}

            {loading ? (
              <View className="items-center py-10">
                <ActivityIndicator color="#0F1F33" />
              </View>
            ) : error ? (
              <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
                <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
                <Pressable onPress={load} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
                  <Text className="text-xs font-semibold text-red-600">Retry</Text>
                </Pressable>
              </View>
            ) : (
              <ReportSection title="Task-Level Detail (by department)">
                <RangeReportList rows={rows} />
              </ReportSection>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
