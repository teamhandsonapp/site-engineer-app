import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { DateField } from '../ui/DateField';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { SectionHeader } from '../ui/List';
import { colors, radius, shadow, space } from '../../lib/theme';
import { haptic } from '../../lib/haptics';

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
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden', marginTop: space.sm }}>
      <View style={{ height: '100%', width: `${pct}%`, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

function turnoutColor(pct: number): { bg: string; text: string } {
  if (pct >= 90) return { bg: colors.successSoft, text: colors.success };
  if (pct >= 70) return { bg: colors.warningSoft, text: colors.warning };
  return { bg: colors.dangerSoft, text: colors.danger };
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StatTile({ value, label, color, bg }: { value: string | number; label: string; color: string; bg?: string }) {
  return (
    <View
      accessibilityLabel={`${label}: ${value}`}
      style={[
        { flex: 1, alignItems: 'center', paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: bg ? 'transparent' : colors.border, backgroundColor: bg ?? colors.surface },
        shadow.card,
      ]}
    >
      <AppText variant="stat" style={{ color, fontSize: 22, lineHeight: 28, fontVariant: ['tabular-nums'] }}>
        {value}
      </AppText>
      <AppText variant="caption" style={{ color: bg ? color : colors.textMuted }}>
        {label}
      </AppText>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 36,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? colors.navy : colors.border,
        backgroundColor: active ? colors.navy : pressed ? colors.surfaceMuted : colors.surface,
      })}
    >
      <AppText variant="label" style={{ color: active ? '#FFFFFF' : colors.textSecondary }}>
        {label}
      </AppText>
    </Pressable>
  );
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
  const today = todayIso();
  const isToday = date === today;
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <View>
      <SectionHeader title="Workforce attendance" />

      {/* Date bar: step a day back / forward, or tap the date to pick one. */}
      <View
        style={[
          { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, marginBottom: space.md, gap: space.md },
          shadow.card,
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton icon="chevron-back" accessibilityLabel="Previous day" onPress={() => setDate((d) => shiftDay(d, -1))} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <AppText variant="bodyStrong">{dateLabel}</AppText>
            <AppText variant="caption">{isToday ? 'Today' : 'Tap below to pick another day'}</AppText>
          </View>
          <IconButton icon="chevron-forward" accessibilityLabel="Next day" disabled={isToday} onPress={() => setDate((d) => (d < today ? shiftDay(d, 1) : d))} />
        </View>
        <DateField value={date} maxDate={today} onChange={setDate} />

        <View style={{ gap: space.sm }}>
          <AppText variant="label">Department</AppText>
          {/* Wraps onto two lines instead of scrolling off-screen. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {[null, ...DEPARTMENTS.map((d) => d.name)].map((name) => (
              <Chip key={name ?? '__all__'} label={name ?? 'All'} active={dept === name} onPress={() => setDept(name)} />
            ))}
          </View>
        </View>
      </View>

      {isSunday ? (
        <EmptyState icon="moon-outline" iconColor={colors.textMuted} title="Site closed on Sunday" subtitle="Pick another day to see attendance." />
      ) : (
        <>
          {/* Totals */}
          <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.lg }}>
            <StatTile value={planned} label="Planned" color={colors.navy} />
            <StatTile value={actual} label="Actual" color={colors.success} />
            <StatTile value={shortfall} label="Short" color={shortfall > 0 ? colors.danger : colors.success} />
            <StatTile value={`${pct}%`} label="Turnout" color={tc.text} bg={tc.bg} />
          </View>

          {/* Per department (with trade breakdown) */}
          <SectionHeader title={dept ? dept : 'By department'} />
          {rows.map((r) => {
            const rp = r.planned > 0 ? Math.round((r.actual / r.planned) * 100) : 0;
            const rc = turnoutColor(rp);
            return (
              <View
                key={r.name}
                style={[
                  { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.lg, marginBottom: space.md },
                  shadow.card,
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.color }} />
                  <AppText variant="section" style={{ flex: 1 }} numberOfLines={1}>
                    {r.name}
                  </AppText>
                  <AppText variant="label" tone="secondary">
                    <AppText variant="label" tone="default" style={{ fontFamily: 'IBMPlexSans_700Bold' }}>
                      {r.actual}
                    </AppText>{' '}
                    / {r.planned}
                  </AppText>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: rc.bg }}>
                    <AppText variant="caption" style={{ color: rc.text, fontFamily: 'IBMPlexSans_700Bold' }}>
                      {rp}%
                    </AppText>
                  </View>
                </View>
                <Bar actual={r.actual} planned={r.planned} color={r.color} />

                <View style={{ marginTop: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.divider, overflow: 'hidden' }}>
                  <View style={{ flexDirection: 'row', paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colors.surfaceMuted }}>
                    <AppText variant="caption" style={{ flex: 1, fontFamily: 'IBMPlexSans_600SemiBold', color: colors.textSecondary }}>
                      Trade
                    </AppText>
                    <AppText variant="caption" style={{ width: 64, textAlign: 'right', fontFamily: 'IBMPlexSans_600SemiBold', color: colors.textSecondary }}>
                      Planned
                    </AppText>
                    <AppText variant="caption" style={{ width: 64, textAlign: 'right', fontFamily: 'IBMPlexSans_600SemiBold', color: colors.textSecondary }}>
                      Actual
                    </AppText>
                  </View>
                  {r.trades.map((t) => (
                    <View key={t.name} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: space.md, borderTopWidth: 1, borderTopColor: colors.divider }}>
                      <AppText variant="body" style={{ flex: 1 }} numberOfLines={1}>
                        {t.name}
                      </AppText>
                      <AppText variant="body" tone="secondary" style={{ width: 64, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                        {t.planned}
                      </AppText>
                      <AppText
                        variant="bodyStrong"
                        style={{ width: 64, textAlign: 'right', fontVariant: ['tabular-nums'], color: t.actual < t.planned ? colors.danger : colors.success }}
                      >
                        {t.actual}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}
