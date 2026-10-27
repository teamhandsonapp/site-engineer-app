import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import {
  fetchDprActivityReport,
  type DprActivityReport,
  type DprActivityRow,
  type DprActivityTask,
  type ProgressForecast,
} from '../../lib/reports/dprActivityReport';
import {
  type DateRange,
  currentCalendarMonth,
  currentWeekOfMonth,
  defaultLast7Days,
  defaultToday,
  formatDateLabel,
  formatDayLabel,
} from '../../lib/reports/dateRange';
import { DateRangeBar } from '../../components/reports/DateRangeBar';
import { PeriodPicker } from '../../components/reports/PeriodPicker';
import { ReportProjectPicker } from '../../components/reports/ReportProjectPicker';
import { EmptyState } from '../../components/ui/EmptyState';
import { downloadPrintout } from '../../lib/reports/projectPrintouts';
import { buildActivityReportPdfHtml, entryNotes, forecastLines } from '../../lib/reports/activityReportPdf';

// The drawer's "Report by time" submenu (Daily/Weekly/Monthly/Custom
// duration) all land here, parameterized via route params, rather than 4
// near-identical screens. By explicit request, Weekly/Monthly/Custom now
// behave exactly like Day Report — the same real dpr_entries-submission
// list + cumulative % rollup, just over a longer default window — rather
// than rangeTaskReport.ts's own due_date-based engine the old weekly-
// report.tsx/monthly-report.tsx/custom-report.tsx screens used. Those 3
// files are left in place but now unreachable from any nav entry point
// (this app has no git history to fall back on, so nothing is deleted
// outright) — see lib/reports/dprActivityReport.ts's own header comment
// for the full rationale on why this needed a new engine at all.
//
// The Architect/Client/Vendor/Dept/Contractor reports used to live here
// too (category/department filters over this same DPR-activity engine) —
// moved out to app/reports/stakeholder-report.tsx, which is a genuinely
// different report shape (pending checklist inputs + downstream delay
// impact, not a date-range activity list).
type Preset = 'day' | 'week' | 'month' | 'custom';

const DEFAULT_RANGE_FOR_PRESET: Record<Preset, () => DateRange> = {
  day: defaultToday,
  week: currentWeekOfMonth,
  month: currentCalendarMonth,
  custom: defaultLast7Days,
};

function ForecastLines({ f, dark }: { f: ProgressForecast; dark?: boolean }) {
  const text = dark ? 'text-white/80' : 'text-neutral-600';
  const toneClass = {
    normal: text,
    late: `font-semibold ${dark ? 'text-red-300' : 'text-red-600'}`,
    ok: `font-semibold ${dark ? 'text-emerald-300' : 'text-emerald-600'}`,
  };
  return (
    <View className="mt-1.5 gap-0.5">
      {forecastLines(f).map((line, i) => (
        <Text key={i} className={`text-2xs ${toneClass[line.tone]}`}>
          <Text className="font-bold">{i + 1}.</Text> {line.text}
        </Text>
      ))}
    </View>
  );
}

function EntryLine({ row }: { row: DprActivityRow }) {
  return (
    <View className="flex-row items-center py-1 border-t border-neutral-100">
      <Text className="text-2xs font-semibold text-neutral-500 w-14">{formatDayLabel(row.reportDate)}</Text>
      <Text className="text-2xs font-bold text-emerald-600 w-10">{row.percentComplete != null ? `${row.percentComplete}%` : '—'}</Text>
      <Text className="text-2xs text-neutral-500 flex-1" numberOfLines={1}>
        {entryNotes(row).join(' · ')}
      </Text>
    </View>
  );
}

function TaskCard({ task }: { task: DprActivityTask }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/reports/general-parameter-report', params: { taskId: task.taskId } } as never)}
      className="rounded-xl bg-white border border-neutral-100 px-3 py-2.5 mb-2 active:opacity-70"
    >
      <View className="flex-row items-center">
        <View className="flex-1 pr-2">
          <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>
            {task.taskName}
          </Text>
          <Text className="text-2xs text-neutral-400">
            {task.taskCode} · {task.workName} · {task.entries.length} DPR{task.entries.length === 1 ? '' : 's'}
          </Text>
        </View>
        {task.forecast && <Text className="text-base font-extrabold text-emerald-600 mr-1">{task.forecast.percentDone}%</Text>}
        <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
      </View>
      {task.forecast && <ForecastLines f={task.forecast} />}
      <View className="mt-1.5">
        {task.entries.map((row, i) => (
          <EntryLine key={`${row.reportDate}-${i}`} row={row} />
        ))}
      </View>
    </Pressable>
  );
}

