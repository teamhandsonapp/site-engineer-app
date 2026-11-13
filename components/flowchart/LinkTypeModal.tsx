import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '../ui/AppText';
import { FormModal } from '../ui/FormModal';
import { LINK_COLOR, LINK_INFO, LINK_STYLE, LINK_TYPE_ORDER } from '../../lib/flowchart/linkTypes';
import type { DependencyType, RelationshipType } from '../../lib/flowchart/types';

/** Small sample of a link's line style (used in this picker and the legend). */
export function LinkStylePreview({ type, width = 44 }: { type: DependencyType; width?: number }) {
  const s = LINK_STYLE[type];
  return (
    <Svg width={width} height={12}>
      {s.double ? (
        <>
          <Line x1={2} y1={3.5} x2={width - 8} y2={3.5} stroke={LINK_COLOR} strokeWidth={1.5} />
          <Line x1={2} y1={8.5} x2={width - 8} y2={8.5} stroke={LINK_COLOR} strokeWidth={1.5} />
        </>
      ) : (
        <Line x1={2} y1={6} x2={width - 8} y2={6} stroke={LINK_COLOR} strokeWidth={s.cap === 'round' ? 3 : 2} strokeDasharray={s.dash} strokeLinecap={s.cap ?? 'butt'} />
      )}
      <Line x1={width - 9} y1={2} x2={width - 2} y2={6} stroke={LINK_COLOR} strokeWidth={2} />
      <Line x1={width - 9} y1={10} x2={width - 2} y2={6} stroke={LINK_COLOR} strokeWidth={2} />
    </Svg>
  );
}

// Shown after tapping two tasks (A first, then B), and for "Change type" on
// an existing link. FS is pre-selected (most common); tap a row to select,
// then confirm. Parallel (non-blocking, visual only) stays available when
// creating, as before.
export function LinkTypeModal({
  onSelect,
  onCancel,
  initial = 'FS',
  allowParallel = true,
  title = 'How are these tasks related?',
  confirmLabel = 'Link tasks',
  fromName,
  toName,
}: {
  onSelect: (type: RelationshipType) => void;
  onCancel: () => void;
  initial?: RelationshipType;
  allowParallel?: boolean;
  title?: string;
  confirmLabel?: string;
  fromName?: string;
  toName?: string;
}) {
  const [picked, setPicked] = useState<RelationshipType>(initial);
  const options: RelationshipType[] = allowParallel ? [...LINK_TYPE_ORDER, 'PARALLEL'] : LINK_TYPE_ORDER;
  return (
    <FormModal visible onRequestClose={onCancel}>
      <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 400 }}>
        <View className="bg-white rounded-2xl p-4">
          <Text className="text-base font-bold text-neutral-900">{title}</Text>
          {fromName && toName ? (
            <Text className="text-2xs text-neutral-500 mt-0.5 mb-3" numberOfLines={2}>
              A: {fromName} → B: {toName}
            </Text>
          ) : (
            <View className="mb-3" />
          )}
          <View className="gap-1.5">
            {options.map((t) => {
              const on = picked === t;
              return (
                <Pressable
                  key={t}
                  testID={`link-type-${t}`}
                  onPress={() => setPicked(t)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  className="flex-row items-center gap-3 rounded-xl px-3"
                  style={{ minHeight: 52, borderWidth: on ? 2 : 1, borderColor: on ? '#0F1F33' : '#E5E7EB', backgroundColor: on ? '#F8FAFC' : '#fff' }}
                >
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? '#0F1F33' : '#9CA3AF'} />
                  <View className="flex-1 py-1.5">
                    <Text className="text-sm font-semibold text-neutral-900">
                      {t === 'PARALLEL' ? 'Parallel' : `${t} · ${LINK_INFO[t].name}`}
                    </Text>
                    <Text className="text-2xs text-neutral-500" numberOfLines={2}>
                      {t === 'PARALLEL' ? 'Runs alongside — no blocking order between them' : LINK_INFO[t].meaning}
                    </Text>
                  </View>
                  {t === 'PARALLEL' ? (
                    <Svg width={44} height={12}>
                      <Line x1={2} y1={6} x2={42} y2={6} stroke="#2563EB" strokeWidth={2} strokeDasharray="6,5" />
                    </Svg>
                  ) : (
                    <LinkStylePreview type={t} />
                  )}
                </Pressable>
              );
            })}
          </View>
          <View className="flex-row gap-2 mt-4">
            <Pressable onPress={onCancel} className="flex-1 items-center justify-center rounded-xl border border-neutral-200" style={{ minHeight: 44 }}>
              <Text className="text-sm font-semibold text-neutral-700">Cancel</Text>
            </Pressable>
            <Pressable
              testID="link-type-confirm"
              onPress={() => onSelect(picked)}
              className="flex-1 items-center justify-center rounded-xl bg-brand-navy"
              style={{ minHeight: 44 }}
            >
              <Text className="text-sm font-bold text-white">{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </FormModal>
  );
}
