import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DateField } from '../ui/DateField';
import { Card } from '../ui/Card';
import type { DateRange } from '../../lib/reports/dateRange';

// Two DateFields in draft state + a "Generate Report" button — editing the
// fields does NOT refetch per keystroke, only pressing Generate commits the
// range up to the parent (mirrors admin-web's WeeklyReportDateRangePicker,
// which navigates on button press rather than live-updating).
interface DateRangeBarProps {
  range: DateRange;
  onGenerate: (range: DateRange) => void;
}

export function DateRangeBar({ range, onGenerate }: DateRangeBarProps) {
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  const invalid = from > to;

  return (
    <Card className="mb-3">
      <View className="flex-row gap-3 mb-3">
        <View className="flex-1">
          <DateField label="From" value={from} onChange={setFrom} />
        </View>
        <View className="flex-1">
          <DateField label="To" value={to} onChange={setTo} />
        </View>
      </View>
      {invalid && <Text className="text-2xs text-red-600 mb-2">&quot;From&quot; must be on or before &quot;To&quot;.</Text>}
      <Pressable
        onPress={() => !invalid && onGenerate({ from, to })}
        disabled={invalid}
        className="rounded-xl py-2.5 items-center"
        style={{ backgroundColor: invalid ? '#E5E7EB' : '#0F1F33' }}
      >
        <Text className="text-sm font-bold text-white">Generate Report</Text>
      </Pressable>
    </Card>
  );
}
