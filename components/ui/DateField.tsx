import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { CalendarPicker } from './CalendarPicker';

// @react-native-community/datetimepicker has NO web implementation — its own
// fallback source (datetimepicker.js) renders null and just console.warns
// "not supported on: web". Since this app's actual, primary test method is
// Expo web (confirmed directly with the user), importing it unconditionally
// would silently make every date field non-functional there. Loaded only on
// native platforms; web keeps using the existing hand-built CalendarPicker
// (already proven working) instead.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NativeDateTimePicker = Platform.OS !== 'web' ? require('@react-native-community/datetimepicker').default : null;

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// One consistent date-entry control used everywhere a date is set in this
// app — the platform's own native calendar picker on iOS/Android, the
// existing CalendarPicker on web — instead of a different pattern (raw
// YYYY-MM-DD text entry) per screen.
export function DateField({
  label,
  value,
  minDate,
  maxDate,
  editable = true,
  onChange,
}: {
  label?: string;
  value: string | null; // 'YYYY-MM-DD'
  minDate?: string | null;
  maxDate?: string | null;
  editable?: boolean;
  onChange: (isoDate: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      {label && <Text className="text-xs text-neutral-400 mb-1">{label}</Text>}
      <Pressable
        onPress={() => editable && setOpen(true)}
        className="border border-neutral-200 rounded-lg px-3 py-2.5"
        style={{ opacity: editable ? 1 : 0.6 }}
      >
        <Text className="text-sm text-neutral-900">{value ?? 'Select date'}</Text>
      </Pressable>

      {open && Platform.OS === 'web' && (
        <CalendarPicker value={value} minDate={minDate} maxDate={maxDate} onChange={onChange} onClose={() => setOpen(false)} />
      )}

      {open && Platform.OS === 'android' && (
        <NativeDateTimePicker
          value={value ? new Date(value) : new Date()}
          mode="date"
          display="default"
          minimumDate={minDate ? new Date(minDate) : undefined}
          maximumDate={maxDate ? new Date(maxDate) : undefined}
          onChange={(event: { type: string }, selected?: Date) => {
            setOpen(false);
            if (event.type === 'set' && selected) onChange(toISODate(selected));
          }}
        />
      )}

      {open && Platform.OS === 'ios' && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={() => setOpen(false)}>
            <Pressable onPress={() => {}} className="bg-white rounded-2xl p-3">
              <NativeDateTimePicker
                value={value ? new Date(value) : new Date()}
                mode="date"
                display="inline"
                minimumDate={minDate ? new Date(minDate) : undefined}
                maximumDate={maxDate ? new Date(maxDate) : undefined}
                onChange={(_event: { type: string }, selected?: Date) => {
                  if (selected) onChange(toISODate(selected));
                }}
              />
              <Pressable onPress={() => setOpen(false)} className="self-end mt-2 px-3 py-1.5 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
