import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { fetchStatusHistory, type StatusHistoryEntry } from '../../lib/taskDetail/data';
import { STATUS_CHIP, type CompletionStatus } from '../../lib/taskDetail/constants';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDateOnly(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// "Issue reported for Aug 5 — logged on Aug 10" — both dates shown when a
// change was backdated, since they answer two different questions (when it
// happened vs. when it was entered).
function historyLine(h: StatusHistoryEntry): string {
  const who = h.changedByName ?? 'Unknown';
  return h.issueDate
    ? `Issue reported for ${formatDateOnly(h.issueDate)} — logged by ${who} on ${formatDateTime(h.changedAtISO)}`
    : `Changed by ${who} · ${formatDateTime(h.changedAtISO)}`;
}

function Chip({ status }: { status: CompletionStatus }) {
  const c = STATUS_CHIP[status];
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: c.bg }}>
      <Text className="text-2xs font-bold" style={{ color: c.text }}>{c.label}</Text>
    </View>
  );
}

export function StatusHistoryDrawer({
  itemId,
  itemLabel,
  currentStatus,
  onClose,
}: {
  itemId: string;
  itemLabel: string;
  currentStatus: CompletionStatus;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatusHistory(itemId).then(setHistory).finally(() => setLoading(false));
  }, [itemId]);

  const latest = history[0] ?? null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4" style={{ width: '100%', maxWidth: 380, maxHeight: '75%' }}>
          <Text className="text-sm font-bold text-neutral-900">Status history</Text>
          <Text className="text-xs text-neutral-400 mb-3">{itemLabel}</Text>

          <View className="bg-neutral-50 rounded-xl p-3 mb-3">
            <Chip status={currentStatus} />
            <Text className="text-2xs text-neutral-400 mt-1.5">
              {latest ? historyLine(latest) : 'No changes yet'}
            </Text>
          </View>

          <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">History</Text>
          {loading ? (
            <ActivityIndicator color="#0F1F33" />
          ) : history.length === 0 ? (
            <Text className="text-xs text-neutral-400 py-2">No changes yet — this item is still at its default status.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 260 }}>
              {history.map((h) => (
                <View key={h.id} className="py-2 border-b border-neutral-50">
                  <View className="flex-row items-center gap-1.5">
                    {h.oldStatus && <Chip status={h.oldStatus} />}
                    {h.oldStatus && <Text className="text-neutral-300">→</Text>}
                    <Chip status={h.newStatus} />
                  </View>
                  <Text className="text-2xs text-neutral-400 mt-1">{historyLine(h)}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          <Pressable onPress={onClose} className="self-end mt-3 px-3 py-1.5 rounded-lg bg-neutral-100">
            <Text className="text-xs font-semibold text-neutral-600">Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
