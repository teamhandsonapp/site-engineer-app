import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '../../components/ui/Card';
import { APP_PROGRESS, type ProgressFrom, type ScreenProgress } from '../../lib/appProgress';

// App Progress — for each screen of the app: what is done, what is pending,
// and what is needed (and from whom). Content lives in lib/appProgress.ts.

const FROM_COLOR: Record<ProgressFrom, { fg: string; bg: string }> = {
  Client: { fg: '#B45309', bg: '#FEF3C7' },
  'PMC team': { fg: '#1D4ED8', bg: '#DBEAFE' },
  Development: { fg: '#0F766E', bg: '#CCFBF1' },
  'Phone update': { fg: '#7C3AED', bg: '#EDE9FE' },
};

function formatDate(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Section({ title, icon, color, count, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; color: string; count: number; children: React.ReactNode }) {
  return (
    <View className="mt-3">
      <View className="flex-row items-center mb-1">
        <Ionicons name={icon} size={16} color={color} />
        <Text className="text-sm font-bold ml-1.5" style={{ color }}>
          {title}
        </Text>
        <View className="ml-1.5 rounded-full px-1.5" style={{ backgroundColor: `${color}1A` }}>
          <Text className="text-2xs font-bold" style={{ color }}>
            {count}
          </Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function Row({ text, icon, color }: { text: string; icon: keyof typeof Ionicons.glyphMap; color: string }) {
  return (
    <View className="flex-row items-center py-1.5 border-b border-neutral-100">
      <Ionicons name={icon} size={15} color={color} />
      <Text className="flex-1 text-sm text-neutral-800 ml-2" numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function ScreenCard({ p, open, onToggle }: { p: ScreenProgress; open: boolean; onToggle: () => void }) {
  const total = p.done.length + p.pending.length;
  const pct = total ? Math.round((p.done.length / total) * 100) : 0;
  return (
    <Card className="mb-3">
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} className="flex-row items-center" style={{ minHeight: 44 }}>
        <View className="flex-1 pr-2">
          <Text className="text-md font-bold text-neutral-900">{p.screen}</Text>
          <Text className="text-xs text-neutral-500 mt-0.5" numberOfLines={1}>
            {p.done.length} done · {p.pending.length} pending · {formatDate(p.updated)}
          </Text>
          <View className="h-1.5 rounded-full bg-neutral-100 mt-2 overflow-hidden">
            <View className="h-1.5 rounded-full bg-green-600" style={{ width: `${pct}%` }} />
          </View>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#6B7280" />
      </Pressable>

      {open ? (
        <View className="mt-1">
          <Section title="Done" icon="checkmark-circle" color="#15803D" count={p.done.length}>
            {p.done.map((d) => (
              <Row key={d} text={d} icon="checkmark" color="#15803D" />
            ))}
          </Section>

          <Section title="Pending" icon="time" color="#B45309" count={p.pending.length}>
            {p.pending.map((d) => (
              <Row key={d} text={d} icon="ellipse-outline" color="#B45309" />
            ))}
          </Section>

          <Section title="Needed" icon="help-circle" color="#1D4ED8" count={p.needed.length}>
            {p.needed.map((n) => (
              <View key={n.item} className="flex-row items-center py-1.5 border-b border-neutral-100">
                <Text className="flex-1 text-sm text-neutral-800" numberOfLines={1}>
                  {n.item}
                </Text>
                <View className="rounded-md px-1.5 py-0.5 ml-2" style={{ backgroundColor: FROM_COLOR[n.from].bg }}>
                  <Text className="text-2xs font-bold" style={{ color: FROM_COLOR[n.from].fg }}>
                    {n.from}
                  </Text>
                </View>
              </View>
            ))}
          </Section>
        </View>
      ) : null}
    </Card>
  );
}

export default function AppProgressScreen() {
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ [APP_PROGRESS[0]?.screen ?? '']: true }));
  const done = APP_PROGRESS.reduce((n, p) => n + p.done.length, 0);
  const pending = APP_PROGRESS.reduce((n, p) => n + p.pending.length, 0);
  return (
    <ScrollView className="flex-1 bg-neutral-50" contentContainerClassName="px-4 pt-4 pb-10">
      <Text className="text-xs text-neutral-500 mb-3" numberOfLines={1}>
        {APP_PROGRESS.length} screen{APP_PROGRESS.length === 1 ? '' : 's'} · {done} done · {pending} pending
      </Text>
      {APP_PROGRESS.map((p) => (
        <ScreenCard key={p.screen} p={p} open={!!open[p.screen]} onToggle={() => setOpen((o) => ({ ...o, [p.screen]: !o[p.screen] }))} />
      ))}
    </ScrollView>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
