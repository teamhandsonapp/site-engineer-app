import { useState } from 'react';
import { Dimensions, Modal, Pressable, Text, View } from 'react-native';
import {
  CATEGORY_LABELS,
  STATUS_CHIP,
  checklistHealthByCategory,
  type CategoryHealth,
  type ChecklistItem,
} from '../../lib/checklistHealth';

const BOX_SIZE = 9;
const BOX_GAP = 3;
const POPOVER_WIDTH = 230;

interface OpenPopover {
  category: CategoryHealth;
  x: number;
  y: number;
}

// Replaces the old single worst-status dot + full-page modal (see
// ChecklistHealthModal, now removed) — that surfaced every category's every
// item (potentially 30+ rows) from one tap, and fully replaced the Gantt
// view to do it. This shows one small box PER CATEGORY that actually has
// items (max 6, in a fixed order — see checklistHealthByCategory), each
// colored by that category's own worst status. Tapping a box shows ONLY
// that category's items in a small card anchored near the tap point,
// staying on top of the Gantt rather than navigating away from it.
export function CategoryHealthBoxes({ items }: { items: ChecklistItem[] }) {
  const categories = checklistHealthByCategory(items);
  const [open, setOpen] = useState<OpenPopover | null>(null);

  if (categories.length === 0) return null;

  const screen = Dimensions.get('window');
  const estimatedHeight = open ? 56 + open.category.items.length * 40 : 0;
  const left = open
    ? Math.min(Math.max(open.x - POPOVER_WIDTH / 2, 10), screen.width - POPOVER_WIDTH - 10)
    : 0;
  const wouldOverflowBottom = open ? open.y + 16 + estimatedHeight > screen.height - 20 : false;
  const top = open
    ? wouldOverflowBottom
      ? Math.max(open.y - estimatedHeight - 12, 20)
      : open.y + 16
    : 0;

  return (
    <>
      {/* Boxes row — a free-floating overlay anchored to the row's
          top-left corner, same corner the old single dot used, not a
          replacement for the bar's own status color underneath it. */}
      <View className="absolute flex-row" style={{ top: 4, left: 4, gap: BOX_GAP, zIndex: 5 }}>
        {categories.map((cat) => (
          <Pressable
            key={cat.category}
            hitSlop={6}
            onPress={(e) => {
              e.stopPropagation();
              const { pageX, pageY } = e.nativeEvent;
              setOpen({ category: cat, x: pageX, y: pageY });
            }}
            style={{
              width: BOX_SIZE,
              height: BOX_SIZE,
              borderRadius: 2,
              backgroundColor: STATUS_CHIP[cat.status].dot,
              borderWidth: 1,
              borderColor: '#fff',
            }}
          />
        ))}
      </View>

      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable className="flex-1" onPress={() => setOpen(null)}>
          {open && (
            <Pressable
              onPress={() => {}}
              className="absolute bg-white rounded-xl border border-neutral-200 p-3"
              style={{
                left,
                top,
                width: POPOVER_WIDTH,
                elevation: 6,
                shadowColor: '#000',
                shadowOpacity: 0.15,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
              }}
            >
              <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">
                {CATEGORY_LABELS[open.category.category]}
              </Text>
              <View className="gap-1.5">
                {open.category.items.map((item, i) => {
                  const chip = STATUS_CHIP[item.status];
                  return (
                    <View key={i} className="flex-row items-center justify-between gap-2">
                      <Text className="text-xs text-neutral-700 flex-1" numberOfLines={2}>{item.itemLabel}</Text>
                      <View
                        className="flex-row items-center gap-1 px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: chip.bg }}
                      >
                        <View className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: chip.dot }} />
                        <Text className="text-2xs font-semibold" style={{ color: chip.text }}>{chip.label}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </>
  );
}
