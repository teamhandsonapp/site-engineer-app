import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { fetchProjectTaskOptions, type ProjectTaskOption } from '../../lib/reports/taskList';
import { fetchTaskReport, type TaskReportData } from '../../lib/reports/taskReport';
import { TaskPicker } from '../../components/reports/TaskPicker';
import { ReportSection } from '../../components/reports/ReportSection';
import { BarChart } from '../../components/reports/charts/BarChart';
import { PieChart } from '../../components/reports/charts/PieChart';
import { DelayComparisonChart } from '../../components/reports/charts/DelayComparisonChart';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { EmptyState } from '../../components/ui/EmptyState';

function relativeDayLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

// Micro-level report for a single task — 6 parameters ported from admin-web's
// Task Report, scoped to the currently selected project (see
// lib/reports/taskReport.ts's own comment on why).
export default function TaskReportScreen() {
  const { state } = useAuth();
  const { selectedProjectId } = useProject();
  const { taskId: taskIdParam } = useLocalSearchParams<{ taskId?: string }>();

  const [options, setOptions] = useState<ProjectTaskOption[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(taskIdParam ?? null);
  const [report, setReport] = useState<TaskReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      setError(null);
      setOptions(await fetchProjectTaskOptions(selectedProjectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    setLoading(true);
    loadOptions();
  }, [loadOptions]);

  const loadReport = useCallback(async () => {
    if (!selectedProjectId || !selectedTaskId) {
      setReport(null);
      return;
    }
    try {
      setError(null);
      setReportLoading(true);
      setReport(await fetchTaskReport(selectedTaskId, selectedProjectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReportLoading(false);
    }
  }, [selectedProjectId, selectedTaskId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }
  if (!selectedProjectId) {
    return <Redirect href="/home" />;
  }

  function handleSelectTask(id: string) {
    setSelectedTaskId(id);
    router.setParams({ taskId: id });
  }

  function retry() {
    loadOptions();
    loadReport();
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Task Report',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : error ? (
        <View className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
          <Pressable onPress={retry} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      ) : options.length === 0 ? (
        <EmptyState icon="clipboard-outline" iconColor="#9CA3AF" title="No tasks in this project yet" />
      ) : (
        <ScrollView contentContainerClassName="px-4 pt-4 pb-10">
          <TaskPicker options={options} selectedTaskId={selectedTaskId} onSelect={handleSelectTask} />

          {reportLoading ? (
            <View className="items-center py-10">
              <ActivityIndicator color="#0F1F33" />
            </View>
          ) : !selectedTaskId ? null : !report ? (
            <EmptyState
              icon="alert-circle-outline"
              iconColor="#9CA3AF"
              title="Task not found"
              subtitle="It may not belong to this project, or may have been deleted."
            />
          ) : (
            <>
              <Text className="text-md font-bold text-neutral-900 mb-0.5">
                {report.task.taskCode} — {report.task.taskName}
              </Text>
              <Text className="text-xs text-neutral-400 mb-4">{report.task.workName}</Text>

              <ReportSection title="Checklist Completion">
                {report.completion ? (
                  <View className="flex-row items-center gap-4">
                    <ProgressRing percent={(report.completion.done / report.completion.total) * 100} size={72} />
                    <Text className="text-sm text-neutral-600 flex-1">
                      {report.completion.done} of {report.completion.total} items resolved
                    </Text>
                  </View>
                ) : (
                  <Text className="text-xs text-neutral-400">No checklist items on this task.</Text>
                )}
              </ReportSection>

              <ReportSection title="Status Breakdown">
                <PieChart data={report.statusBreakdown.map((s) => ({ key: s.status, label: s.label, value: s.count, color: s.color }))} />
              </ReportSection>

              <ReportSection title="Completion by Department">
                {report.departmentCompletion.length === 0 ? (
                  <Text className="text-xs text-neutral-400">No departments apply to this task&apos;s classification.</Text>
                ) : (
                  <BarChart
                    orientation="horizontal"
                    mode="stacked"
                    series={[
                      { key: 'done', label: 'Resolved', color: '#22C55E' },
                      { key: 'remaining', label: 'Remaining', color: '#E5E7EB' },
                    ]}
                    categories={report.departmentCompletion.map((d) => ({
                      key: d.category,
                      label: d.label,
                      values: { done: d.done, remaining: d.total - d.done },
                      colors: { done: d.color },
                    }))}
                    categoryValueLabel={(cat) => `${cat.values.done}/${cat.values.done + cat.values.remaining}`}
                    showLegend={false}
                  />
                )}
              </ReportSection>

              <ReportSection title="Delay">
                <DelayComparisonChart delay={report.delay} />
              </ReportSection>

              <ReportSection title="Quantity of Work">
                {report.quantity ? (
                  <BarChart
                    orientation="vertical"
                    mode="grouped"
                    series={[{ key: 'value', label: 'Quantity', color: '#111827' }]}
                    categories={[
                      { key: 'targeted', label: 'Targeted', values: { value: report.quantity.targeted }, colors: { value: '#111827' } },
                      { key: 'done', label: 'Completed', values: { value: report.quantity.done }, colors: { value: '#22C55E' } },
                      { key: 'pending', label: 'Pending', values: { value: report.quantity.pending }, colors: { value: '#EF4444' } },
                      { key: 'excess', label: 'Excess', values: { value: report.quantity.excess }, colors: { value: '#F59E0B' } },
                    ]}
                  />
                ) : (
                  <Text className="text-xs text-neutral-400">No quantity-of-work items on this task.</Text>
                )}
              </ReportSection>

              <ReportSection title="Status Change Activity">
                <Text className="text-sm text-neutral-700">
                  Changed status {report.statusActivity.changeCount} time{report.statusActivity.changeCount === 1 ? '' : 's'}
                  {report.statusActivity.mostRecentChangeAtISO
                    ? `, most recently ${relativeDayLabel(report.statusActivity.mostRecentChangeAtISO)}.`
                    : '.'}
                </Text>
              </ReportSection>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
