import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { appRoleFor, useAuth } from '../../../lib/AuthContext';
import { fetchTemplateForEditing, updateTemplateInfo, type TemplateEditorData } from '../../../lib/flowchart/templateData';
import { TemplateCanvas } from '../../../components/flowchart/TemplateCanvas';

// The Flowchart Template canvas screen — same top-level, no-drawer pattern
// as project-dashboard.tsx/flowchart-templates.tsx (a template isn't
// scoped to any one project, so there's no "inside a project" context to
// carry a sidebar into either). Fetches once on mount; the canvas itself
// owns every subsequent read/write from here on, same division of
// responsibility as flowchart.tsx -> FlowchartCanvas.
export default function TemplateCanvasScreen() {
  const { templateId } = useLocalSearchParams<{ templateId: string }>();
  const { state } = useAuth();
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) === 'staff';

  const [data, setData] = useState<TemplateEditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(async () => {
    if (!templateId) return;
    try {
      setError(null);
      const d = await fetchTemplateForEditing(templateId);
      setData(d);
      setNameDraft(d.meta.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveName() {
    if (!data) return;
    setSavingName(true);
    try {
      await updateTemplateInfo(data.meta.id, nameDraft, data.meta.description);
      setData({ ...data, meta: { ...data.meta, name: nameDraft.trim() || 'Untitled Template' } });
      setEditingName(false);
    } catch {
      // Non-fatal — the canvas itself is still fully usable either way.
    } finally {
      setSavingName(false);
    }
  }

  if (!isStaff) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          headerTitle: () =>
            editingName ? (
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                onBlur={saveName}
                onSubmitEditing={saveName}
                autoFocus
                editable={!savingName}
                className="text-white font-semibold"
                style={{ minWidth: 160, fontSize: 16, paddingVertical: 2 }}
                placeholderTextColor="rgba(255,255,255,0.5)"
              />
            ) : (
              <Pressable onPress={() => setEditingName(true)}>
                <Text className="text-white font-semibold text-base" numberOfLines={1}>{data?.meta.name ?? 'Template'}</Text>
              </Pressable>
            ),
        }}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : error || !data ? (
        <View className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Text className="text-sm text-red-600 mb-2.5">{error ?? 'Template not found'}</Text>
          <Pressable onPress={load} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <TemplateCanvas
          templateId={data.meta.id}
          templateCreatedAt={data.meta.createdAt}
          initialTasks={data.tasks}
          seriesEdges={data.seriesEdges}
          parallelEdges={data.parallelEdges}
        />
      )}
    </View>
  );
}
