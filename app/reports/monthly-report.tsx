import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import {
  fetchMonthlyReportData,
  defaultMonthRange,
  shiftMonth,
  monthLabel,
  utcMonthStartKey,
  utcMonthEndKey,
  type MonthRange,
  type MonthlyReportData,
} from '../../lib/reports/monthlyReport';
import { ReportProjectPicker } from '../../components/reports/ReportProjectPicker';
import { ReportSection } from '../../components/reports/ReportSection';
import { RangeReportList } from '../../components/reports/RangeReportList';
import { RangeDebugPanel } from '../../components/reports/RangeDebugPanel';
import { SHOW_DEBUG_PARAM_CHECK } from '../../lib/debug/taskReportParamCheck';
import { fetchRangeTaskReport, type RangeTaskRow } from '../../lib/reports/rangeTaskReport';
import { BarChart } from '../../components/reports/charts/BarChart';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

// Month picker — prev/next arrows around a label, rather than DateRangeBar's
// two DateFields (picking a whole month is more natural as "step one month
// at a time" than typing exact from/to dates).
function MonthPickerBar({ range, onChange }: { range: MonthRange; onChange: (range: MonthRange) => void }) {
  return (
    <Card className="mb-3 flex-row items-center justify-between">
      <Pressable onPress={() => onChange(shiftMonth(range, -1))} hitSlop={8} className="w-9 h-9 rounded-full items-center justify-center bg-neutral-50">
        <Ionicons name="chevron-back" size={18} color="#374151" />
      </Pressable>
      <Text className="text-sm font-bold text-neutral-900">{monthLabel(range)}</Text>
      <Pressable onPress={() => onChange(shiftMonth(range, 1))} hitSlop={8} className="w-9 h-9 rounded-full items-center justify-center bg-neutral-50">
        <Ionicons name="chevron-forward" size={18} color="#374151" />
      </Pressable>
    </Card>
  );
}

function DelaySection({ title, data, emptyLabel }: { title: string; data: MonthlyReportData['delayByDepartment']; emptyLabel: string }) {
  return (
    <ReportSection title={title}>
      {data.length === 0 ? (
        <Text className="text-xs text-neutral-400">{emptyLabel}</Text>
      ) : (
        <BarChart
          orientation="horizontal"
          mode="grouped"
          series={[{ key: 'delay', label: 'Avg delay (days)', color: '#22C55E' }]}
          categories={data.map((d) => ({
            key: d.name,
            label: d.name,
            values: { delay: Math.max(0, d.avgDelayDays) },
            colors: { delay: d.avgDelayDays > 0 ? '#DC2626' : '#22C55E' },
          }))}
          categoryValueLabel={(cat) => {
            const d = data.find((x) => x.name === cat.key);
            return `${d?.avgDelayDays ?? 0}d`;
          }}
          showLegend={false}
        />
      )}
    </ReportSection>
  );
}

function QuantitySection({ quantity }: { quantity: MonthlyReportData['quantity'] }) {
  if (quantity.targetedTotal === 0 && quantity.completedTotal === 0) {
    return (
      <ReportSection title="Targeted Quantity">
        <Text className="text-xs text-neutral-400">No targeted quantity or progress logged this month.</Text>
      </ReportSection>
    );
  }

  return (
    <ReportSection title="Targeted Quantity">
      <View className="flex-row items-center gap-4 mb-4">
        <ProgressRing percent={quantity.percentage ?? 0} size={72} />
        <View className="flex-1 flex-row flex-wrap gap-y-2">
          <View style={{ width: '50%' }}>
            <Text className="text-2xs font-semibold uppercase tracking-wide text-neutral-400">Targeted</Text>
            <Text className="text-lg font-extrabold text-neutral-900">{quantity.targetedTotal.toLocaleString()} sft</Text>
          </View>
          <View style={{ width: '50%' }}>
            <Text className="text-2xs font-semibold uppercase tracking-wide text-neutral-400">Completed</Text>
            <Text className="text-lg font-extrabold text-neutral-900">{quantity.completedTotal.toLocaleString()} sft</Text>
          </View>
        </View>
      </View>

      {quantity.byDepartment.length > 0 && (
        <BarChart
          orientation="horizontal"
          mode="grouped"
          series={[
            { key: 'targeted', label: 'Targeted', color: '#3B82F6' },
            { key: 'completed', label: 'Completed', color: '#22C55E' },
          ]}
          categories={quantity.byDepartment.map((d) => ({
            key: d.workName,
            label: d.workName,
            values: { targeted: d.targeted, completed: d.completed },
          }))}
          valueFormatter={(v) => `${v}`}
        />
      )}
    </ReportSection>
  );
}

// Monthly rollup — delay by department, delay by person, and targeted vs.
// completed quantity, scoped to the currently selected project. Ported
// from admin-web's Monthly Report the same way Weekly/Task Report were —
// see lib/reports/monthlyReport.ts's own comment.
export default function MonthlyReportScreen() {
  const { state } = useAuth();
  const { selectedProjectId } = useProject();

  const [range, setRange] = useState<MonthRange>(defaultMonthRange());
  const [data, setData] = useState<MonthlyReportData | null>(null);
  const [rangeRows, setRangeRows] = useState<RangeTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      setError(null);
      setLoading(true);
      const dateRange = { from: utcMonthStartKey(range.year, range.month), to: utcMonthEndKey(range.year, range.month) };
      const [monthly, rows] = await Promise.all([
        fetchMonthlyReportData(selectedProjectId, range),
        fetchRangeTaskReport(selectedProjectId, dateRange),
      ]);
      setData(monthly);
      setRangeRows(rows);
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
          title: 'Monthly Status',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10">
        <ReportProjectPicker />

        {!selectedProjectId ? (
          <EmptyState icon="bar-chart-outline" iconColor="#9CA3AF" title="Select a project" subtitle="Pick a project above to generate its monthly report." />
        ) : (
          <>
            <MonthPickerBar range={range} onChange={setRange} />

            {!loading && !error && SHOW_DEBUG_PARAM_CHECK && <RangeDebugPanel rows={rangeRows} />}

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
            ) : !data ? (
              <EmptyState icon="bar-chart-outline" iconColor="#9CA3AF" title="No tasks in this project yet" />
            ) : (
              <>
                <DelaySection title="Delay By Department" data={data.delayByDepartment} emptyLabel="No tasks due this month." />
                <DelaySection title="Delay By Person" data={data.delayByPerson} emptyLabel="No tasks due this month." />
                <QuantitySection quantity={data.quantity} />

                <ReportSection title="Task-Level Detail (by department)">
                  <RangeReportList rows={rangeRows} />
                </ReportSection>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
