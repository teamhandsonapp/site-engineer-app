import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  acknowledgeCriticalAlertMessage,
  fetchMyPendingCriticalAlerts,
  type CriticalAlertMessage,
} from '../lib/criticalAlertMessages';

// While the app is open, a new alert shows within this long even if its push
// was missed (permission off, OS delayed it). Cheap: one filtered,
// index-backed query returning zero rows almost every time.
const POLL_MS = 30_000;

// Blocking popup for the field role — an admin/manager's critical alert
// (Settings → Send Critical Alert, or Critical Alerts → compose) must be
// seen and acknowledged, not just land in a list. Shows the oldest pending
// alert first; acknowledging reveals the next one. Mounted once in the
// authenticated drawer layout so it appears over whatever screen is open.
export function CriticalAlertPopup({ userId }: { userId: string }) {
  const [pending, setPending] = useState<CriticalAlertMessage[]>([]);
  const [acking, setAcking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchMyPendingCriticalAlerts(userId)
      .then(setPending)
      .catch(() => {}); // transient — the next poll tries again
  }, [userId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, POLL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [refresh]);

  const current = pending[0];
  if (!current) return null;

  async function handleAcknowledge() {
    setAcking(true);
    setError(null);
    try {
      await acknowledgeCriticalAlertMessage(current.id, userId);
      setPending((prev) => prev.slice(1));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcking(false);
    }
  }

  const sentAt = new Date(current.createdAtISO).toLocaleString([], {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View className="flex-1 bg-black/60 items-center justify-center px-6">
        <View className="w-full rounded-2xl bg-white overflow-hidden" style={{ maxWidth: 400 }}>
          <View className="bg-red-600 px-5 py-4 flex-row items-center gap-2">
            <Ionicons name="warning" size={22} color="#fff" />
            <Text className="text-md font-bold text-white flex-1">Critical Alert</Text>
            {pending.length > 1 && (
              <Text className="text-xs font-semibold text-white/80">1 of {pending.length}</Text>
            )}
          </View>
          <View className="px-5 pt-4 pb-5">
            <Text className="text-2xs text-neutral-400 mb-2">
              From {current.senderName ?? 'Admin'}
              {current.projectName ? ` · ${current.projectName}` : ''} · {sentAt}
            </Text>
            <Text className="text-md text-neutral-900 leading-6 mb-5">{current.message}</Text>
            {error && <Text className="text-xs text-red-600 mb-3">{error}</Text>}
            <Pressable
              onPress={handleAcknowledge}
              disabled={acking}
              className="py-3 rounded-lg bg-red-600 items-center flex-row justify-center gap-2"
              style={{ opacity: acking ? 0.7 : 1 }}
            >
              {acking && <ActivityIndicator size="small" color="#fff" />}
              <Text className="text-sm font-semibold text-white">Acknowledge</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
