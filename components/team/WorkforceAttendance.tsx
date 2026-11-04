import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { DateField } from '../ui/DateField';

// Site Attendance — workers' (labour) attendance, planned vs actual
// workforce per department for a chosen day. DEMO DATA for the client
// presentation, by explicit request: numbers are generated deterministically
// from the date + department (same day always shows the same figures),
// nothing is read from or written to the database.

interface Trade {
  name: string;
  planned: number;
}

const DEPARTMENTS: { name: string; color: string; trades: Trade[] }[] = [
  { name: 'Civil Works', color: '#2563EB', trades: [{ name: 'Mason', planned: 12 }, { name: 'Helper', planned: 18 }, { name: 'Bar bender', planned: 6 }, { name: 'Shuttering carpenter', planned: 8 }] },
  { name: 'Electrical', color: '#D97706', trades: [{ name: 'Electrician', planned: 6 }, { name: 'Helper', planned: 4 }] },
  { name: 'Plumbing', color: '#0D9488', trades: [{ name: 'Plumber', planned: 4 }, { name: 'Helper', planned: 3 }] },
  { name: 'Carpentry', color: '#7C3AED', trades: [{ name: 'Carpenter', planned: 5 }, { name: 'Helper', planned: 2 }] },
  { name: 'Painting', color: '#DB2777', trades: [{ name: 'Painter', planned: 6 }, { name: 'Helper', planned: 2 }] },
];

// Small deterministic hash -> 0..1, so a date/department pair always
// produces the same demo numbers.
function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function actualFor(date: string, dept: string, trade: Trade): number {
  const day = new Date(`${date}T00:00:00`).getDay();
  if (day === 0) return 0; // Sunday — site closed
  const r = rand(`${date}|${dept}|${trade.name}`);
  // Mostly 70–105% turnout, occasionally a bad day.
  const pct = r < 0.12 ? 0.45 + r * 2 : 0.7 + r * 0.35;
  return Math.min(trade.planned + 1, Math.round(trade.planned * pct));
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Bar({ actual, planned, color }: { actual: number; planned: number; color: string }) {
  const pct = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : 0;
  return (
    <View className="h-2 rounded-full bg-neutral-100 overflow-hidden mt-1.5">
      <View className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </View>
  );
}

function turnoutColor(pct: number): { bg: string; text: string } {
  if (pct >= 90) return { bg: '#DCFCE7', text: '#166534' };
  if (pct >= 70) return { bg: '#FEF9C3', text: '#854D0E' };
  return { bg: '#FEE2E2', text: '#991B1B' };
}

export function WorkforceAttendance() {
  const [date, setDate] = useState(todayIso());
  const [dept, setDept] = useState<string | null>(null);

  const rows = DEPARTMENTS.filter((d) => !dept || d.name === dept).map((d) => {
    const trades = d.trades.map((t) => ({ ...t, actual: actualFor(date, d.name, t) }));
    return {
      ...d,
      trades,
      planned: trades.reduce((s, t) => s + t.planned, 0),
      actual: trades.reduce((s, t) => s + t.actual, 0),
    };
  });
  const planned = rows.reduce((s, r) => s + r.planned, 0);
  const actual = rows.reduce((s, r) => s + r.actual, 0);
  const pct = planned > 0 ? Math.round((actual / planned) * 100) : 0;
  const shortfall = Math.max(0, planned - actual);
  const tc = turnoutColor(pct);
  const isSunday = new Date(`${date}T00:00:00`).getDay() === 0;

  return (
    <View className="mb-5">
      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">Workforce Attendance</Text>

      <Card className="mb-3">
        <Text className="text-xs font-bold text-neutral-600 mb-1">Date</Text>
        <DateField value={date} maxDate={todayIso()} onChange={setDate} />
        <Text className="text-xs font-bold text-neutral-600 mt-3 mb-1.5">Department</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[null, ...DEPARTMENTS.map((d) => d.name)].map((name) => {
            const active = dept === name;
            return (
              <Pressable
                key={name ?? '__all__'}
                onPress={() => setDept(name)}
                className={`px-3 py-1.5 rounded-full border ${active ? 'bg-brand-navy border-brand-navy' : 'bg-white border-neutral-200'}`}
              >
                <Text className={`text-xs font-semibold ${active ? 'text-white' : 'text-neutral-700'}`}>{name ?? 'All'}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Card>

      {isSunday ? (
        <Card className="mb-3 items-center py-6">
          <Ionicons name="moon-outline" size={24} color="#9CA3AF" />
          <Text className="text-sm font-semibold text-neutral-600 mt-2">Site closed on Sunday</Text>
        </Card>
      ) : (
        <>
          {/* Totals */}
          <View className="flex-row gap-2 mb-3">
            <Card className="flex-1 items-center py-3">
              <Text className="text-xl font-bold text-brand-navy">{planned}</Text>
              <Text className="text-2xs text-neutral-500">Planned</Text>
            </Card>
            <Card className="flex-1 items-center py-3">
              <Text className="text-xl font-bold" style={{ color: '#16A34A' }}>{actual}</Text>
              <Text className="text-2xs text-neutral-500">Actual</Text>
            </Card>
            <Card className="flex-1 items-center py-3">
              <Text className="text-xl font-bold" style={{ color: shortfall > 0 ? '#DC2626' : '#16A34A' }}>{shortfall}</Text>
              <Text className="text-2xs text-neutral-500">Short</Text>
            </Card>
            <Card className="flex-1 items-center py-3" style={{ backgroundColor: tc.bg }}>
              <Text className="text-xl font-bold" style={{ color: tc.text }}>{pct}%</Text>
              <Text className="text-2xs" style={{ color: tc.text }}>Turnout</Text>
            </Card>
          </View>

          {/* Per department (with trade breakdown) */}
          {rows.map((r) => {
            const rp = r.planned > 0 ? Math.round((r.actual / r.planned) * 100) : 0;
            const rc = turnoutColor(rp);
            return (
              <Card key={r.name} className="mb-2.5">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                    <Text className="text-sm font-bold text-neutral-900">{r.name}</Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-xs text-neutral-600">
                      <Text className="font-bold text-neutral-900">{r.actual}</Text> / {r.planned} workers
                    </Text>
                    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: rc.bg }}>
                      <Text className="text-2xs font-bold" style={{ color: rc.text }}>{rp}%</Text>
                    </View>
                  </View>
                </View>
                <Bar actual={r.actual} planned={r.planned} color={r.color} />
                <View className="mt-2.5 rounded-lg border border-neutral-100 overflow-hidden">
                  <View className="flex-row px-2.5 py-1.5" style={{ backgroundColor: '#F8FAFC' }}>
                    <Text className="text-2xs font-bold text-neutral-600 flex-1">Trade</Text>
                    <Text className="text-2xs font-bold text-neutral-600 text-right" style={{ width: 60 }}>Planned</Text>
                    <Text className="text-2xs font-bold text-neutral-600 text-right" style={{ width: 60 }}>Actual</Text>
                  </View>
                  {r.trades.map((t) => (
                    <View key={t.name} className="flex-row px-2.5 py-1.5 border-t border-neutral-50">
                      <Text className="text-xs text-neutral-800 flex-1">{t.name}</Text>
                      <Text className="text-xs text-neutral-600 text-right" style={{ width: 60 }}>{t.planned}</Text>
                      <Text className="text-xs font-bold text-right" style={{ width: 60, color: t.actual < t.planned ? '#DC2626' : '#16A34A' }}>
                        {t.actual}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            );
          })}
        </>
      )}
    </View>
  );
}
