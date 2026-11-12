import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from '../ui/AppText';
import type { WaSendSummary } from '../../lib/mom/whatsappTest';

// DEV TEST ONLY — "WhatsApp: sent 3, failed 1, skipped 1"; tap for per-person details.
const STATUS = {
  sent: { color: '#15803D', icon: 'checkmark-circle' as const },
  failed: { color: '#DC2626', icon: 'close-circle' as const },
  skipped: { color: '#B45309', icon: 'remove-circle' as const },
};

export function WhatsAppTestSummary({ summary, onClose }: { summary: WaSendSummary | 'sending'; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  if (summary === 'sending') {
    return (
      <View className="rounded-xl px-3.5 py-2.5 mb-3 flex-row items-center gap-2" style={{ backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0' }}>
        <ActivityIndicator size="small" color="#166534" />
        <Text className="text-xs font-semibold flex-1" style={{ color: '#166534' }}>WhatsApp test: sending invites…</Text>
      </View>
    );
  }
  const bad = !!summary.error || summary.failed > 0;
  const fg = bad ? '#B91C1C' : '#166534';
  return (
    <View className="rounded-xl mb-3" style={{ backgroundColor: bad ? '#FEF2F2' : '#F0FDF4', borderWidth: 1, borderColor: bad ? '#FECACA' : '#BBF7D0' }}>
      <Pressable onPress={() => setOpen((v) => !v)} className="px-3.5 py-2.5 flex-row items-center gap-2" accessibilityRole="button" accessibilityLabel="WhatsApp test details">
        <Ionicons name="logo-whatsapp" size={16} color={fg} />
        <Text className="text-xs font-bold flex-1" style={{ color: fg }}>
          {summary.error
            ? `WhatsApp test failed: ${summary.error}`
            : `WhatsApp: sent ${summary.sent}, failed ${summary.failed}, skipped ${summary.skipped}`}
        </Text>
        {!summary.error && summary.results.length > 0 ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={fg} /> : null}
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color={fg} />
        </Pressable>
      </Pressable>
      {open && !summary.error ? (
        <View className="px-3.5 pb-3">
          {summary.template ? <Text className="text-2xs text-neutral-500 mb-1.5">Template: {summary.template}</Text> : null}
          {summary.results.map((r, i) => (
            <View key={`${r.phone ?? r.name}-${i}`} className="flex-row items-start gap-2 py-1">
              <Ionicons name={STATUS[r.status].icon} size={14} color={STATUS[r.status].color} style={{ marginTop: 1 }} />
              <View className="flex-1">
                <Text className="text-xs font-semibold text-neutral-900">
                  {r.name}
                  {r.phone ? <Text className="text-2xs text-neutral-500">{`  +${r.phone}`}</Text> : null}
                </Text>
                <Text className="text-2xs" style={{ color: STATUS[r.status].color }}>
                  {r.status === 'sent' ? `Sent${r.via === 'text' ? ' (text fallback)' : ''}` : r.error ?? r.status}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
