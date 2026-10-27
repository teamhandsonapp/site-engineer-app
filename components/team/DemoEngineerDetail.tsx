import { ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { PulsingDot } from '../ui/PulsingDot';
import { DEMO_ENGINEERS, type DemoActivityEvent } from '../../lib/demoAttendance';

// Activity page for the demo-only engineers (lib/demoAttendance.ts) — same
// look as the real per-engineer attendance detail, fed from dummy data.

function scoreColor(score: number): { bg: string; text: string } {
  if (score >= 85) return { bg: '#DCFCE7', text: '#166534' };
  if (score >= 65) return { bg: '#FEF9C3', text: '#854D0E' };
  return { bg: '#FEE2E2', text: '#991B1B' };
}

const EVENT_STYLE: Record<DemoActivityEvent['kind'], { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  in: { icon: 'log-in-outline', color: '#16A34A' },
  out: { icon: 'log-out-outline', color: '#DC2626' },
  dpr: { icon: 'document-text-outline', color: '#0F1F33' },
  photo: { icon: 'camera-outline', color: '#2563EB' },
  leave: { icon: 'walk-outline', color: '#D97706' },
  back: { icon: 'return-down-back-outline', color: '#16A34A' },
  alert: { icon: 'warning-outline', color: '#DC2626' },
};

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <View className="flex-1 items-center py-2">
      <Text className="text-lg font-bold" style={{ color: color ?? '#0F1F33' }}>
        {value}
      </Text>
      <Text className="text-2xs text-neutral-500">{label}</Text>
    </View>
  );
}

export function DemoEngineerDetail({ userId }: { userId: string }) {
  const e = DEMO_ENGINEERS.find((x) => x.id === userId);
  if (!e) return null;
  const c = scoreColor(e.score);
  const checkInLabel = e.today[0]?.time ?? '—';
  const lastEvent = e.today[e.today.length - 1];

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen options={{ title: e.name }} />
      <ScrollView contentContainerClassName="px-4 pt-4 pb-10">
        {/* Header */}
        <Card className="mb-3">
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-brand-amber">
              <Text className="text-base font-bold text-brand-navy">{e.name.replace(/^K\s+/, '').charAt(0)}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-neutral-900">{e.name}</Text>
              <Text className="text-xs text-neutral-500">
                {e.role} · ROAST @ Kokapet
              </Text>
              <Text className="text-2xs text-neutral-400 mt-0.5">
                {e.phone} · {e.device}
              </Text>
            </View>
            <View className="items-center px-3 py-1.5 rounded-xl" style={{ backgroundColor: c.bg }}>
              <Text className="text-lg font-bold" style={{ color: c.text }}>{e.score}</Text>
              <Text className="text-2xs font-semibold" style={{ color: c.text }}>score</Text>
            </View>
          </View>
          <View className="flex-row items-center gap-1.5 mt-3 px-2.5 py-1.5 rounded-lg self-start" style={{ backgroundColor: e.clockedIn ? '#F0FDF4' : '#F5F5F5' }}>
            {e.clockedIn ? <PulsingDot color="#16A34A" size={6} /> : <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#A3A3A3' }} />}
            <Text className="text-xs font-semibold" style={{ color: e.clockedIn ? '#15803D' : '#525252' }}>
              {e.clockedIn ? `On site since ${checkInLabel}` : `Checked out at ${lastEvent?.time ?? '—'}`}
            </Text>
          </View>
        </Card>

        {/* 30-day stats */}
        <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">Last 30 days</Text>
        <Card className="mb-3 flex-row">
          <Stat label="Present" value={e.presentDays} color="#16A34A" />
          <Stat label="Absent" value={e.absentDays} color="#DC2626" />
          <Stat label="Late" value={e.lateDays} color="#D97706" />
          <Stat label="Left early" value={e.earlyDepartureDays} color="#D97706" />
        </Card>

        {/* Today's activity */}
        <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">Today&apos;s activity</Text>
        <Card className="mb-3">
          {e.today.map((ev, i) => {
            const st = EVENT_STYLE[ev.kind];
            const last = i === e.today.length - 1;
            return (
              <View key={i} className="flex-row gap-3">
                <View className="items-center" style={{ width: 28 }}>
                  <View className="h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: `${st.color}14` }}>
                    <Ionicons name={st.icon} size={15} color={st.color} />
                  </View>
                  {!last && <View style={{ width: 2, flex: 1, backgroundColor: '#E5E7EB', marginVertical: 2 }} />}
                </View>
                <View className="flex-1" style={{ paddingBottom: last ? 0 : 14 }}>
                  <Text className="text-2xs font-bold text-neutral-400">{ev.time}</Text>
                  <Text className="text-sm font-semibold text-neutral-900">{ev.title}</Text>
                  {ev.detail && <Text className="text-2xs text-neutral-500 mt-0.5">{ev.detail}</Text>}
                </View>
              </View>
            );
          })}
        </Card>

        {/* Previous days */}
        <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">Previous days</Text>
        {e.days.map((d) => {
          const absent = !d.checkIn;
          const dc = scoreColor(d.score);
          return (
            <Card key={d.date} className="mb-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-bold text-neutral-900">{d.date}</Text>
                {absent ? (
                  <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FEE2E2' }}>
                    <Text className="text-2xs font-bold" style={{ color: '#991B1B' }}>Absent</Text>
                  </View>
                ) : (
                  <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: dc.bg }}>
                    <Text className="text-2xs font-bold" style={{ color: dc.text }}>{d.score}</Text>
                  </View>
                )}
              </View>
              {!absent && (
                <View className="flex-row items-center justify-between mt-1">
                  <Text className="text-xs text-neutral-600">
                    {d.checkIn} – {d.checkOut} · {d.hours}
                  </Text>
                  <View className="flex-row gap-1">
                    {d.late && (
                      <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF3C7' }}>
                        <Text className="text-2xs font-semibold" style={{ color: '#92400E' }}>Late</Text>
                      </View>
                    )}
                    {d.leftEarly && (
                      <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF3C7' }}>
                        <Text className="text-2xs font-semibold" style={{ color: '#92400E' }}>Left early</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}
