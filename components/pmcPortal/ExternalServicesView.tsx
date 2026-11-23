import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '../ui/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '../ui/Card';
import { EXTERNAL_SERVICES, type ExternalService } from '../../lib/externalServices';

// PMC Portal > External Services. Content lives in lib/externalServices.ts.

const PAID_STYLE: Record<ExternalService['paid'], { fg: string; bg: string }> = {
  Free: { fg: '#15803D', bg: '#DCFCE7' },
  Paid: { fg: '#B91C1C', bg: '#FEE2E2' },
  'Free tier, paid if usage grows': { fg: '#B45309', bg: '#FEF3C7' },
  'Not live yet': { fg: '#6B7280', bg: '#F3F4F6' },
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row py-1.5">
      <Text className="w-24 text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</Text>
      <Text className="flex-1 text-sm text-neutral-800">{value}</Text>
    </View>
  );
}

function ServiceCard({ s, open, onToggle }: { s: ExternalService; open: boolean; onToggle: () => void }) {
  const tone = PAID_STYLE[s.paid];
  return (
    <Card style={{ marginBottom: 12, padding: 0 }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} className="flex-row items-center gap-3 px-4 py-3.5">
        <View className="flex-1">
          <Text className="text-base font-semibold text-neutral-900">{s.name}</Text>
          <Text className="text-xs text-neutral-500 mt-0.5" numberOfLines={open ? undefined : 1}>
            {s.usedFor}
          </Text>
          <Text className="text-xs font-semibold text-neutral-800 mt-1">
            {s.billing} · {s.cost}
          </Text>
        </View>
        <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: tone.bg }}>
          <Text className="text-2xs font-bold" style={{ color: tone.fg }}>
            {s.paid === 'Free tier, paid if usage grows' ? 'Free tier' : s.paid}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
      </Pressable>
      {open && (
        <View className="px-4 pb-3 border-t border-neutral-100 pt-2">
          <Field label="Cost" value={s.cost} />
          <Field label="Billing" value={s.billing} />
          <Field label="Renewal" value={s.renewal} />
          <Field label="Used by" value={s.usedBy.join(', ')} />
          <Field label="Account" value={s.account} />
          <Field label="Keys kept in" value={s.keysIn} />
          <Field label="Status" value={s.status} />
        </View>
      )}
    </Card>
  );
}

export function ExternalServicesView() {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const paidCount = EXTERNAL_SERVICES.filter((s) => s.paid === 'Paid').length;
  const tierCount = EXTERNAL_SERVICES.filter((s) => s.paid === 'Free tier, paid if usage grows').length;
  const fixed = EXTERNAL_SERVICES.filter((s) => s.paid === 'Paid');
  return (
    <ScrollView className="flex-1 bg-neutral-50" contentContainerClassName="px-4 pt-4 pb-10">
      <Text className="text-xs text-neutral-500 mb-3">
        {EXTERNAL_SERVICES.length} services · {paidCount} paid · {tierCount} on free tier
      </Text>
      <Card style={{ marginBottom: 16, padding: 16 }}>
        <Text className="text-sm font-bold text-neutral-900 mb-2">Renewals and fixed costs</Text>
        {fixed.map((s) => (
          <View key={s.name} className="flex-row py-1">
            <Text className="flex-1 text-sm text-neutral-800">{s.name}</Text>
            <Text className="text-sm font-semibold text-neutral-900 text-right" style={{ maxWidth: '55%' }}>
              {s.cost}
            </Text>
          </View>
        ))}
        <Text className="text-2xs text-neutral-500 mt-2">
          Other services are free today and bill monthly only if usage grows. Tap a service for renewal details.
        </Text>
      </Card>
      {EXTERNAL_SERVICES.map((s) => (
        <ServiceCard key={s.name} s={s} open={!!open[s.name]} onToggle={() => setOpen((o) => ({ ...o, [s.name]: !o[s.name] }))} />
      ))}
      <Text className="text-2xs text-neutral-400 mt-1">Passwords and API keys are not shown here. &ldquo;List price&rdquo; is the provider&apos;s starting price, not the confirmed plan.</Text>
    </ScrollView>
  );
}
