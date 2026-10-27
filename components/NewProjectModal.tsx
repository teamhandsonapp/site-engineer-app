import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createProject, SUGGESTED_DEPARTMENTS, type NewProjectFields } from '../lib/projects';

const EMPTY_FIELDS: NewProjectFields = { name: '', address: null, floorCount: null, roomCount: null, departments: [] };

// Drawer's Projects switcher -> admin-only "+ Add New Project" row opens
// this. Mirrors admin-web's ProjectForm (Name/Address/Floors/Rooms/
// Departments) but as a mobile modal, since project creation previously
// only existed on admin-web.
export function NewProjectModal({
  visible,
  onCreated,
  onClose,
}: {
  visible: boolean;
  onCreated: (projectId: string) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<NewProjectFields>(EMPTY_FIELDS);
  const [deptInput, setDeptInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setFields(EMPTY_FIELDS);
    setDeptInput('');
    setError(null);
  }, [visible]);

  const canSave = fields.name.trim().length > 0 && !saving;

  function addDepartment(raw: string) {
    const name = raw.trim();
    if (!name) return;
    setFields((prev) =>
      prev.departments.some((d) => d.toLowerCase() === name.toLowerCase()) ? prev : { ...prev, departments: [...prev.departments, name] }
    );
    setDeptInput('');
  }

  function removeDepartment(name: string) {
    setFields((prev) => ({ ...prev, departments: prev.departments.filter((d) => d !== name) }));
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const projectId = await createProject({
        name: fields.name.trim(),
        address: fields.address?.trim() || null,
        floorCount: fields.floorCount,
        roomCount: fields.roomCount,
        departments: fields.departments,
      });
      onCreated(projectId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4 w-full" style={{ maxWidth: 400, maxHeight: '85%' }}>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-md font-bold text-neutral-900">Add New Project</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#9CA3AF" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
              Project Name<Text style={{ color: '#DC2626' }}> *</Text>
            </Text>
            <TextInput
              value={fields.name}
              onChangeText={(name) => setFields((prev) => ({ ...prev, name }))}
              placeholder="e.g. Elmwood Villas"
              placeholderTextColor="#9CA3AF"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Location / Address</Text>
            <TextInput
              value={fields.address ?? ''}
              onChangeText={(address) => setFields((prev) => ({ ...prev, address }))}
              placeholder="Optional"
              placeholderTextColor="#9CA3AF"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <View className="flex-row gap-3 mb-3">
              <View className="flex-1">
                <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">No. of Floors</Text>
                <TextInput
                  value={fields.floorCount != null ? String(fields.floorCount) : ''}
                  onChangeText={(v) => setFields((prev) => ({ ...prev, floorCount: v.trim() ? Math.max(0, parseInt(v, 10) || 0) : null }))}
                  placeholder="e.g. 4"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900"
                />
              </View>
              <View className="flex-1">
                <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">No. of Rooms</Text>
                <TextInput
                  value={fields.roomCount != null ? String(fields.roomCount) : ''}
                  onChangeText={(v) => setFields((prev) => ({ ...prev, roomCount: v.trim() ? Math.max(0, parseInt(v, 10) || 0) : null }))}
                  placeholder="e.g. 24"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900"
                />
              </View>
            </View>

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Departments</Text>
            <View className="flex-row flex-wrap gap-1.5 mb-2">
              {SUGGESTED_DEPARTMENTS.map((name) => {
                const added = fields.departments.some((d) => d.toLowerCase() === name.toLowerCase());
                return (
                  <Pressable
                    key={name}
                    onPress={() => (added ? removeDepartment(name) : addDepartment(name))}
                    className="px-2.5 py-1.5 rounded-full"
                    style={{ backgroundColor: added ? '#0F1F33' : '#F5F5F5' }}
                  >
                    <Text className="text-2xs font-semibold" style={{ color: added ? '#fff' : '#525252' }}>
                      {added ? '✓ ' : '+ '}
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View className="flex-row gap-2 mb-2">
              <TextInput
                value={deptInput}
                onChangeText={setDeptInput}
                onSubmitEditing={() => addDepartment(deptInput)}
                placeholder="Type a department and add"
                placeholderTextColor="#9CA3AF"
                className="flex-1 border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900"
              />
              <Pressable onPress={() => addDepartment(deptInput)} className="px-4 items-center justify-center rounded-lg border border-neutral-200">
                <Text className="text-sm font-semibold text-neutral-700">Add</Text>
              </Pressable>
            </View>
            {fields.departments.length > 0 && (
              <View className="flex-row flex-wrap gap-1.5 mb-3">
                {fields.departments.map((name) => (
                  <View key={name} className="flex-row items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-full bg-neutral-100">
                    <Text className="text-2xs font-semibold text-neutral-700">{name}</Text>
                    <Pressable onPress={() => removeDepartment(name)} hitSlop={6}>
                      <Ionicons name="close-circle" size={14} color="#9CA3AF" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}

          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            className="flex-row items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-navy"
            style={{ opacity: canSave ? 1 : 0.4 }}
          >
            {saving && <ActivityIndicator color="#fff" size="small" />}
            <Text className="text-sm font-bold text-white">{saving ? 'Creating…' : 'Create Project'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
