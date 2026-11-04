import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './ui/Card';
import { fetchPushAudienceSummary, sendBroadcastPush, type PushAudience } from '../lib/broadcastPush';

const INPUT_CLASS = 'border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900';

const AUDIENCE_LABEL: Record<PushAudience, string> = {
  field: 'Site engineers',
  all: 'All staff',
};

// Admin-only (the caller gates rendering; send-broadcast-push re-checks
// server-side). Mirrors admin-web's Access → Send Notification dialog.
export function SendNotificationCard({ onResult }: { onResult: (type: 'success' | 'error', message: string) => void }) {
  const [audience, setAudience] = useState<PushAudience>('field');
  const [title, setTitle] = useState('PMC Portal');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  // Tagged with its audience so switching groups shows "Checking…" rather
  // than the previous group's count.
  const [summary, setSummary] = useState<{ audience: PushAudience; total: number; withToken: number } | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPushAudienceSummary(audience)
      .then((s) => { if (!cancelled) { setSummary({ audience, ...s }); setSummaryError(null); } })
      .catch((err) => { if (!cancelled) setSummaryError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [audience]);

  const current = summary?.audience === audience ? summary : null;
  const canSend = !sending && title.trim() !== '' && body.trim() !== '' && current?.withToken !== 0;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    try {
      const { sent, failed } = await sendBroadcastPush(audience, title.trim(), body.trim());
      onResult('success', `Sent to ${sent} device${sent === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}.`);
      setBody('');
    } catch (err) {
      onResult('error', err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="mb-4">
      <View className="flex-row items-center gap-2 mb-1">
        <Ionicons name="notifications-outline" size={16} color="#0F1F33" />
        <Text className="text-sm font-bold text-neutral-900">Send Notification</Text>
      </View>
      <Text className="text-2xs text-neutral-400 mb-3">
        Sends an instant push notification to everyone in the selected group who has the app.
      </Text>

      <Text className="text-xs text-neutral-400 mb-1.5">Send to</Text>
      <View className="flex-row gap-2 mb-1.5">
        {(Object.keys(AUDIENCE_LABEL) as PushAudience[]).map((a) => (
          <Pressable
            key={a}
            onPress={() => setAudience(a)}
            className={`flex-1 py-2 rounded-lg border items-center ${audience === a ? 'bg-brand-navy border-brand-navy' : 'border-neutral-200'}`}
          >
            <Text className={`text-xs font-semibold ${audience === a ? 'text-white' : 'text-neutral-700'}`}>{AUDIENCE_LABEL[a]}</Text>
          </Pressable>
        ))}
      </View>
      <Text className="text-2xs text-neutral-400 mb-4">
        {summaryError
          ? `Couldn't check recipients: ${summaryError}`
          : current
            ? `${current.withToken} of ${current.total} have notifications turned on.`
            : 'Checking who can receive notifications…'}
      </Text>

      <Text className="text-xs text-neutral-400 mb-1.5">Title</Text>
      <TextInput value={title} onChangeText={setTitle} maxLength={80} className={`${INPUT_CLASS} mb-4`} />

      <Text className="text-xs text-neutral-400 mb-1.5">Message</Text>
      <TextInput
        value={body}
        onChangeText={setBody}
        maxLength={300}
        multiline
        numberOfLines={3}
        placeholder="e.g. Site meeting at 10 AM tomorrow"
        placeholderTextColor="#9CA3AF"
        className={`${INPUT_CLASS} mb-4`}
        style={{ minHeight: 72, textAlignVertical: 'top' }}
      />

      <Pressable
        onPress={handleSend}
        disabled={!canSend}
        className="px-4 py-2.5 rounded-lg bg-brand-navy items-center flex-row justify-center gap-2"
        style={{ opacity: canSend ? 1 : 0.5 }}
      >
        {sending && <ActivityIndicator size="small" color="#fff" />}
        <Text className="text-sm font-semibold text-white">{sending ? 'Sending…' : 'Send Notification'}</Text>
      </Pressable>
    </Card>
  );
}
