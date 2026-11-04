import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { appRoleFor, useAuth } from '../lib/AuthContext';
import { countTasksForType } from '../lib/taskDetail/globalChecklist';
import { Card } from '../components/ui/Card';

// Entry point for the "Global AC/AV Checklist" feature — pick which type's
// checklist to view/edit. Distinct from per-task checklist editing (the
// task detail screen already does that, for one task in isolation); this
// is for editing the shared definition + retroactively cascading that
// change across every existing task of the chosen type in one action.
function TypeCard({ label, sublabel, color, count, onPress }: { label: string; sublabel: string; color: string; count: number | null; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-3 flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <View className="w-10 h-10 rounded-xl items-center justify-center" style={{ backgroundColor: `${color}22` }}>
            <Ionicons name="list-outline" size={18} color={color} />
          </View>
          <View>
            <Text className="text-sm font-bold text-neutral-900">{label}</Text>
            <Text className="text-xs text-neutral-400 mt-0.5">
              {count == null ? sublabel : `${count} task${count === 1 ? '' : 's'} classified this way`}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </Card>
    </Pressable>
  );
}

export default function ChecklistTemplatesScreen() {
  const { state } = useAuth();
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) === 'staff';

  const [accCount, setAccCount] = useState<number | null>(null);
  const [acvCount, setAcvCount] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      countTasksForType('ACC').then(setAccCount).catch(() => {});
      countTasksForType('ACV').then(setAcvCount).catch(() => {});
    }, [])
  );

  if (!isStaff) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen options={{ headerShown: true, title: 'Checklist Templates', headerStyle: { backgroundColor: '#0F1F33' }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '600' } }} />
      <View className="px-4 pt-4">
        <Text className="text-xs text-neutral-500 mb-4">
          Edit the checklist for every AC or AV task at once. A change here updates the shared template (what new tasks get) and every existing task already classified that way — not just one task.
        </Text>
        <TypeCard label="AC Checklist" sublabel="Architect + Consultant + Contractor" color="#111111" count={accCount} onPress={() => router.push('/checklist-templates/ACC')} />
        <TypeCard label="AV Checklist" sublabel="Architect + Vendor/Contractor — Procurement" color="#525252" count={acvCount} onPress={() => router.push('/checklist-templates/ACV')} />
      </View>
    </View>
  );
}
