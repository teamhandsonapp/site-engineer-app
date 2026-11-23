import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Text } from '../ui/AppText';
import { FormModal, useBackdropGuard } from '../ui/FormModal';

// Pop-up from a Flowchart 2 card's note icon (2026-11-18, client request):
// fill a task's DPR or PR straight from the board instead of going through
// the DPR tab. Both buttons open the SAME pages the DPR tab uses
// (app/dpr-edit/[taskId].tsx and app/pr-edit/[taskId].tsx), so everything
// saves to the same records; Back on those pages returns to the flowchart.
export function DprPrChooser({
  task,
  onClose,
}: {
  task: { id: string; taskId: string; taskName: string } | null;
  onClose: () => void;
}) {
  // The tap that opened this pop-up can land on its backdrop a moment later
  // (web: the click after pointer-up) and close it straight away — so
  // backdrop taps are ignored for the first moment after opening (2026-11-18).
  const guardedClose = useBackdropGuard(!!task, onClose);

  function open(path: string) {
    onClose();
    router.push(path as never);
  }

  const options = task
    ? [
        {
          key: 'dpr',
          icon: 'document-text-outline' as const,
          title: 'DPR',
          sub: 'Daily Progress Report: day by day',
          path: `/dpr-edit/${task.id}`,
        },
        {
          key: 'pr',
          icon: 'speedometer-outline' as const,
          title: 'PR',
          sub: 'Progress Report: one cumulative % and reasons for delay',
          path: `/pr-edit/${task.id}`,
        },
      ]
    : [];

  return (
    <FormModal visible={!!task} onRequestClose={onClose} onBackdropPress={guardedClose}>
      <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 340 }}>
        <View testID="dpr-pr-chooser" className="bg-white rounded-2xl p-4">
          <Text className="text-2xs font-extrabold text-neutral-500">{task?.taskId}</Text>
          <Text className="text-sm font-bold text-neutral-900 mb-3" numberOfLines={2}>
            {task?.taskName}
          </Text>
          <View className="gap-2">
            {options.map((o) => (
              <Pressable
                key={o.key}
                testID={`dpr-pr-chooser-${o.key}`}
                accessibilityRole="button"
                accessibilityLabel={`Open ${o.title}`}
                onPress={() => open(o.path)}
                className="flex-row items-center gap-3 rounded-xl border border-neutral-200 px-3"
                style={{ minHeight: 56 }}
              >
                <View className="items-center justify-center rounded-lg bg-brand-navy" style={{ width: 34, height: 34 }}>
                  <Ionicons name={o.icon} size={18} color="#fff" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-neutral-900">{o.title}</Text>
                  <Text className="text-2xs text-neutral-500 mt-0.5">{o.sub}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onClose} className="self-end mt-3 px-3 py-1.5 rounded-lg bg-neutral-100">
            <Text className="text-xs font-semibold text-neutral-700">Close</Text>
          </Pressable>
        </View>
      </Pressable>
    </FormModal>
  );
}
