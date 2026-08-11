import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { Card } from '../ui/Card';

// Same shape as app/project-dashboard.tsx's own StatTile (icon chip + big
// number + label), plus a trend row comparing against the previous
// same-length period — Weekly Report's #3 (overdue tasks) and #4 (pending
// client responses) both use this identically with higherIsWorse: true (a
// rising count is bad in both cases).
interface KpiTileProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  current: number;
  previous: number;
  higherIsWorse: boolean;
}

export function KpiTile({ icon, label, color, current, previous, higherIsWorse }: KpiTileProps) {
  const delta = current - previous;
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
  const isWorse = higherIsWorse ? delta > 0 : delta < 0;
  const trendColor = delta === 0 ? '#9CA3AF' : isWorse ? '#DC2626' : '#16A34A';
  const trendLabel = delta === 0 ? 'No change vs last period' : `${arrow} ${Math.abs(delta)} vs last period`;

  return (
    <Card style={{ width: '47%', paddingVertical: 14 }}>
      <View className="w-9 h-9 rounded-xl items-center justify-center mb-3" style={{ backgroundColor: `${color}22` }}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <Text className="text-2xl font-extrabold text-neutral-900">{current}</Text>
      <Text className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mt-1">{label}</Text>
      <Text className="text-2xs font-semibold mt-1.5" style={{ color: trendColor }}>
        {trendLabel}
      </Text>
    </Card>
  );
}
