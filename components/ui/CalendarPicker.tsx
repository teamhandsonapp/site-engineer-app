import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

// A plain month-grid calendar, built from scratch in RN primitives — no
// native date-picker dependency added for this. This app has no native
// date/document picker installed anywhere yet (see e.g. DrawingRevisionDrawer's
// own comment on the same tradeoff for file uploads), and pulling one in
// means a new EAS build cycle before it can even be tried on a device; a
// pure-JS month grid needs neither.
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = first.getDay();
  const cells: (Date | null)[] = Array.from({ length: startWeekday }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

export function CalendarPicker({
  value,
  minDate,
  onChange,
  onClose,
}: {
  value: string | null; // 'YYYY-MM-DD'
  minDate?: string | null;
  onChange: (isoDate: string) => void;
  onClose: () => void;
}) {
  const initial = value ? new Date(value) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  const cells = buildMonthGrid(viewYear, viewMonth);
  const minTime = minDate ? new Date(minDate).setHours(0, 0, 0, 0) : null;

  function goMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4" style={{ width: '100%', maxWidth: 340 }}>
          <View className="flex-row items-center justify-between mb-3">
            <Pressable onPress={() => goMonth(-1)} className="px-2 py-1">
              <Text className="text-lg text-neutral-500">‹</Text>
            </Pressable>
            <Text className="text-sm font-bold text-neutral-900">{MONTH_LABELS[viewMonth]} {viewYear}</Text>
            <Pressable onPress={() => goMonth(1)} className="px-2 py-1">
              <Text className="text-lg text-neutral-500">›</Text>
            </Pressable>
          </View>

          <View className="flex-row mb-1">
            {WEEKDAY_LABELS.map((w, i) => (
              <View key={i} style={{ width: '14.28%' }} className="items-center py-1">
                <Text className="text-2xs font-bold text-neutral-400">{w}</Text>
              </View>
            ))}
          </View>

          <View className="flex-row flex-wrap">
            {cells.map((cell, i) => {
              if (!cell) return <View key={i} style={{ width: '14.28%' }} className="py-1.5" />;
              const iso = toISODate(cell);
              const isSelected = value === iso;
              const isDisabled = minTime != null && cell.getTime() < minTime;
              return (
                <View key={i} style={{ width: '14.28%' }} className="items-center py-1">
                  <Pressable
                    disabled={isDisabled}
                    onPress={() => { onChange(iso); onClose(); }}
                    className="w-8 h-8 items-center justify-center rounded-full"
                    style={{ backgroundColor: isSelected ? '#0F1F33' : 'transparent' }}
                  >
                    <Text
                      className="text-xs font-medium"
                      style={{ color: isDisabled ? '#D4D4D4' : isSelected ? '#ffffff' : '#262626' }}
                    >
                      {cell.getDate()}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Pressable onPress={onClose} className="self-end mt-3 px-3 py-1.5 rounded-lg bg-neutral-100">
            <Text className="text-xs font-semibold text-neutral-600">Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
