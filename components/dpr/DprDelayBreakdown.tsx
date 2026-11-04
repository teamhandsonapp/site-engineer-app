import { Text, View } from 'react-native';
import type { GeneralParameterReportData } from '../../lib/reports/generalParameterReport';
import { formatDateTimeLabel } from '../../lib/formatTime';

const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDateKeyLabel(dateKey: string | null): string {
  if (!dateKey) return 'Not set';
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${d} ${FULL_MONTHS[m - 1]} ${y}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-0.5">
      <Text className="text-2xs text-neutral-500 flex-1 pr-2">{label}</Text>
      <Text className="text-2xs font-bold text-neutral-900">{value}</Text>
    </View>
  );
}

// Tapping a DPR task row's own task name expands this — simplified down to
// just the real dates, by explicit correction (was Preconstruction/
// Construction/Cumulative delay-day breakdowns; that level of detail lives
// on the Task Based Report already, this is meant to be a quick glance).
// Planned Start/End were dropped in favor of Total Working Days (the
// planned duration itself, by explicit request — the two raw planned dates
// read as redundant once Actual Start/End are shown right below them).
// Actual End naturally stays "Not set" here until the task is genuinely
// marked complete — no separate "in progress" placeholder text needed.
export function DprDelayBreakdown({ data }: { data: GeneralParameterReportData }) {
  const { base, plannedWorkingDays } = data;
  return (
    <View className="mb-3 rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2.5 gap-0.5">
      {/* Today's real date + time this box (and the DPR form below it) is
          being viewed/filled in — by explicit request, distinct from the
          task's own Actual dates underneath it. */}
      <Row label="DPR Date" value={formatDateTimeLabel(new Date())} />
      <Row label="Total Working Days" value={plannedWorkingDays != null ? String(plannedWorkingDays) : 'Not set'} />
      <Row label="Actual Start" value={formatDateKeyLabel(base.actualStartDate)} />
      <Row label="Actual End" value={formatDateKeyLabel(base.actualEndDate)} />
    </View>
  );
}
