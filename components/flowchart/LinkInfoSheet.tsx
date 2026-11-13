import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../ui/AppText';
import { FormModal } from '../ui/FormModal';
import { explainLink, LINK_INFO, LINK_WARNING_COLOR, linkDateWarning } from '../../lib/flowchart/linkTypes';
import type { FlowchartSeriesEdge, FlowchartTask } from '../../lib/flowchart/types';
import { LinkStylePreview } from './LinkTypeModal';

// Tapping a link's label: what the link means in plain English (real task
// names), any date problem, and — when the canvas is in edit mode — Change
// type / Delete link.
export function LinkInfoSheet({
  edge,
  from,
  to,
  editable,
  onChangeType,
  onDelete,
  onClose,
}: {
  edge: FlowchartSeriesEdge;
  from: FlowchartTask; // A, predecessor
  to: FlowchartTask; // B, successor
  editable: boolean;
  onChangeType: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const warning = linkDateWarning(edge.type, from, to);
  return (
    <FormModal visible onRequestClose={onClose} position="bottom" animationType="slide">
      <View className="bg-white rounded-t-2xl px-4 pt-3 w-full self-center" style={{ maxWidth: 560, paddingBottom: insets.bottom + 16 }}>
        <View className="flex-row items-center gap-2 mb-2">
          <View className="rounded px-1.5 py-0.5" style={{ borderWidth: 1.5, borderColor: warning ? LINK_WARNING_COLOR : '#D97706' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: warning ? LINK_WARNING_COLOR : '#111827' }}>{edge.type}</Text>
          </View>
          <Text className="flex-1 text-sm font-bold text-neutral-900">{LINK_INFO[edge.type].name}</Text>
          <LinkStylePreview type={edge.type} />
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color="#6B7280" />
          </Pressable>
        </View>

        <Text testID="link-info-sentence" className="text-base text-neutral-900">
          {explainLink(edge.type, from.taskName, to.taskName)}.
        </Text>
        <Text className="text-2xs text-neutral-500 mt-1" numberOfLines={2}>
          A: {from.taskName} → B: {to.taskName}
        </Text>

        {warning ? (
          <View testID="link-info-warning" className="flex-row gap-2 rounded-xl px-3 py-2.5 mt-3" style={{ backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' }}>
            <Ionicons name="warning-outline" size={16} color={LINK_WARNING_COLOR} style={{ marginTop: 1 }} />
            <Text className="flex-1 text-xs" style={{ color: '#991B1B' }}>
              Dates don’t match this link: {warning} The dates were not changed — adjust them in the task if needed.
            </Text>
          </View>
        ) : null}

        {editable ? (
          <View className="flex-row gap-2 mt-4">
            <Pressable
              testID="link-info-change-type"
              onPress={onChangeType}
              className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-neutral-200"
              style={{ minHeight: 44 }}
            >
              <Ionicons name="swap-horizontal" size={16} color="#0F1F33" />
              <Text className="text-sm font-semibold text-brand-navy">Change type</Text>
            </Pressable>
            <Pressable
              testID="link-info-delete"
              onPress={onDelete}
              className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl"
              style={{ minHeight: 44, backgroundColor: '#FEF2F2' }}
            >
              <Ionicons name="trash-outline" size={16} color="#DC2626" />
              <Text className="text-sm font-semibold" style={{ color: '#DC2626' }}>Delete link</Text>
            </Pressable>
          </View>
        ) : (
          <Text className="text-2xs text-neutral-400 mt-3">Unlock the flowchart (Editing) to change or delete this link.</Text>
        )}
      </View>
    </FormModal>
  );
}
