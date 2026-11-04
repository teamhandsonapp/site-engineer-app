import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { DateField } from '../ui/DateField';
import { isItemDone, STATUS_CHIP, STATUS_ORDER, type CompletionStatus } from '../../lib/taskDetail/constants';

// Same 'MMM d' short form as admin-web's StatusDropdown — compact enough to
// sit inline next to the pill without wrapping.
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A tap-to-change status chip — offers only the 5 STATUS_ORDER options for
// a NEW selection (PROCEED is retired from the picker) but still DISPLAYS
// any of the 6 CompletionStatus values, since legacy data can still be
// PROCEED. Matches admin-web's StatusDropdown exactly.
export function StatusPicker({
  status,
  changedAtISO,
  issueDate,
  editable,
  onChange,
}: {
  status: CompletionStatus;
  // When the CURRENT status was last set — null means never changed yet
  // (still at its seeded default), in which case no date shows.
  changedAtISO?: string | null;
  // When the CURRENT status actually happened (backdatable) — see
  // ChecklistItem.issueDate's own comment.
  issueDate?: string | null;
  editable: boolean;
  onChange: (next: CompletionStatus, issueDate: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // Set once a non-"done" status is tapped, switching this same modal over
  // to the backdating step instead of closing immediately — "simply
  // checking it off" (YES/PROCEED) skips this and commits right away.
  const [pendingStatus, setPendingStatus] = useState<CompletionStatus | null>(null);
  const [pendingDate, setPendingDate] = useState(todayISODate());
  const chip = STATUS_CHIP[status];
  const today = todayISODate();

  function closeAll() {
    setOpen(false);
    setPendingStatus(null);
  }

  function selectStatus(s: CompletionStatus) {
    if (isItemDone(s)) {
      closeAll();
      onChange(s, null);
      return;
    }
    setPendingDate(today);
    setPendingStatus(s);
  }

  function confirmBackdated() {
    const s = pendingStatus;
    closeAll();
    if (s) onChange(s, pendingDate);
  }

  const changedDateShort = changedAtISO ? formatShortDate(changedAtISO) : null;
  const issueDateShort = issueDate ? formatShortDate(`${issueDate}T00:00:00`) : null;
  // "Issue: Aug 5 · logged Aug 10" when backdated to a different day than it
  // was entered; otherwise just the one date, same as before this existed.
  const dateLabel =
    issueDateShort && issueDateShort !== changedDateShort
      ? `Issue ${issueDateShort} · logged ${changedDateShort}`
      : changedDateShort;

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
          {dateLabel && <Text className="font-normal" style={{ opacity: 0.75 }}> · {dateLabel}</Text>}
        </Text>
      </Pressable>

      {open && (
        <Modal visible transparent animationType="fade" onRequestClose={closeAll}>
          <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={closeAll}>
            <Pressable onPress={() => {}} className="bg-white rounded-2xl p-3" style={{ width: '100%', maxWidth: 300 }}>
              {pendingStatus ? (
                <View className="p-1">
                  <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">
                    When did this happen?
                  </Text>
                  <DateField value={pendingDate} maxDate={today} onChange={setPendingDate} />
                  <View className="flex-row justify-end gap-2 mt-3.5">
                    <Pressable onPress={closeAll} className="px-3.5 py-2 rounded-lg">
                      <Text className="text-xs font-semibold text-neutral-500">Cancel</Text>
                    </Pressable>
                    <Pressable onPress={confirmBackdated} className="px-3.5 py-2 rounded-lg bg-brand-navy">
                      <Text className="text-xs font-bold text-white">Confirm</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-2 px-1">Set status</Text>
                  <View className="gap-1">
                    {STATUS_ORDER.map((s) => {
                      const c = STATUS_CHIP[s];
                      const active = s === status;
                      return (
                        <Pressable
                          key={s}
                          onPress={() => selectStatus(s)}
                          className={`flex-row items-center gap-2 px-3 py-2.5 rounded-lg ${active ? 'bg-neutral-100' : ''}`}
                        >
                          <View className="w-2 h-2 rounded-full" style={{ backgroundColor: c.dot }} />
                          <Text className="text-sm font-medium text-neutral-800">{c.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}
