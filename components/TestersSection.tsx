import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from './ui/AppText';
import { Card } from './ui/Card';
import { TESTER_DAYS, TESTERS_NEEDED, type TesterDays } from '../lib/testerActivity';

export interface TesterPhone {
  model: string;
  build: string | null;
  lastUsed: string; // "Active now" / "2 hr ago"
  online: boolean;
}

// Devices & Logins → "Testers" (2026-11-21, client), admin only: who used the
// phone app today, and each tester's last 14 days as dots (Google Play closed
// testing needs 12+ testers for 14 days).
export function TestersSection({ testers, phoneOf }: { testers: TesterDays[]; phoneOf: (userId: string) => TesterPhone | null }) {
  const [onlyMissing, setOnlyMissing] = useState(false);
  const usedToday = testers.filter((t) => t.usedToday).length;
  const shown = onlyMissing ? testers.filter((t) => !t.usedToday) : testers;

  return (
    <Card className="mb-4">
      <View className="flex-row items-center gap-2 mb-2">
        <Ionicons name="people" size={16} color="#0F1F33" />
        <Text className="text-sm font-bold text-neutral-900 flex-1">Testers</Text>
      </View>

      <View className="flex-row gap-3 mb-3">
        <View className="flex-1 rounded-xl px-3 py-2" style={{ backgroundColor: '#F0FDF4' }}>
          <Text className="text-2xl font-bold" style={{ color: '#15803D' }}>
            {usedToday} / {testers.length}
          </Text>
          <Text className="text-2xs text-neutral-600">Used the app today</Text>
        </View>
        <View className="flex-1 rounded-xl px-3 py-2" style={{ backgroundColor: testers.length >= TESTERS_NEEDED ? '#F0FDF4' : '#FEF3C7' }}>
          <Text className="text-2xl font-bold" style={{ color: testers.length >= TESTERS_NEEDED ? '#15803D' : '#B45309' }}>
            {testers.length} / {TESTERS_NEEDED}
          </Text>
          <Text className="text-2xs text-neutral-600">Testers (Google Play needs {TESTERS_NEEDED}+)</Text>
        </View>
      </View>

      <View className="flex-row gap-2 mb-1">
        {[false, true].map((m) => (
          <Pressable
            key={String(m)}
            onPress={() => setOnlyMissing(m)}
            className={`px-3 py-1.5 rounded-full border ${onlyMissing === m ? 'bg-brand-navy border-brand-navy' : 'bg-white border-neutral-200'}`}
          >
            <Text className={`text-xs font-semibold ${onlyMissing === m ? 'text-white' : 'text-neutral-700'}`}>
              {m ? `Not used today (${testers.length - usedToday})` : `All testers (${testers.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {testers.length === 0 ? (
        <Text className="text-xs text-neutral-500 mt-2">No testers yet — tester accounts use an @testerpmc.com email.</Text>
      ) : shown.length === 0 ? (
        <Text className="text-xs mt-2" style={{ color: '#15803D' }}>Everyone used the app today 🎉</Text>
      ) : (
        shown.map((t) => {
          const phone = phoneOf(t.userId);
          return (
            <View key={t.userId} className="pt-3 mt-3 border-t border-neutral-100">
              <View className="flex-row items-center gap-2">
                <Text className="text-sm font-semibold text-neutral-900 flex-1" numberOfLines={1}>
                  {t.name}
                </Text>
                <Text className="text-xs font-bold" style={{ color: t.daysUsed >= TESTER_DAYS ? '#15803D' : '#374151' }}>
                  {t.daysUsed} / {TESTER_DAYS} days
                </Text>
              </View>
              <Text className="text-2xs text-neutral-500 mt-0.5" numberOfLines={1}>
                {phone
                  ? `${phone.model}${phone.build ? ` · build ${phone.build}` : ''} · ${phone.online ? 'Active now' : `last used ${phone.lastUsed}`}`
                  : 'Not signed in on a phone yet'}
              </Text>
              {/* Last 14 days, oldest → today: green = used the app that day. */}
              <View className="flex-row items-center gap-1 mt-2">
                {t.days.map((used, i) => (
                  <View
                    key={i}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 7,
                      backgroundColor: used ? '#16A34A' : '#E5E7EB',
                      borderWidth: i === t.days.length - 1 ? 2 : 0,
                      borderColor: '#0F1F33',
                    }}
                  />
                ))}
                <Text className="text-2xs text-neutral-400 ml-1">today</Text>
              </View>
            </View>
          );
        })
      )}
    </Card>
  );
}
