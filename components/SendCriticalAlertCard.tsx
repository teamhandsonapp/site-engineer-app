import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './ui/Card';
import { fetchProjectEngineers, sendCriticalAlertMessage, type ProjectEngineer } from '../lib/criticalAlertMessages';
import { ALARM_SOUNDS, DEFAULT_ALARM_ID, previewAlarm } from '../lib/alarmSounds';

const INPUT_CLASS = 'border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900';

// Settings → Send Critical Alert (admin/manager). One critical_alert_messages
// row per chosen engineer — the existing DB trigger pushes each with the
// loud red-zone tone, and CriticalAlertPopup shows it full-screen on the
// engineer's phone until they acknowledge it.
export function SendCriticalAlertCard({
  projectId,
  senderId,
  onResult,
}: {
  projectId: string;
  senderId: string;
  onResult: (type: 'success' | 'error', message: string) => void;
}) {
  const [engineers, setEngineers] = useState<ProjectEngineer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Empty = everyone on this project.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [soundId, setSoundId] = useState(DEFAULT_ALARM_ID);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjectEngineers(projectId)
      .then((list) => { if (!cancelled) { setEngineers(list); setSelected(new Set()); setLoadError(null); } })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [projectId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const recipients = engineers ? (selected.size === 0 ? engineers : engineers.filter((e) => selected.has(e.id))) : [];
  const canSend = !sending && message.trim() !== '' && recipients.length > 0;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    const results = await Promise.allSettled(
      recipients.map((e) => sendCriticalAlertMessage(projectId, e.id, message, senderId, soundId)),
    );
    setSending(false);
    const failed = results.filter((r) => r.status === 'rejected').length;
    const sent = results.length - failed;
    if (sent === 0) {
      const first = results[0];
      onResult('error', first.status === 'rejected' && first.reason instanceof Error ? first.reason.message : 'Could not send the alert.');
      return;
    }
    onResult('success', `Critical alert sent to ${sent} engineer${sent === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}.`);
    setMessage('');
  }

  async function handlePreview(id: string) {
    const alarm = ALARM_SOUNDS.find((a) => a.id === id);
    if (!alarm) return;
    setPreviewing(id);
    try {
      await previewAlarm(alarm);
    } catch (err) {
      onResult('error', err instanceof Error ? err.message : String(err));
    } finally {
      // The notification plays on its own; this just un-highlights the button.
      setTimeout(() => setPreviewing((p) => (p === id ? null : p)), 1500);
    }
  }

  return (
    <Card className="mb-4" accentColor="#DC2626">
      <View className="flex-row items-center gap-2 mb-1">
        <Ionicons name="warning-outline" size={16} color="#DC2626" />
        <Text className="text-sm font-bold text-neutral-900">Send Critical Alert</Text>
      </View>
      <Text className="text-2xs text-neutral-400 mb-3">
        Pops up full-screen on the engineer’s phone with an alarm sound until they acknowledge it.
      </Text>

      <Text className="text-xs text-neutral-400 mb-1.5">Send to</Text>
      {loadError ? (
        <Text className="text-2xs text-red-600 mb-4">Couldn’t load engineers: {loadError}</Text>
      ) : !engineers ? (
        <ActivityIndicator color="#0F1F33" style={{ alignSelf: 'flex-start', marginBottom: 16 }} />
      ) : engineers.length === 0 ? (
        <Text className="text-2xs text-neutral-400 mb-4">No site engineers are assigned to this project.</Text>
      ) : (
        <View className="flex-row flex-wrap gap-2 mb-4">
          <Pressable
            onPress={() => setSelected(new Set())}
            className={`px-3 py-1.5 rounded-full border ${selected.size === 0 ? 'bg-red-600 border-red-600' : 'border-neutral-200'}`}
          >
            <Text className={`text-xs font-semibold ${selected.size === 0 ? 'text-white' : 'text-neutral-700'}`}>
              All engineers ({engineers.length})
            </Text>
          </Pressable>
          {engineers.map((e) => {
            const on = selected.has(e.id);
            return (
              <Pressable
                key={e.id}
                onPress={() => toggle(e.id)}
                className={`px-3 py-1.5 rounded-full border ${on ? 'bg-red-600 border-red-600' : 'border-neutral-200'}`}
              >
                <Text className={`text-xs font-semibold ${on ? 'text-white' : 'text-neutral-700'}`}>{e.fullName}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text className="text-xs text-neutral-400 mb-1.5">Alarm sound</Text>
      <View className="rounded-xl border border-neutral-200 mb-4 overflow-hidden">
        {ALARM_SOUNDS.map((alarm, i) => {
          const on = alarm.id === soundId;
          return (
            <Pressable
              key={alarm.id}
              onPress={() => setSoundId(alarm.id)}
              className={`flex-row items-center px-3 py-2.5 ${i > 0 ? 'border-t border-neutral-100' : ''} ${on ? 'bg-red-50' : ''}`}
            >
              <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? '#DC2626' : '#9CA3AF'} />
              <Text className={`flex-1 ml-2.5 text-sm ${on ? 'font-semibold text-neutral-900' : 'text-neutral-700'}`}>
                {i + 1}. {alarm.label}
              </Text>
              <Pressable
                onPress={() => handlePreview(alarm.id)}
                hitSlop={8}
                className="flex-row items-center gap-1 px-2.5 py-1 rounded-full border border-neutral-200"
              >
                <Ionicons name={previewing === alarm.id ? 'volume-high' : 'play'} size={12} color="#0F1F33" />
                <Text className="text-2xs font-semibold text-brand-navy">Test</Text>
              </Pressable>
            </Pressable>
          );
        })}
      </View>

      <Text className="text-xs text-neutral-400 mb-1.5">Message</Text>
      <TextInput
        value={message}
        onChangeText={setMessage}
        maxLength={300}
        multiline
        numberOfLines={3}
        placeholder="e.g. Stop work at Block B — safety inspection now"
        placeholderTextColor="#9CA3AF"
        className={`${INPUT_CLASS} mb-4`}
        style={{ minHeight: 72, textAlignVertical: 'top' }}
      />

      <Pressable
        onPress={handleSend}
        disabled={!canSend}
        className="px-4 py-2.5 rounded-lg bg-red-600 items-center flex-row justify-center gap-2"
        style={{ opacity: canSend ? 1 : 0.5 }}
      >
        {sending && <ActivityIndicator size="small" color="#fff" />}
        <Text className="text-sm font-semibold text-white">{sending ? 'Sending…' : 'Send Critical Alert'}</Text>
      </Pressable>
    </Card>
  );
}
