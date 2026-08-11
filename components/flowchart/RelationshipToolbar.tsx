import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RelationshipType } from '../../lib/flowchart/types';

export type ToolMode = 'select' | RelationshipType;

const TOOLS: { key: ToolMode; label: string }[] = [
  { key: 'select', label: 'Select' },
  { key: 'FS', label: 'FS' },
  { key: 'SS', label: 'SS' },
  { key: 'FF', label: 'FF' },
  { key: 'SF', label: 'SF' },
  { key: 'PARALLEL', label: 'Parallel' },
];

// Replaces the old top-left "Select/Link" pill toggle. Placed as a full-
// width BOTTOM toolbar instead, for two reasons: (1) it needs to hold 6
// clearly-labeled options now (Select + all 5 relationship types) instead
// of 2 — a small top-left corner has no room to grow into that without
// becoming cramped/hard to tap precisely; (2) the active tool needs to stay
// VISIBLE and thumb-reachable the whole time someone is chaining several
// links of the same type in a row (matching admin-web's own persistent
// side-panel-as-toolbar model — see FlowchartCanvas's own comment on why
// the active type is deliberately never reset after a successful link).
// Bottom placement also keeps it clear of the top-left/top-right overlays
// (lock toggle, link-error banner) that already live near the top edge.
export function RelationshipToolbar({ active, onSelect }: { active: ToolMode; onSelect: (mode: ToolMode) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="absolute left-0 right-0 bottom-0 bg-white border-t border-neutral-200 px-3 pt-2.5"
      style={{ paddingBottom: Math.max(insets.bottom, 10), elevation: 6 }}
    >
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5 px-0.5">Link type</Text>
      <View className="flex-row gap-1.5">
        {TOOLS.map((tool) => {
          const isActive = active === tool.key;
          return (
            <Pressable
              key={tool.key}
              onPress={() => onSelect(tool.key)}
              className={`flex-1 items-center justify-center py-2.5 rounded-lg ${isActive ? 'bg-brand-navy' : 'bg-neutral-50'}`}
              style={{ minHeight: 40 }}
            >
              {/* 6 buttons across the smallest real phone widths leaves very
                  little room for "Parallel" specifically — shrinking rather
                  than clipping/wrapping is the safe choice without a device
                  on hand to verify the exact pixel fit (see PROJECT
                  memory: no mobile simulator available on this machine). */}
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                className={`text-2xs font-bold ${isActive ? 'text-white' : 'text-neutral-500'}`}
              >
                {tool.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
