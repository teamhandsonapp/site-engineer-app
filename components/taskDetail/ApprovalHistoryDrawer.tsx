import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchApprovalRounds, recordApprovalRound, type ApprovalRoundRow } from '../../lib/taskDetail/data';
import type { ApprovalOutcome } from '../../lib/taskDetail/constants';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const OUTCOME_STYLE: Record<ApprovalOutcome, { bg: string; text: string; label: string }> = {
  APPROVED: { bg: '#DCFCE7', text: '#15803D', label: 'Approved' },
  REJECTED: { bg: '#FEE2E2', text: '#B91C1C', label: 'Rejected' },
};

// The approval-side counterpart to DrawingRevisionDrawer.tsx — same shape
// (a numbered, dated, append-only log, one entry per submit-and-decide
// round), A0/A1/A2/... instead of R0/R1/R2/.... Every round gets its own
// number regardless of outcome — a rejection followed by a resubmission is
// A1, not a retry of A0, so the full history (including past rejections)
// is never overwritten or lost.
export function ApprovalHistoryDrawer({
  itemId,
  itemLabel,
  recordedBy,
  onClose,
}: {
  itemId: string;
  itemLabel: string;
  recordedBy: string;
  onClose: () => void;
}) {
  const [rounds, setRounds] = useState<ApprovalRoundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ApprovalOutcome>('APPROVED');
  const [note, setNote] = useState('');
  const [recording, setRecording] = useState(false);

  function load() {
    setLoading(true);
    fetchApprovalRounds(itemId)
      .then(setRounds)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [itemId]);

  // 0-indexed (2026-08-17): first approval round is A0, not A1 — same
  // change as DrawingRevisionDrawer's R-numbering, for consistency between
  // the two "numbered, dated, append-only log" features on this screen.
  const currentMax = rounds[0]?.approvalNumber ?? -1;

  async function handleRecord() {
    setRecording(true);
    setError(null);
    try {
      await recordApprovalRound(itemId, outcome, note.trim() || null, recordedBy, currentMax);
      setNote('');
      setOutcome('APPROVED');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this round');
    } finally {
      setRecording(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4" style={{ width: '100%', maxWidth: 400, maxHeight: '75%' }}>
          <Text className="text-sm font-bold text-neutral-900">Approval history</Text>
          <Text className="text-xs text-neutral-400 mb-3">{itemLabel}</Text>

          {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}

          <View className="flex-row items-center gap-2 mb-2">
            <Pressable
              onPress={() => setOutcome('APPROVED')}
              className="flex-1 items-center py-2 rounded-lg"
              style={{ backgroundColor: outcome === 'APPROVED' ? '#15803D' : '#F5F5F5' }}
            >
              <Text className="text-xs font-bold" style={{ color: outcome === 'APPROVED' ? '#ffffff' : '#525252' }}>Approved</Text>
            </Pressable>
            <Pressable
              onPress={() => setOutcome('REJECTED')}
              className="flex-1 items-center py-2 rounded-lg"
              style={{ backgroundColor: outcome === 'REJECTED' ? '#B91C1C' : '#F5F5F5' }}
            >
              <Text className="text-xs font-bold" style={{ color: outcome === 'REJECTED' ? '#ffffff' : '#525252' }}>Rejected</Text>
            </Pressable>
          </View>

          <View className="flex-row items-center gap-2 mb-3">
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Note (optional)"
              className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900"
            />
            <Pressable onPress={handleRecord} disabled={recording} className="px-3 py-2.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
              {recording ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-circle-outline" size={14} color="#fff" />}
              <Text className="text-xs font-semibold text-white">Record (A{currentMax + 1})</Text>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator color="#0F1F33" />
          ) : (
            <ScrollView style={{ maxHeight: 260 }}>
              {rounds.length === 0 ? (
                <Text className="text-xs text-neutral-400 py-2">No approval rounds recorded yet.</Text>
              ) : (
                rounds.map((r) => {
                  const style = OUTCOME_STYLE[r.outcome];
                  return (
                    <View key={r.id} className="flex-row items-start gap-2 py-2 border-b border-neutral-50">
                      <View className="px-1.5 py-0.5 rounded bg-neutral-100">
                        <Text className="text-2xs font-bold text-neutral-600">A{r.approvalNumber}</Text>
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center gap-1.5">
                          <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: style.bg }}>
                            <Text className="text-2xs font-bold" style={{ color: style.text }}>{style.label}</Text>
                          </View>
                          <Text className="text-2xs text-neutral-400">
                            {r.recorderName ?? 'Unknown'} · {formatDate(r.recordedAtISO)}
                          </Text>
                        </View>
                        {r.note && <Text className="text-xs text-neutral-600 mt-1">{r.note}</Text>}
                      </View>
                    </View>
                  );
                })
              )}
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
