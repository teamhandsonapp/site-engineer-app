import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABEL,
  CATEGORY_LETTER,
  isCategoryNotRequired,
  type AccountabilityType,
  type DependencyCategory,
} from '../../lib/taskDetail/constants';
import {
  addGlobalChecklistItem,
  countAffectedItems,
  countTasksForType,
  deleteGlobalChecklistItem,
  editGlobalChecklistItem,
  fetchGlobalTemplateItems,
  type GlobalTemplateItem,
} from '../../lib/taskDetail/globalChecklist';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

const TYPE_TITLE: Record<AccountabilityType, string> = { ACC: 'AC Checklist', ACV: 'AV Checklist' };

// A small shared dialog for both "add item" (existingLabel=null) and "edit
// item" (existingLabel=the current label) — one text field either way.
function LabelDialog({
  title,
  existingLabel,
  onSave,
  onCancel,
}: {
  title: string;
  existingLabel: string | null;
  onSave: (label: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(existingLabel ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!label.trim()) {
      setError('Label is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onCancel}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 360 }}>
          <Card>
            <Text className="text-sm font-bold text-neutral-900 mb-3">{title}</Text>
            {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Item label"
              autoFocus
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-4"
            />
            <View className="flex-row justify-end gap-2">
              <Pressable onPress={onCancel} disabled={saving} className="px-3.5 py-2 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSave} disabled={saving} className="px-3.5 py-2 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
                {saving && <ActivityIndicator size="small" color="#fff" />}
                <Text className="text-xs font-semibold text-white">Save</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function ChecklistTemplateTypeScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const accountabilityType = (type === 'ACC' || type === 'ACV' ? type : null) as AccountabilityType | null;
  const { state } = useAuth();
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) === 'staff';

  const [items, setItems] = useState<GlobalTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskCount, setTaskCount] = useState<number | null>(null);

  const [addingCategory, setAddingCategory] = useState<DependencyCategory | null>(null);
  const [editingItem, setEditingItem] = useState<GlobalTemplateItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ item: GlobalTemplateItem; affectedCount: number } | null>(null);
  const [preparingDelete, setPreparingDelete] = useState<string | null>(null); // item id currently computing its affected count
  const [deleting, setDeleting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountabilityType) return;
    try {
      setError(null);
      const [templateItems, count] = await Promise.all([fetchGlobalTemplateItems(), countTasksForType(accountabilityType)]);
      setItems(templateItems);
      setTaskCount(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accountabilityType]);

  useFocusEffect(
    useCallback(() => {
      load().finally(() => setLoading(false));
    }, [load])
  );

  if (!isStaff) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }
  if (!accountabilityType) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Unknown checklist type</Text>
      </View>
    );
  }

  const itemsByCategory = new Map<DependencyCategory, GlobalTemplateItem[]>();
  for (const cat of CATEGORIES) itemsByCategory.set(cat, []);
  for (const item of items) {
    if (itemsByCategory.has(item.category)) itemsByCategory.get(item.category)!.push(item);
  }

  async function handleAdd(category: DependencyCategory, label: string) {
    const res = await addGlobalChecklistItem(category, label, accountabilityType!);
    setItems((prev) => [...prev, res.item]);
    setAddingCategory(null);
    setBanner(`Added "${res.item.label}" to ${res.affectedTaskCount} existing ${TYPE_TITLE[accountabilityType!].split(' ')[0]} task${res.affectedTaskCount === 1 ? '' : 's'}.`);
  }

  async function handleEdit(item: GlobalTemplateItem, newLabel: string) {
    const res = await editGlobalChecklistItem(item.id, item.category, item.label, newLabel, accountabilityType!);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, label: newLabel.trim() } : i)));
    setEditingItem(null);
    setBanner(`Renamed to "${newLabel.trim()}" across ${res.affectedTaskCount} existing task${res.affectedTaskCount === 1 ? '' : 's'}.`);
  }

  async function openDeleteConfirm(item: GlobalTemplateItem) {
    setPreparingDelete(item.id);
    try {
      const affectedCount = await countAffectedItems(item.category, item.label, accountabilityType!);
      setDeleteTarget({ item, affectedCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check affected tasks');
    } finally {
      setPreparingDelete(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { item } = deleteTarget;
    setDeleting(true);
    try {
      const res = await deleteGlobalChecklistItem(item.id, item.category, item.label, accountabilityType!);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setDeleteTarget(null);
      setBanner(`Removed "${item.label}" from ${res.affectedTaskCount} existing task${res.affectedTaskCount === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this item');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen options={{ headerShown: true, title: TYPE_TITLE[accountabilityType], headerStyle: { backgroundColor: '#0F1F33' }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '600' } }} />

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
      ) : (
        <ScrollView contentContainerClassName="px-4 py-4 pb-10">
          <Text className="text-xs text-neutral-500 mb-1">
            {taskCount ?? 0} task{taskCount === 1 ? '' : 's'} currently classified {accountabilityType === 'ACC' ? 'AC' : 'AV'}.
          </Text>
          <Text className="text-2xs text-neutral-400 mb-3">
            Every edit below applies to the shared template AND every one of those tasks immediately — not a preview.
          </Text>

          {banner && (
            <Pressable onPress={() => setBanner(null)} className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 mb-3">
              <Text className="text-xs font-semibold text-emerald-700">{banner} (tap to dismiss)</Text>
            </Pressable>
          )}

          {CATEGORIES.map((cat) => {
            if (isCategoryNotRequired(accountabilityType, cat)) return null;
            const catItems = itemsByCategory.get(cat) ?? [];
            const colors = CATEGORY_COLORS[cat];
            const shared = cat !== 'consultant' && cat !== 'procurement';

            return (
              <View key={cat}>
                {cat === 'quality_pre_construction' && (
                  <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mt-6 mb-1 px-1">
                    Quality of Work
                  </Text>
                )}
                <Card accentColor={colors.dot} className="mt-3.5 p-0 overflow-hidden">
                <View className="flex-row items-center justify-between px-3.5 py-3">
                  <View className="flex-row items-center gap-2">
                    <View className="w-6 h-6 rounded-full items-center justify-center" style={{ backgroundColor: colors.dot }}>
                      <Text className="text-2xs font-bold text-white">{CATEGORY_LETTER[cat]}</Text>
                    </View>
                    <Text className="text-sm font-bold text-neutral-900">{CATEGORY_LABEL[cat]}</Text>
                    {shared && (
                      <View className="px-1.5 py-0.5 rounded bg-neutral-100">
                        <Text className="text-2xs font-semibold text-neutral-400">shared</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-2xs font-mono font-bold" style={{ color: colors.text }}>{catItems.length}</Text>
                </View>

                <View className="px-3.5">
                  {catItems.map((item, idx) => (
                    <View key={item.id} className={`flex-row items-center justify-between py-2.5 ${idx === catItems.length - 1 ? '' : 'border-b border-neutral-100'}`}>
                      <Text className="text-xs font-medium text-neutral-800 flex-1 pr-2">{item.label}</Text>
                      <View className="flex-row items-center gap-1">
                        <Pressable testID={`edit-item-${item.id}`} onPress={() => setEditingItem(item)} hitSlop={6} className="w-7 h-7 rounded-full items-center justify-center bg-neutral-50">
                          <Ionicons name="pencil-outline" size={13} color="#78716C" />
                        </Pressable>
                        <Pressable testID={`delete-item-${item.id}`} onPress={() => openDeleteConfirm(item)} hitSlop={6} disabled={preparingDelete === item.id} className="w-7 h-7 rounded-full items-center justify-center bg-red-50">
                          {preparingDelete === item.id ? <ActivityIndicator size="small" color="#DC2626" /> : <Ionicons name="trash-outline" size={13} color="#DC2626" />}
                        </Pressable>
                      </View>
                    </View>
                  ))}

                  <Pressable onPress={() => setAddingCategory(cat)} className="flex-row items-center gap-1.5 py-2.5">
                    <Ionicons name="add-circle-outline" size={15} color="#0F1F33" />
                    <Text className="text-xs font-semibold text-brand-navy">Add item…</Text>
                  </Pressable>
                </View>
                </Card>
              </View>
            );
          })}
        </ScrollView>
      )}

      {addingCategory && (
        <LabelDialog
          title={`Add item — ${CATEGORY_LABEL[addingCategory]}`}
          existingLabel={null}
          onSave={(label) => handleAdd(addingCategory, label)}
          onCancel={() => setAddingCategory(null)}
        />
      )}

      {editingItem && (
        <LabelDialog
          title={`Edit item — ${CATEGORY_LABEL[editingItem.category]}`}
          existingLabel={editingItem.label}
          onSave={(label) => handleEdit(editingItem, label)}
          onCancel={() => setEditingItem(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this checklist item?"
          description={
            deleteTarget.affectedCount > 0
              ? `"${deleteTarget.item.label}" will be permanently removed from the template and from ${deleteTarget.affectedCount} existing task${deleteTarget.affectedCount === 1 ? '' : 's'} currently classified ${accountabilityType === 'ACC' ? 'AC' : 'AV'} — including any comments, status history, or drawings already on it. This cannot be undone.`
              : `"${deleteTarget.item.label}" will be removed from the template. No existing task currently has this item, so nothing else is affected.`
          }
          confirmLabel="Delete"
          variant="danger"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </View>
  );
}
