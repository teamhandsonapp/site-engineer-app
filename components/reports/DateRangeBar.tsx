import { Text, View } from 'react-native';
import { DateField } from '../ui/DateField';
import { Card } from '../ui/Card';
import type { DateRange } from '../../lib/reports/dateRange';

// Two DateFields that commit STRAIGHT to the parent the moment a date is
// picked — no draft state, no separate "Generate Report" button to press
// afterward. Used to hold a local draft + only commit on a button press
// (mirroring admin-web's WeeklyReportDateRangePicker), but that read as an
// unwanted extra step once every other picker in these report screens
// (project/task/engineer) already applies the instant you tap a choice —
// by explicit feedback: "select it and see the report... not select and
// generate report and see it." The parent's own fetch effect re-runs off
// `range` exactly as before; this just changes how `range` gets updated.
interface DateRangeBarProps {
  range: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangeBar({ range, onChange }: DateRangeBarProps) {
  const invalid = range.from > range.to;

  return (
    <Card className="mb-3">
      <View className="flex-row gap-3">
        <View className="flex-1">
          <DateField label="From" value={range.from} onChange={(from) => onChange({ from, to: range.to })} />
        </View>
        <View className="flex-1">
          <DateField label="To" value={range.to} onChange={(to) => onChange({ from: range.from, to })} />
        </View>
      </View>
      {invalid && <Text className="text-2xs text-red-600 mt-2">&quot;From&quot; must be on or before &quot;To&quot; — showing the last valid report below.</Text>}
    </Card>
  );
}
