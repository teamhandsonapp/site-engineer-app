import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { appRoleFor, useAuth } from '../lib/AuthContext';
import { fetchFlowchartTemplates, type TemplateSummary } from '../lib/flowchart/templates';
import { createTemplateShell, deleteFlowchartTemplate } from '../lib/flowchart/templateData';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { TaskActionMenu } from '../components/flowchart/TaskActionMenu';

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// A tap opens an Open/Edit/Delete menu (same TaskActionMenu the canvas
// itself uses for a task) instead of going straight to Apply — real
// feedback was that a single tap silently doing only one specific thing
// (Apply) wasn't discoverable, and there was previously no way to delete a
// whole template at all.
function TemplateRow({ template, onPress }: { template: TemplateSummary; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-2.5">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-md font-semibold text-neutral-900" numberOfLines={1}>{template.name}</Text>
            {template.description && (
              <Text className="text-xs text-neutral-500 mt-0.5" numberOfLines={2}>{template.description}</Text>
            )}
            <Text className="text-2xs text-neutral-400 mt-1.5">
              {template.taskCount} task{template.taskCount === 1 ? '' : 's'} · saved {formatShortDate(template.createdAt)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </View>
      </Card>
    </Pressable>
  );
}

// Reached from Project Dashboard's "Flowchart Template Kit" quick-link —
// browsing/applying is a project-agnostic list (a template isn't owned by
// any one project), so this screen itself doesn't filter by
// selectedProjectId; the target project is chosen as its own step once
// you've picked a template to apply (see flowchart-templates/apply/[id]).
export default function FlowchartTemplatesScreen() {
  const { state } = useAuth();
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) === 'staff';

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionMenuTemplateId, setActionMenuTemplateId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setTemplates(await fetchFlowchartTemplates());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // useFocusEffect (not a plain mount-only useEffect) — this screen doesn't
  // unmount when you navigate into a template's canvas and back (confirmed
  // live: renaming a template there left the stale old name showing here
  // until now), so a refetch has to be tied to re-focusing, not just the
  // first mount.
  useFocusEffect(
    useCallback(() => {
      load().finally(() => setLoading(false));
    }, [load])
  );

  const profile = state.status === 'signed-in' ? state.profile : null;

  async function handleCreateTemplate() {
    setCreating(true);
    try {
      const shell = await createTemplateShell(profile?.id ?? null);
      router.push(`/flowchart-templates/canvas/${shell.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a new template');
    } finally {
      setCreating(false);
    }
  }

  async function confirmDeleteTemplate() {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleting(true);
    try {
      await deleteFlowchartTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this template');
      setDeleteConfirmId(null);
    } finally {
      setDeleting(false);
    }
  }

  const actionMenuTemplate = templates.find((t) => t.id === actionMenuTemplateId) ?? null;

  if (!isStaff) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen options={{ headerShown: true, title: 'Flowchart Templates', headerStyle: { backgroundColor: '#0F1F33' }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '600' } }} />

      <View className="px-4 pt-4">
        <Pressable
          onPress={handleCreateTemplate}
          disabled={creating}
          className="flex-row items-center justify-center gap-1.5 bg-brand-navy rounded-xl py-3 mb-1"
          style={{ opacity: creating ? 0.6 : 1 }}
        >
          {creating ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add" size={16} color="#ffffff" />}
          <Text className="text-sm font-bold text-white">Create Template</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : error ? (
        <View className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
          <Pressable onPress={load} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      ) : templates.length === 0 ? (
        <EmptyState
          icon="albums-outline"
          iconColor="#9CA3AF"
          title="No templates yet"
          subtitle="Tap Create Template above to build one on its own canvas, or save a task sequence as a template from admin-web's Flowchart canvas."
        />
      ) : (
        <ScrollView contentContainerClassName="px-4 pt-3 pb-10">
          {templates.map((t) => (
            <TemplateRow key={t.id} template={t} onPress={() => setActionMenuTemplateId(t.id)} />
          ))}
        </ScrollView>
      )}

      {actionMenuTemplate && (
        <TaskActionMenu
          taskCode={actionMenuTemplate.name}
          // Fixed: "Open" previously went to the Apply flow, not this
          // template's own canvas — the wrong destination for what "Open"
          // reads as (view/edit this template's real saved tasks). Apply
          // moved into the repurposed middle slot instead, so it's not
          // orphaned by that fix.
          onOpen={() => { setActionMenuTemplateId(null); router.push(`/flowchart-templates/canvas/${actionMenuTemplate.id}`); }}
          onEdit={() => { setActionMenuTemplateId(null); router.push(`/flowchart-templates/apply/${actionMenuTemplate.id}`); }}
          editLabel="Apply to Project"
          editIcon="rocket-outline"
          onDelete={() => { setActionMenuTemplateId(null); setDeleteConfirmId(actionMenuTemplate.id); }}
          onCancel={() => setActionMenuTemplateId(null)}
        />
      )}

      {deleteConfirmId && (
        <ConfirmDialog
          title="Delete Template"
          description="This permanently removes the template and every task/link saved in it. Projects it was already applied to are not affected."
          confirmLabel="Delete Template"
          variant="danger"
          busy={deleting}
          onConfirm={confirmDeleteTemplate}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </View>
  );
}
