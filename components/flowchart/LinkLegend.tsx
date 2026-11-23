import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../ui/AppText';
import { LINK_INFO, LINK_TYPE_ORDER } from '../../lib/flowchart/linkTypes';
import { LinkStylePreview } from './LinkTypeModal';

// Flowchart › "Links" toggle: the 4 line styles with code + meaning. Same
// small swatch + text-2xs look as the Gantt legend; wraps on narrow screens.
export function LinkLegend({ style }: { style?: object }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={style} pointerEvents="box-none">
      {open ? (
        <View testID="link-legend" className="bg-white rounded-xl border border-neutral-200 px-3 py-2.5 mb-1.5" style={{ elevation: 3, maxWidth: 340 }}>
          <View className="flex-row flex-wrap gap-x-4 gap-y-2">
            {LINK_TYPE_ORDER.map((t) => (
              <View key={t} className="flex-row items-center gap-1.5" style={{ minWidth: 140 }}>
                <LinkStylePreview type={t} width={34} />
                <Text className="text-2xs text-neutral-600">
                  <Text className="text-2xs font-bold text-neutral-900">{t}</Text> {LINK_INFO[t].short}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <Pressable
        testID="link-legend-toggle"
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide link types' : 'Show link types'}
        className="flex-row items-center gap-1.5 self-start bg-white rounded-xl border border-neutral-200 px-3"
        style={{ elevation: 3, minHeight: 40 }}
      >
        <Ionicons name="git-network-outline" size={15} color="#0F1F33" />
        <Text className="text-2xs font-bold text-brand-navy">{open ? 'Hide links' : 'Link types'}</Text>
      </Pressable>
    </View>
  );
}
