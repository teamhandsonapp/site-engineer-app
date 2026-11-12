// "Send to these people by WhatsApp or email" — the admin picks the
// channel(s); WhatsApp opens one chat per person (wa.me can't message a
// group), email opens the mail app once with everyone in To. Each send is
// reported back through onSent so the screen can keep a log.
//
// When `apiSend` is given (MoM invites with EXPO_PUBLIC_WA_TEST=true), the
// WhatsApp button sends straight from the Meta Cloud API test number — no
// WhatsApp window opens — and shows Sent / Failed / Skipped per person. The
// old wa.me chats stay available under "Open in my WhatsApp".

import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from '../ui/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { mailtoUrl, openLink, whatsappNumber, whatsappUrl } from '../../lib/mom/share';
import type { Recipient, SendChannel } from '../../lib/mom/types';
import type { WaInviteResult, WaSendSummary } from '../../lib/mom/whatsappTest';
import { Banner, Button, Chip, NAVY } from './ui';

const GREEN = '#16A34A';

type ApiOutcome = WaInviteResult & { atISO: string };

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function SendPanel({
  recipients,
  subject,
  message,
  onSent,
  sentKeys,
  apiSend,
}: {
  recipients: Recipient[];
  subject: string;
  message: string;
  onSent: (channel: SendChannel, keys: string[], via?: 'api' | 'link') => void;
  // Recipient keys already messaged on WhatsApp for this item (shows a tick).
  sentKeys?: Set<string>;
  // Meta Cloud API send (test number). Omit to keep the wa.me-only behaviour.
  apiSend?: (people: Recipient[]) => Promise<WaSendSummary>;
}) {
  const [channels, setChannels] = useState<Set<SendChannel>>(new Set(['whatsapp']));
  const [error, setError] = useState<string | null>(null);
  const [localSent, setLocalSent] = useState<Set<string>>(new Set());
  // API mode
  const [selected, setSelected] = useState<Set<string>>(() => new Set(recipients.filter((r) => whatsappNumber(r.phone)).map((r) => r.key)));
  const [sending, setSending] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, ApiOutcome>>({});
  const [showLinks, setShowLinks] = useState(!apiSend);

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
      onSent('whatsapp', [r.key], 'link');
    } catch {
      setError('Could not open WhatsApp. Is it installed on this phone?');
    }
  }

  async function sendViaApi() {
    if (!apiSend) return;
    const people = recipients.filter((r) => selected.has(r.key));
    if (people.length === 0) return;
    setError(null);
    setSending(true);
    try {
      const summary = await apiSend(people);
      if (summary.error) {
        setError(`WhatsApp API: ${summary.error}. You can still use "Open in my WhatsApp" below.`);
        return;
      }
      const at = new Date().toISOString();
      const next: Record<string, ApiOutcome> = {};
      // The function answers one result per person, in the order sent.
      people.forEach((p, i) => {
        const r = summary.results[i];
        if (r) next[p.key] = { ...r, atISO: at };
      });
      setOutcomes((prev) => ({ ...prev, ...next }));
      const sentKeysNow = people.filter((p) => next[p.key]?.status === 'sent').map((p) => p.key);
      if (sentKeysNow.length) {
        setLocalSent((prev) => new Set([...prev, ...sentKeysNow]));
        onSent('whatsapp', sentKeysNow, 'api');
      }
      if (summary.failed > 0) setShowLinks(true);
    } finally {
      setSending(false);
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

  const selectedCount = recipients.filter((r) => selected.has(r.key)).length;

  return (
    <View>
      <View className="flex-row gap-2 mb-3">
        <Chip label="WhatsApp" active={channels.has('whatsapp')} color={GREEN} onPress={() => toggle('whatsapp')} />
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

      {/* WhatsApp via the Meta Cloud API test number */}
      {channels.has('whatsapp') && apiSend && (
        <View className="gap-1.5 mb-2">
          <Text className="text-2xs text-neutral-500 mb-0.5">Sends automatically from the WhatsApp test number — no WhatsApp window opens.</Text>
          {recipients.map((r) => {
            const can = !!whatsappNumber(r.phone);
            const on = can && selected.has(r.key);
            const o = outcomes[r.key];
            return (
              <Pressable
                key={r.key}
                disabled={!can || sending}
                onPress={() =>
                  setSelected((prev) => {
                    const n = new Set(prev);
                    if (n.has(r.key)) n.delete(r.key);
                    else n.add(r.key);
                    return n;
                  })
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !can }}
                className="flex-row items-center gap-3 rounded-xl bg-white border border-neutral-100 px-3 py-2"
              >
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? GREEN : '#D1D5DB'} />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-neutral-900">{r.name}</Text>
                  <Text className="text-2xs text-neutral-500">{r.phone ?? 'No phone number'}</Text>
                  {o ? (
                    <Text
                      className="text-2xs font-semibold mt-0.5"
                      style={{ color: o.status === 'sent' ? GREEN : o.status === 'failed' ? '#DC2626' : '#B45309' }}
                    >
                      {o.status === 'sent'
                        ? `Sent ${timeLabel(o.atISO)}${o.via === 'text' ? ' (text)' : ''}`
                        : o.status === 'failed'
                          ? `Failed — ${o.error ?? 'unknown error'}`
                          : `Skipped — ${o.error === 'not in test list' ? 'not in test list' : (o.error ?? 'skipped')}`}
                    </Text>
                  ) : null}
                </View>
                {o?.status === 'sent' ? <Ionicons name="checkmark-done" size={16} color={GREEN} /> : null}
              </Pressable>
            );
          })}
          <Button
            label={sending ? 'Sending…' : `Send WhatsApp to ${selectedCount} ${selectedCount === 1 ? 'person' : 'people'}`}
            icon="logo-whatsapp"
            busy={sending}
            disabled={selectedCount === 0 || sending}
            onPress={sendViaApi}
          />
          {sending ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color={GREEN} />
              <Text className="text-2xs text-neutral-500">Sending from the test number…</Text>
            </View>
          ) : null}
          <Pressable onPress={() => setShowLinks((v) => !v)} hitSlop={6} className="flex-row items-center gap-1 mt-1">
            <Ionicons name={showLinks ? 'chevron-up' : 'chevron-down'} size={12} color="#6B7280" />
            <Text className="text-2xs font-semibold text-neutral-500">Open in my WhatsApp (send it yourself)</Text>
          </Pressable>
        </View>
      )}

      {/* Old click-to-chat (wa.me): the only WhatsApp option with the flag off, a fallback with it on. */}
      {channels.has('whatsapp') && showLinks && (
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
                {sent && <Ionicons name="checkmark-done" size={16} color={GREEN} />}
                <Pressable
                  disabled={!can}
                  onPress={() => sendWhatsapp(r)}
                  className="flex-row items-center gap-1 rounded-lg px-2.5 py-1.5"
                  style={apiSend ? { borderWidth: 1, borderColor: can ? GREEN : '#E5E7EB' } : { backgroundColor: can ? GREEN : '#E5E7EB' }}
                >
                  <Ionicons name="logo-whatsapp" size={14} color={apiSend ? (can ? GREEN : '#9CA3AF') : can ? '#fff' : '#9CA3AF'} />
                  <Text className="text-2xs font-bold" style={{ color: apiSend ? (can ? GREEN : '#9CA3AF') : can ? '#fff' : '#9CA3AF' }}>
                    {apiSend ? 'Open' : sent ? 'Again' : 'Send'}
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
