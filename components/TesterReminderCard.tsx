import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, TextInput } from './ui/AppText';
import { Card } from './ui/Card';
import { fetchDailySummaryOn, setDailySummaryOn } from '../lib/testerActivity';
import {
  DAILY_LIMIT,
  DEFAULT_TESTER_MESSAGE,
  fetchTesterAudience,
  sendTesterReminder,
  TESTER_EMAIL_DOMAIN,
  type TesterAudience,
} from '../lib/testerReminders';

const INPUT_CLASS = 'border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900';

// Settings → Notifications → "Remind testers" (2026-11-21, client), admin only.
// A push to every closed-testing tester's phone, e.g. "use the app for 2
// minutes today". "Send to me first" checks it on your own phone.
export function TesterReminderCard({ onResult }: { onResult: (type: 'success' | 'error', message: string) => void }) {
  const [body, setBody] = useState(DEFAULT_TESTER_MESSAGE);
  const [audience, setAudience] = useState<TesterAudience | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'all' | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Who gets it: only testers who haven't opened the app today (default), or all.
  const [onlyMissing, setOnlyMissing] = useState(true);
  // 7 PM daily summary to admins (app_flags.tester_daily_summary).
  const [summaryOn, setSummaryOn] = useState<boolean | null>(null);

  const load = useCallback(() => {
    fetchTesterAudience()
      .then((a) => {
        setAudience(a);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    fetchDailySummaryOn().then(setSummaryOn).catch(() => setSummaryOn(null));
  }, []);

  async function toggleSummary() {
    if (summaryOn === null) return;
    try {
      await setDailySummaryOn(!summaryOn);
      setSummaryOn(!summaryOn);
      onResult('success', !summaryOn ? 'Daily 7 PM summary turned on.' : 'Daily 7 PM summary turned off.');
    } catch (e) {
      onResult('error', e instanceof Error ? e.message : String(e));
    }
  }

  const recipients = audience ? (onlyMissing ? audience.notUsedTodayWithToken : audience.withToken) : 0;

  const left = audience ? Math.max(0, DAILY_LIMIT - audience.sentToday) : DAILY_LIMIT;
  const canSend = busy === null && body.trim() !== '';

  async function send(testToMe: boolean) {
    if (!canSend) return;
    setBusy(testToMe ? 'test' : 'all');
    try {
      const r = await sendTesterReminder(body.trim(), testToMe, onlyMissing);
      onResult(
        'success',
        testToMe ? 'Sent to your phone — check that it arrived.' : `Reminder sent to ${r.sent} tester phone${r.sent === 1 ? '' : 's'}. ${r.remainingToday} left today.`
      );
      setConfirming(false);
      load();
    } catch (e) {
      onResult('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-4">
      <View className="flex-row items-center gap-2 mb-1">
        <Ionicons name="people-outline" size={16} color="#0F1F33" />
        <Text className="text-sm font-bold text-neutral-900">Remind testers</Text>
      </View>
      <Text className="text-2xs text-neutral-400 mb-3">
        A notification to every closed-testing tester ({TESTER_EMAIL_DOMAIN} accounts). Tapping it opens the app.
      </Text>

      <Text className="text-2xs mb-3" style={{ color: loadError ? '#DC2626' : '#6B7280' }}>
        {loadError
          ? `Couldn't check testers: ${loadError}`
          : audience
            ? `${audience.testers} tester${audience.testers === 1 ? '' : 's'} · ${audience.notUsedToday} haven't opened the app today · ${left} of ${DAILY_LIMIT} sends left today`
            : 'Checking testers…'}
      </Text>

      <Text className="text-xs text-neutral-400 mb-1.5">Send to</Text>
      <View className="flex-row gap-2 mb-4">
        {[true, false].map((m) => (
          <Pressable
            key={String(m)}
            onPress={() => {
              setOnlyMissing(m);
              setConfirming(false);
            }}
            className={`flex-1 py-2 rounded-lg border items-center ${onlyMissing === m ? 'bg-brand-navy border-brand-navy' : 'border-neutral-200'}`}
          >
            <Text className={`text-xs font-semibold ${onlyMissing === m ? 'text-white' : 'text-neutral-700'}`}>
              {m ? `Not used today${audience ? ` (${audience.notUsedTodayWithToken})` : ''}` : `All testers${audience ? ` (${audience.withToken})` : ''}`}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text className="text-xs text-neutral-400 mb-1.5">Message</Text>
      <TextInput
        value={body}
        onChangeText={(t) => {
          setBody(t);
          setConfirming(false);
        }}
        maxLength={300}
        multiline
        className={`${INPUT_CLASS} mb-4`}
        style={{ minHeight: 64, textAlignVertical: 'top' }}
      />

      <View className="flex-row gap-2">
        <Pressable
          onPress={() => void send(true)}
          disabled={!canSend}
          className="flex-1 px-3 py-2.5 rounded-lg border border-neutral-300 items-center flex-row justify-center gap-2"
          style={{ opacity: canSend ? 1 : 0.5 }}
        >
          {busy === 'test' && <ActivityIndicator size="small" color="#0F1F33" />}
          <Text className="text-xs font-semibold text-neutral-800">Send to me first</Text>
        </Pressable>
        <Pressable
          onPress={() => (confirming ? void send(false) : setConfirming(true))}
          disabled={!canSend || left === 0 || !recipients}
          className="flex-1 px-3 py-2.5 rounded-lg items-center flex-row justify-center gap-2"
          style={{ backgroundColor: confirming ? '#B45309' : '#0F1F33', opacity: canSend && left > 0 && recipients ? 1 : 0.5 }}
        >
          {busy === 'all' && <ActivityIndicator size="small" color="#fff" />}
          <Text className="text-xs font-semibold text-white">
            {confirming ? `Tap again: send to ${recipients}` : onlyMissing ? 'Send reminder' : 'Send to all testers'}
          </Text>
        </Pressable>
      </View>

      {/* 7 PM IST summary to admins: "Today: 9 of 12 testers used the app. Not yet: …" */}
      <Pressable onPress={() => void toggleSummary()} disabled={summaryOn === null} className="flex-row items-center gap-2 mt-4 pt-3 border-t border-neutral-100">
        <Ionicons name={summaryOn ? 'toggle' : 'toggle-outline'} size={30} color={summaryOn ? '#16A34A' : '#9CA3AF'} />
        <View className="flex-1">
          <Text className="text-xs font-semibold text-neutral-800">Daily summary at 7:00 PM</Text>
          <Text className="text-2xs text-neutral-400">A push to admins: how many testers used the app today, and who has not.</Text>
        </View>
        <Text className="text-xs font-bold" style={{ color: summaryOn ? '#16A34A' : '#9CA3AF' }}>{summaryOn === null ? '…' : summaryOn ? 'On' : 'Off'}</Text>
      </Pressable>
    </Card>
  );
}