export default function ActivityReportScreen() {
  const { state } = useAuth();
  const { projects, selectedProjectId } = useProject();
  const projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? '—';
  const params = useLocalSearchParams<{ preset?: string; title?: string }>();
  const VALID_PRESETS: Preset[] = ['day', 'week', 'month', 'custom'];
  const preset: Preset = VALID_PRESETS.includes(params.preset as Preset) ? (params.preset as Preset) : 'day';
  const title = params.title ?? 'Daily Status';

  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE_FOR_PRESET[preset]());
  const [report, setReport] = useState<DprActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSavedTo, setExportSavedTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    // range.from > range.to is a transient state while DateRangeBar's two
    // fields are being edited independently (each commits immediately, no
    // "Generate" button to wait for) — skip the fetch and leave whatever
    // report is already on screen until the range is valid again.
    if (!selectedProjectId || range.from > range.to) return;
    try {
      setError(null);
      setLoading(true);
      setReport(await fetchDprActivityReport(selectedProjectId, range));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId, range]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setExportError(null);
    setExportSavedTo(null);
  }, [selectedProjectId, range]);

  async function handleExport() {
    if (!report) return;
    setExportError(null);
    setExportSavedTo(null);
    setExporting(true);
    try {
      const html = buildActivityReportPdfHtml(report, range, projectName, title);
      const note = await downloadPrintout(html, `${projectName}-${title}-${range.from}-to-${range.to}`);
      if (note) setExportSavedTo(note);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not create the PDF.');
    } finally {
      setExporting(false);
    }
  }

  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />

      <ScrollView contentContainerClassName="px-3 pt-3 pb-10">
        <ReportProjectPicker />

        {!selectedProjectId ? (
          <EmptyState icon="bar-chart-outline" iconColor="#9CA3AF" title="Select a project" subtitle="Pick a project above to generate its report." />
        ) : (
          <>
            {preset === 'week' || preset === 'month' ? (
              <PeriodPicker mode={preset} range={range} onChange={setRange} />
            ) : (
              <DateRangeBar range={range} onChange={setRange} />
            )}
            <Text className="text-xs text-neutral-400 mb-2">
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
            ) : !report || report.rows.length === 0 ? (
              <EmptyState
                icon="document-text-outline"
                iconColor="#9CA3AF"
                title="No DPR activity"
                subtitle="No daily progress reports were submitted in this window."
              />
            ) : (
              <>
                <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5 px-1">
                  Task-Level Activity ({report.taskCount} task{report.taskCount === 1 ? '' : 's'}) · tap a task for its full report
                </Text>
                {report.tasks.map((task) => (
                  <TaskCard key={task.taskId} task={task} />
                ))}
                <View className="rounded-xl bg-neutral-900 px-3 py-2.5 mt-1">
                  <Text className="text-2xs font-bold uppercase tracking-wide text-white/50 mb-0.5">Cumulative Progress</Text>
                  <Text className="text-lg font-extrabold text-white">{report.cumulativePercent != null ? `${report.cumulativePercent}%` : '—'}</Text>
                  {report.overallForecast && <ForecastLines f={report.overallForecast} dark />}
                </View>

                <Pressable
                  onPress={handleExport}
                  disabled={exporting}
                  className="flex-row items-center justify-center gap-2 rounded-xl bg-brand-navy py-2.5 mt-3"
                  style={{ opacity: exporting ? 0.6 : 1 }}
                >
                  {exporting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="download-outline" size={16} color="#fff" />}
                  <Text className="text-sm font-bold text-white">{exporting ? 'Preparing PDF…' : 'Download PDF'}</Text>
                </Pressable>
                {exportError && <Text className="text-2xs text-red-600 mt-2">{exportError}</Text>}
                {exportSavedTo && <Text className="text-2xs text-green-600 font-semibold mt-2">{exportSavedTo}</Text>}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
