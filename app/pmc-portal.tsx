import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '../components/ui/AppText';
import { Redirect, router, Stack } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { appRoleFor, useAuth } from '../lib/AuthContext';
import { Card } from '../components/ui/Card';
import { AppProgressView } from '../components/pmcPortal/AppProgressView';
import { ExternalServicesView } from '../components/pmcPortal/ExternalServicesView';

// PMC Portal: a project for tracking the PMC Portal app itself, separate from
// the real site projects. Opens on a menu of its sections; tapping one opens
// it. Add a section by adding a row here and its view below.
const SECTIONS = [
  { key: 'external-services', label: 'External Services', subtitle: 'Services we use, accounts and cost', icon: 'cloud-outline' as const, color: '#2563EB' },
  { key: 'app-progress', label: 'App Progress', subtitle: 'What is done and pending in each screen', icon: 'stats-chart-outline' as const, color: '#F0A227' },
];

type SectionKey = (typeof SECTIONS)[number]['key'];

export default function PmcPortalScreen() {
  const { state } = useAuth();
  const [section, setSection] = useState<SectionKey | null>(null);

  if (state.status !== 'signed-in') return <Redirect href="/login" />;
  if (appRoleFor(state.profile.role) === 'client') return <Redirect href="/home" />;

  const current = SECTIONS.find((s) => s.key === section);

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title: current ? current.label : 'PMC Portal',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          // Back goes to the section menu first, then to Home.
          headerLeft: () => (
            <Pressable onPress={() => (section ? setSection(null) : router.replace('/home'))} hitSlop={8} style={{ padding: 11 }}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>
          ),
        }}
      />

      {section === 'external-services' ? (
        <ExternalServicesView />
      ) : section === 'app-progress' ? (
        <AppProgressView />
      ) : (
        <ScrollView contentContainerClassName="px-4 pt-4 pb-10">
          {SECTIONS.map((s) => (
            <Pressable key={s.key} accessibilityRole="button" accessibilityLabel={s.label} onPress={() => setSection(s.key)}>
              {({ pressed }) => (
                <Card style={{ marginBottom: 12, opacity: pressed ? 0.7 : 1 }}>
                  <View className="flex-row items-center gap-3">
                    <View className="w-11 h-11 rounded-xl items-center justify-center" style={{ backgroundColor: `${s.color}1A` }}>
                      <Ionicons name={s.icon} size={22} color={s.color} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-neutral-900">{s.label}</Text>
                      <Text className="text-xs text-neutral-500 mt-0.5">{s.subtitle}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                  </View>
                </Card>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from '../components/RouteErrorBoundary';
