import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchWeeklyReportData, type WeeklyReportData } from '../../lib/reports/weeklyReport';
import { type DateRange, defaultLast7Days, formatDateLabel } from '../../lib/reports/dateRange';
import { DateRangeBar } from '../../components/reports/DateRangeBar';
import { ReportSection } from '../../components/reports/ReportSection';
import { KpiTile } from '../../components/reports/KpiTile';
import { BarChart } from '../../components/reports/charts/BarChart';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { EmptyState } from '../../components/ui/EmptyState';

// Macro-level report over a date range (default: most recent 7 days) — 6
// parameters ported from admin-web's Weekly Report, scoped to the currently
// selected project (see lib/reports/weeklyReport.ts's own comment on why).
export default function WeeklyReportScreen() {
  const { state } = useAuth();
  const { selectedProjectId } = useProject();

  const [range, setRange] = useState<DateRange>(defaultLast7Days());
  const [data, setData] = useState<WeeklyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      setError(null);
      setLoading(true);
      setData(await fetchWeeklyReportData(selectedProjectId, range));
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
  if (!selectedProjectId) {
    return <Redirect href="/home" />;
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Weekly Report',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10">
        <DateRangeBar range={range} onGenerate={setRange} />
        <Text className="text-xs text-neutral-400 mb-3">
          Showing {formatDateLabel(range.from)} – {formatDateLabel(range.to)}
        </Text>

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
        ) : !data || data.overallProgress === null ? (
          <EmptyState icon="bar-chart-outline" iconColor="#9CA3AF" title="No tasks in this project yet" />
        ) : (
          <>
            <ReportSection title="Overall Project Progress">
              <View className="flex-row items-center gap-4">
                <ProgressRing percent={(data.overallProgress.completed / data.overallProgress.total) * 100} size={72} />
                <Text className="text-sm text-neutral-600 flex-1">
                  {data.overallProgress.completed} of {data.overallProgress.total} tasks completed as of {formatDateLabel(range.to)}
                </Text>
              </View>
            </ReportSection>

            <ReportSection title="Tasks Started / Completed">
              <BarChart
                orientation="vertical"
                mode="grouped"
                series={[
                  { key: 'started', label: 'Started', color: '#3B82F6' },
                  { key: 'completed', label: 'Completed', color: '#22C55E' },
                ]}
                categories={data.dailyActivity.map((d) => ({
                  key: d.date,
                  label: d.label,
                  values: { started: d.started, completed: d.completed },
                }))}
                emptyLabel="No activity in this range"
              />
            </ReportSection>

            <ReportSection title="Overdue Tasks">
              <KpiTile
                icon="alert-circle-outline"
                label="Overdue Tasks"
                color="#DC2626"
                current={data.overdueTasks.current}
                previous={data.overdueTasks.previous}
                higherIsWorse
              />
            </ReportSection>

            <ReportSection title="Procurement Alerts">
              <BarChart
                orientation="vertical"
                mode="grouped"
                series={[{ key: 'count', label: 'Alerts', color: '#F59E0B' }]}
                categories={data.procurementAlerts.map((a) => ({
                  key: a.label,
                  label: a.label,
                  values: { count: a.count },
                  colors: { count: a.isOverdue ? '#DC2626' : '#F59E0B' },
                }))}
                emptyLabel="No procurement alerts in this range"
              />
            </ReportSection>

            <ReportSection title="Average Delay by Work">
              {data.avgDelayByWork.length === 0 ? (
                <Text className="text-xs text-neutral-400">No tasks due within this range.</Text>
              ) : (
                <BarChart
                  orientation="horizontal"
                  mode="grouped"
                  series={[{ key: 'delay', label: 'Avg delay (days)', color: '#22C55E' }]}
                  categories={data.avgDelayByWork.map((w) => ({
                    key: w.workName,
                    label: w.workName,
                    values: { delay: Math.max(0, w.avgDelayDays) },
                    colors: { delay: w.avgDelayDays > 0 ? '#DC2626' : '#22C55E' },
                  }))}
                  categoryValueLabel={(cat) => {
                    const w = data.avgDelayByWork.find((x) => x.workName === cat.key);
                    return `${w?.avgDelayDays ?? 0}d`;
                  }}
                  showLegend={false}
                />
              )}
            </ReportSection>
          </>
        )}
      </ScrollView>
    </View>
  );
}
