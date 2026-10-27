import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ParamCheckResult } from '../../lib/debug/taskReportParamCheck';

// Shared between the real per-task expanded detail (showStatus=false —
// just the 13 values, no pass/fail framing) and the TEMP debug panel
// (showStatus=true — same 13 rows, with a green/red mark). One renderer so
// the two never drift out of sync with each other.
export function RangeTaskDetailRows({ results, showStatus }: { results: ParamCheckResult[]; showStatus: boolean }) {
  return (
    <View className={showStatus ? 'px-3 pb-2 pt-0.5' : 'px-3.5 pb-3 pt-1'}>
      {results.map((r) => (
        <View key={r.key} className="flex-row items-start justify-between gap-2 py-1 border-t border-neutral-100">
          <View className="flex-row items-center gap-1.5 flex-1 pr-2">
            {showStatus && <Ionicons name={r.ok ? 'checkmark-circle' : 'close-circle'} size={13} color={r.ok ? '#16A34A' : '#DC2626'} />}
            <Text className="text-2xs font-medium text-neutral-700 flex-1" numberOfLines={2}>{r.label}</Text>
          </View>
          <Text className="text-2xs text-neutral-500 flex-shrink-0" numberOfLines={1} style={{ maxWidth: 130 }}>
            {r.detail}
          </Text>
        </View>
      ))}
    </View>
  );
}
