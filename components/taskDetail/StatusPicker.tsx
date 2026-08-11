import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { STATUS_CHIP, STATUS_ORDER, type CompletionStatus } from '../../lib/taskDetail/constants';

// Same 'MMM d' short form as admin-web's StatusDropdown — compact enough to
// sit inline next to the pill without wrapping.
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// A tap-to-change status chip — offers only the 5 STATUS_ORDER options for
// a NEW selection (PROCEED is retired from the picker) but still DISPLAYS
// any of the 6 CompletionStatus values, since legacy data can still be
// PROCEED. Matches admin-web's StatusDropdown exactly.
export function StatusPicker({
  status,
  changedAtISO,
  editable,
  onChange,
}: {
  status: CompletionStatus;
  // When the CURRENT status was last set — null means never changed yet
  // (still at its seeded default), in which case no date shows.
  changedAtISO?: string | null;
  editable: boolean;
  onChange: (next: CompletionStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const chip = STATUS_CHIP[status];

  return (
    <>
      <Pressable
        onPress={() => editable && setOpen(true)}
        className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full self-start"
        style={{ backgroundColor: chip.bg }}
      >
        <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: chip.dot }} />
        <Text className="text-2xs font-bold" style={{ color: chip.text }}>
          {chip.label}
          {changedAtISO && <Text className="font-normal" style={{ opacity: 0.75 }}> · {formatShortDate(changedAtISO)}</Text>}
        </Text>
      </Pressable>

      {open && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={() => setOpen(false)}>
            <Pressable onPress={() => {}} className="bg-white rounded-2xl p-3" style={{ width: '100%', maxWidth: 300 }}>
              <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-2 px-1">Set status</Text>
              <View className="gap-1">
                {STATUS_ORDER.map((s) => {
                  const c = STATUS_CHIP[s];
                  const active = s === status;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => { setOpen(false); onChange(s); }}
                      className={`flex-row items-center gap-2 px-3 py-2.5 rounded-lg ${active ? 'bg-neutral-100' : ''}`}
                    >
                      <View className="w-2 h-2 rounded-full" style={{ backgroundColor: c.dot }} />
                      <Text className="text-sm font-medium text-neutral-800">{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}
