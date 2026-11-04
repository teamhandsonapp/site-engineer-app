// "Send to these people by WhatsApp or email" — the admin picks the
// channel(s); WhatsApp opens one chat per person (wa.me can't message a
// group), email opens the mail app once with everyone in To. Each send is
// reported back through onSent so the screen can keep a log.

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { mailtoUrl, openLink, whatsappUrl } from '../../lib/mom/share';
import type { Recipient, SendChannel } from '../../lib/mom/types';
import { Banner, Button, Chip, NAVY } from './ui';

export function SendPanel({
  recipients,
  subject,
  message,
  onSent,
  sentKeys,
}: {
  recipients: Recipient[];
  subject: string;
  message: string;
  onSent: (channel: SendChannel, keys: string[]) => void;
  // Recipient keys already messaged on WhatsApp for this item (shows a tick).
  sentKeys?: Set<string>;
}) {
  const [channels, setChannels] = useState<Set<SendChannel>>(new Set(['whatsapp']));
  const [error, setError] = useState<string | null>(null);
  const [localSent, setLocalSent] = useState<Set<string>>(new Set());

  const withEmail = recipients.filter((r) => !!r.email);
  const withoutEmail = recipients.filter((r) => !r.email);
  const done = new Set([...(sentKeys ?? []), ...localSent]);

  function toggle(c: SendChannel) {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  async function sendWhatsapp(r: Recipient) {
    const url = whatsappUrl(r.phone, message);
    if (!url) return;
    setError(null);
    try {
      await openLink(url);
      setLocalSent((prev) => new Set(prev).add(r.key));
      onSent('whatsapp', [r.key]);
    } catch {
      setError('Could not open WhatsApp. Is it installed on this phone?');
    }
  }

  async function sendEmail() {
    setError(null);
    try {
      await openLink(mailtoUrl(withEmail.map((r) => r.email as string), subject, message));
      onSent('email', withEmail.map((r) => r.key));
    } catch {
      setError('Could not open a mail app on this device.');
    }
  }

  if (recipients.length === 0) {
    return <Text className="text-xs text-neutral-400">Add people first.</Text>;
  }

  return (
    <View>
      <View className="flex-row gap-2 mb-3">
        <Chip label="WhatsApp" active={channels.has('whatsapp')} color="#16A34A" onPress={() => toggle('whatsapp')} />
        <Chip label="Email" active={channels.has('email')} color="#2563EB" onPress={() => toggle('email')} />
      </View>
      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
      {channels.size === 0 && <Text className="text-xs text-neutral-400">Select WhatsApp, Email or both.</Text>}

      {channels.has('email') && (
        <View className="mb-3">
          <Button
            label={withEmail.length ? `Open email to ${withEmail.length} ${withEmail.length === 1 ? 'person' : 'people'}` : 'No one has an email'}
            icon="mail-outline"
            variant="secondary"
            disabled={withEmail.length === 0}
            onPress={sendEmail}
          />
          {withoutEmail.length > 0 && (
            <Text className="text-2xs text-amber-700 mt-1.5">No email saved for: {withoutEmail.map((r) => r.name).join(', ')}</Text>
          )}
        </View>
      )}

      {channels.has('whatsapp') && (
        <View className="gap-1.5">
          <Text className="text-2xs text-neutral-500 mb-0.5">WhatsApp opens one chat at a time. Tap Send, then come back for the next person.</Text>
          {recipients.map((r) => {
            const can = !!whatsappUrl(r.phone, '');
            const sent = done.has(r.key);
            return (
              <View key={r.key} className="flex-row items-center gap-3 rounded-xl bg-white border border-neutral-100 px-3 py-2">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-neutral-900">{r.name}</Text>
                  <Text className="text-2xs text-neutral-500">{r.phone ?? 'No phone number'}</Text>
                </View>
                {sent && <Ionicons name="checkmark-done" size={16} color="#16A34A" />}
                <Pressable
                  disabled={!can}
                  onPress={() => sendWhatsapp(r)}
                  className="flex-row items-center gap-1 rounded-lg px-2.5 py-1.5"
                  style={{ backgroundColor: can ? '#16A34A' : '#E5E7EB' }}
                >
                  <Ionicons name="logo-whatsapp" size={14} color={can ? '#fff' : '#9CA3AF'} />
                  <Text className="text-2xs font-bold" style={{ color: can ? '#fff' : '#9CA3AF' }}>
                    {sent ? 'Again' : 'Send'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <Pressable className="mt-3" onPress={() => setError(null)}>
        <Text className="text-2xs text-neutral-400">
          Message preview: <Text style={{ color: NAVY }}>{message.split('\n')[0]}…</Text>
        </Text>
      </Pressable>
    </View>
  );
}
