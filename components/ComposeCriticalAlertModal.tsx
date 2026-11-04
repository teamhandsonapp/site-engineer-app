import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchProjectEngineers, sendCriticalAlertMessage, type ProjectEngineer } from '../lib/criticalAlertMessages';

// The compose half of the two-way Critical Alert feature — admin/manager
// picks a specific engineer (recipientId set); a field engineer just types,
// no recipient picker at all (recipientId stays null, which the server-side
// notify_critical_alert_message function resolves to "every admin/manager
// configured for this project," same role-based reach every other alert
// type here already uses).
export function ComposeCriticalAlertModal({
  visible,
  mode,
  projectId,
  projectName,
  senderId,
  onClose,
  onSent,
}: {
  visible: boolean;
  mode: 'admin' | 'engineer';
  projectId: string;
  projectName: string | null;
  senderId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [engineers, setEngineers] = useState<ProjectEngineer[]>([]);
  const [loadingEngineers, setLoadingEngineers] = useState(mode === 'admin');
  const [selectedEngineerId, setSelectedEngineerId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // Reset on every open — a stale draft/selection from a previous send
    // shouldn't silently carry over to the next one.
    setMessage('');
    setSelectedEngineerId(null);
    setError(null);
    if (mode === 'admin') {
      setLoadingEngineers(true);
      fetchProjectEngineers(projectId)
        .then(setEngineers)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoadingEngineers(false));
    }
  }, [visible, mode, projectId]);

  const canSend = message.trim().length > 0 && (mode === 'engineer' || selectedEngineerId != null) && !sending;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await sendCriticalAlertMessage(projectId, mode === 'admin' ? selectedEngineerId : null, message, senderId);
      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const selectedEngineer = engineers.find((e) => e.id === selectedEngineerId) ?? null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4 w-full" style={{ maxWidth: 380, maxHeight: '80%' }}>
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-md font-bold text-neutral-900">
              {mode === 'admin' ? 'Send Critical Alert' : 'Report Issue'}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#9CA3AF" />
            </Pressable>
          </View>
          <Text className="text-xs text-neutral-400 mb-3">
            {mode === 'admin'
              ? `Reaches the selected engineer directly on ${projectName ?? 'this project'} — a real push notification, not just an in-app message.`
              : `Reaches admin/manager on ${projectName ?? 'this project'} immediately — a real push notification, not just an in-app message.`}
          </Text>

          {mode === 'admin' && (
            <View className="mb-3">
              <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Recipient</Text>
              {loadingEngineers ? (
                <ActivityIndicator color="#0F1F33" />
              ) : engineers.length === 0 ? (
                <Text className="text-xs text-neutral-400">No engineers assigned to this project yet.</Text>
              ) : (
                <ScrollView style={{ maxHeight: 140 }}>
                  {engineers.map((eng) => {
                    const active = eng.id === selectedEngineerId;
                    return (
                      <Pressable
                        key={eng.id}
                        onPress={() => setSelectedEngineerId(eng.id)}
                        className={`flex-row items-center justify-between px-3 py-2.5 rounded-lg mb-1 ${active ? 'bg-neutral-100' : ''}`}
                      >
                        <Text className="text-sm font-medium text-neutral-800">{eng.fullName}</Text>
                        {active && <Ionicons name="checkmark-circle" size={16} color="#0F1F33" />}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          )}

          <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Message</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={mode === 'admin' ? 'e.g. Go check the east wall — possible issue' : 'e.g. Need help at the loading dock — equipment malfunction'}
            placeholderTextColor="#9CA3AF"
            multiline
            numberOfLines={3}
            className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            style={{ minHeight: 72, textAlignVertical: 'top' }}
          />

          {mode === 'admin' && selectedEngineer && (
            <Text className="text-2xs text-neutral-400 mb-2">To: {selectedEngineer.fullName}</Text>
          )}

          {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}

          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            className="flex-row items-center justify-center gap-2 px-4 py-3 rounded-xl"
            style={{ backgroundColor: '#DC2626', opacity: canSend ? 1 : 0.4 }}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="alert-circle" size={16} color="#fff" />
            )}
            <Text className="text-sm font-bold text-white">{sending ? 'Sending…' : 'Send'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
