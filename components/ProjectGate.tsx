// Shown INSTEAD of a project-scoped drawer screen when a staff user has no
// project selected (e.g. an admin with no project assignment and several
// projects to choose from). Replaces each screen's old dead-end "no project
// selected" text with a real picker; once a project is tapped, the screen
// renders normally. Wired in app/(authenticated)/_layout.tsx via the
// Drawer's screenLayout, so individual screens didn't need changing.

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { appRoleFor, useAuth } from '../lib/AuthContext';
import { useProject } from '../lib/ProjectContext';
import { Card } from './ui/Card';

// Drawer routes that only make sense for one selected project. (MoM, Files,
// Attendance and Critical Alerts already handle "no project" themselves.)
const PROJECT_SCOPED_ROUTES = new Set([
  'completed-tasks',
  'daily-updates',
  'documents',
  'dpr-edit-requests',
  'engineer-attendance',
  'flowchart',
  'gantt',
  'project-contacts',
  'settings',
  'task-list',
]);

export function ProjectGate({ routeName, children }: { routeName: string; children: ReactNode }) {
  const { state } = useAuth();
  const { projects, selectedProjectId, setSelectedProjectId, loading } = useProject();
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) !== 'client';

  if (!isStaff || !PROJECT_SCOPED_ROUTES.has(routeName) || selectedProjectId) return <>{children}</>;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  // Nothing to pick from — let the screen show its own empty state.
  if (projects.length === 0) return <>{children}</>;

  return (
    <ScrollView className="flex-1 bg-neutral-50" contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Text className="text-lg font-bold text-neutral-900">Select a Project</Text>
      <Text className="text-xs text-neutral-500 mt-0.5 mb-4">Choose which project to open. You can switch any time from Projects in the menu.</Text>
      {projects.map((p) => (
        <Pressable key={p.id} onPress={() => setSelectedProjectId(p.id)}>
          <Card className="mb-2.5 flex-row items-center gap-3">
            <Ionicons name="business" size={20} color="#0F1F33" />
            <Text className="text-sm font-bold text-neutral-900 flex-1">{p.name}</Text>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
