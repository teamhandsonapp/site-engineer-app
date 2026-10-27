import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ComposeCriticalAlertModal } from '../../components/ComposeCriticalAlertModal';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';

export default function CriticalAlertsScreen() {
  const { state } = useAuth();
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) === 'staff';
  const isAdminOrManager = state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');
  const { selectedProjectId, projects } = useProject();
  const [composeOpen, setComposeOpen] = useState(false);

  if (!isStaff) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  const currentUserId = state.status === 'signed-in' ? state.profile.id : null;
  const projectName = selectedProjectId ? projects.find((p) => p.id === selectedProjectId)?.name : null;

  return (
    <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
      {selectedProjectId ? (
        <Pressable
          onPress={() => setComposeOpen(true)}
          className="flex-row items-center gap-2 px-5 py-3 rounded-lg"
          style={{ backgroundColor: '#BE123C' }}
        >
          <Ionicons name="add-circle" size={18} color="#fff" />
          <Text className="text-sm font-bold text-white">
            {isAdminOrManager ? 'Send Critical Alert' : 'Report Issue'}
          </Text>
        </Pressable>
      ) : (
        <Text className="text-sm text-neutral-400 text-center">Select a project to send a critical alert.</Text>
      )}

      {selectedProjectId && currentUserId && (
        <ComposeCriticalAlertModal
          visible={composeOpen}
          mode={isAdminOrManager ? 'admin' : 'engineer'}
          projectId={selectedProjectId}
          projectName={projectName ?? null}
          senderId={currentUserId}
          onClose={() => setComposeOpen(false)}
          onSent={() => {}}
        />
      )}
    </View>
  );
}
