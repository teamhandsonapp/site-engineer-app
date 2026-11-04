// MoM — three tabs, by explicit request (replacing the earlier dummy
// Meeting + MoM screens):
//   1. Meeting       — create offline meetings, invite from Contact Book,
//                      send invites/agenda, record, mark attendance.
//   2. Reports       — automated (scheduled) reports + manual Task Based /
//                      Project Health reports to clients, with history.
//   3. Custom Alerts — live alert to a department's engineers; pending /
//                      upcoming task lists to client & architect.
// Project-specific (uses the selected project). Admin / manager only.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { useSafeBottomOffset } from '../../lib/useSafeBottomOffset';
import { useMomData } from '../../lib/mom/store';
import { MeetingTab } from '../../components/mom/MeetingTab';
import { ReportsTab } from '../../components/mom/ReportsTab';
import { CustomAlertsTab } from '../../components/mom/CustomAlertsTab';
import { NAVY } from '../../components/mom/ui';

export type MomTab = 'meeting' | 'reports' | 'alerts';

const TABS: { key: MomTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'meeting', label: 'Meeting', icon: 'people-circle-outline' },
  { key: 'reports', label: 'Reports', icon: 'stats-chart-outline' },
  { key: 'alerts', label: 'Custom Alerts', icon: 'megaphone-outline' },
];

export default function MomScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const { state } = useAuth();
  const { projects, selectedProjectId, setSelectedProjectId } = useProject();
  const bottomPadding = useSafeBottomOffset(24);
  const [tab, setTab] = useState<MomTab>('meeting');
  const { data, update } = useMomData(selectedProjectId);

  // The drawer's sub-items (Meeting / Reports / Custom Alerts) open this
  // screen with ?tab=…
  useEffect(() => {
    if (params.tab === 'meeting' || params.tab === 'reports' || params.tab === 'alerts') setTab(params.tab);
  }, [params.tab]);

  const profile = state.status === 'signed-in' ? state.profile : null;
  if (!profile) return null;

  if (profile.role !== 'admin' && profile.role !== 'manager') {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50 px-8">
        <Ionicons name="lock-closed-outline" size={32} color="#9CA3AF" />
        <Text className="text-sm text-neutral-500 text-center mt-2">MoM is available to admin and manager accounts.</Text>
      </View>
    );
  }

  if (!selectedProjectId) {
    return (
      <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}>
        <Text className="text-lg font-bold text-neutral-900">Select a Project</Text>
        <Text className="text-xs text-neutral-500 mt-0.5 mb-4">Meetings, reports and alerts are kept per project.</Text>
        {projects.map((p) => (
          <Pressable key={p.id} onPress={() => setSelectedProjectId(p.id)}>
            <Card className="mb-2.5 flex-row items-center gap-3">
              <Ionicons name="business" size={20} color={NAVY} />
              <Text className="text-sm font-bold text-neutral-900 flex-1">{p.name}</Text>
              <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  const projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? 'Project';
  const me = { id: profile.id, name: profile.fullName || profile.email };

  return (
    <View className="flex-1 bg-neutral-50">
      <View className="bg-white border-b border-neutral-100 px-4 pt-3">
        <Text className="text-2xs font-bold uppercase tracking-wider text-neutral-400">{projectName}</Text>
        <View className="flex-row mt-2">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable key={t.key} onPress={() => { setTab(t.key); router.setParams({ tab: t.key }); }} className="flex-1 items-center pb-2.5" style={{ borderBottomWidth: 2, borderBottomColor: active ? '#F0A227' : 'transparent' }}>
                <Ionicons name={t.icon} size={18} color={active ? NAVY : '#9CA3AF'} />
                <Text className="text-xs font-bold mt-0.5" style={{ color: active ? NAVY : '#9CA3AF' }}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }} keyboardShouldPersistTaps="handled">
        {!data ? (
          <ActivityIndicator color={NAVY} style={{ marginTop: 32 }} />
        ) : tab === 'meeting' ? (
          <MeetingTab projectId={selectedProjectId} projectName={projectName} data={data} update={update} me={me} />
        ) : tab === 'reports' ? (
          <ReportsTab projectId={selectedProjectId} projectName={projectName} data={data} update={update} />
        ) : (
          <CustomAlertsTab projectId={selectedProjectId} projectName={projectName} update={update} me={me} />
        )}
      </ScrollView>
    </View>
  );
}
