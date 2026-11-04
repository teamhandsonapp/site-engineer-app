import { Text, View } from 'react-native';
import type { GeneralParameterReportData } from '../../lib/reports/generalParameterReport';

// Cumulative Pre + Construction delay, admin/manager oversight only, shown
// inside a task's Post Construction checklist category (both on the main
// task detail screen and the mobile Quality Checklist screen) — "cumulative"
// is the total at the bottom, "classified with stages" is the
// Preconstruction/Construction breakdown above it. There's no other "stage"
// concept in this app; these are the two delay types the existing General
// Parameter Report already tracks (lib/reports/generalParameterReport.ts).
// Field engineers never see this panel at all, not a locked/greyed-out
// version of it.
export function DelayPanel({ delay }: { delay: GeneralParameterReportData }) {
  const construction = delay.constructionDelayDays;
  const total = delay.preconstructionDelayDays + (construction ?? 0);
  return (
    <View className="mx-3.5 mb-3 px-3 py-2.5 rounded-lg bg-neutral-50 border border-neutral-200">
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-2">
        Cumulative Delay (Pre + Construction) — Admin/Manager only
      </Text>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-xs text-neutral-600">Preconstruction delay</Text>
        <Text className={`text-xs font-bold ${delay.preconstructionDelayDays > 0 ? 'text-red-600' : 'text-green-600'}`}>
          {delay.preconstructionDelayDays}d
        </Text>
      </View>
      <View className="flex-row items-center justify-between pb-2 mb-2 border-b border-neutral-200">
        <Text className="text-xs text-neutral-600">Construction delay</Text>
        <Text
          className={`text-xs font-bold ${
            construction == null ? 'text-neutral-400' : construction > 0 ? 'text-red-600' : 'text-green-600'
          }`}
        >
          {construction != null ? `${construction}d` : 'Not started'}
        </Text>
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-bold text-neutral-800">Cumulative total</Text>
        <Text className={`text-sm font-extrabold ${total > 0 ? 'text-red-600' : 'text-green-600'}`}>{total}d</Text>
      </View>
    </View>
  );
}
