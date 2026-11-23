import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './AppText';
import { PROGRESS_STATUS_META, type ProgressStatusInfo } from '../../lib/taskProgressStatus';

// Calculated task status (lib/taskProgressStatus.ts): coloured badge, a red
// outlined "Overdue" tag when past the planned end, and an optional "Why?"
// that shows the plain-English reason. Used by DPR, Flowchart, Gantt, Home.
export function ProgressStatusBadge({
  info,
  showWhy = false,
  size = 'md',
}: {
  info: ProgressStatusInfo | null | undefined;
  showWhy?: boolean;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  if (!info) return null;
  const m = PROGRESS_STATUS_META[info.status];
  const fs = size === 'sm' ? 10 : 11;
  return (
    <View>
      <View className="flex-row flex-wrap items-center" style={{ gap: 4 }}>
        <View testID={`status-badge-${info.status}`} style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: m.bg, borderWidth: 1, borderColor: m.border }}>
          <Text style={{ fontSize: fs, fontWeight: '700', color: m.color }}>{m.label}</Text>
        </View>
        {info.overdue && info.status !== 'completed' ? (
          <View testID="status-badge-overdue" style={{ paddingHorizontal: 6, paddingVertical: 0, borderRadius: 999, borderWidth: 1, borderColor: '#DC2626' }}>
            <Text style={{ fontSize: fs, fontWeight: '700', color: '#DC2626' }}>Overdue</Text>
          </View>
        ) : null}
        {showWhy ? (
          <Pressable testID="status-why" onPress={() => setOpen((v) => !v)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Why this status?">
            <Text style={{ fontSize: fs, fontWeight: '700', color: '#1D4ED8', textDecorationLine: 'underline' }}>{open ? 'Hide' : 'Why?'}</Text>
          </Pressable>
        ) : null}
      </View>
      {showWhy && open ? (
        <Text testID="status-why-text" className="text-2xs text-neutral-600 mt-1">
          {info.reason}
        </Text>
      ) : null}
    </View>
  );
}
