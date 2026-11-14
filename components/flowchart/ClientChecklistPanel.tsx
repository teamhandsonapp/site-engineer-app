import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from '../ui/AppText';
import {
  CHECKLIST_NOTE_FIELDS,
  EMPTY_CHECKLIST_NOTES,
  fetchChecklistNotes,
  saveChecklistNotes,
  type ChecklistNotes,
} from '../../lib/flowchart/checklistNotes';

// Task sheet "Checklist" tab (Flowchart 2): the client's six checklist points
// for this task — what they wrote on the checklist sheet ("On hold",
// "Shop dwgs", "Roof erection", ...). Staff can edit and save; others read.
export function ClientChecklistPanel({ taskId, editable, userId }: { taskId: string; editable: boolean; userId: string | null }) {
  const [notes, setNotes] = useState<ChecklistNotes>(EMPTY_CHECKLIST_NOTES);
  const [saved, setSaved] = useState<ChecklistNotes>(EMPTY_CHECKLIST_NOTES);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    fetchChecklistNotes(taskId)
      .then((n) => {
        if (cancelled) return;
        const value = n ? { ...EMPTY_CHECKLIST_NOTES, ...n } : EMPTY_CHECKLIST_NOTES;
        setNotes(value);
        setSaved(value);
        setUpdatedAt(n?.updatedAt ?? null);
      })
      .catch((err) => !cancelled && setMessage({ text: err instanceof Error ? err.message : String(err), isError: true }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const dirty = CHECKLIST_NOTE_FIELDS.some((f) => notes[f.key].trim() !== saved[f.key].trim());

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await saveChecklistNotes(taskId, notes, userId);
      setSaved(notes);
      setUpdatedAt(new Date().toISOString());
      setMessage({ text: 'Checklist saved', isError: false });
    } catch (err) {
      setMessage({ text: `Could not save: ${err instanceof Error ? err.message : String(err)}`, isError: true });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View className="py-8 items-center">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  return (
    <View testID="client-checklist-panel">
      {CHECKLIST_NOTE_FIELDS.map((f) => {
        const value = notes[f.key];
        return (
          <View key={f.key} className="mb-2.5">
            <Text className="text-xs text-neutral-400 mb-1">{f.label}</Text>
            {editable ? (
              <TextInput
                testID={`client-checklist-${f.key}`}
                value={value}
                onChangeText={(t) => setNotes((n) => ({ ...n, [f.key]: t }))}
                placeholder="Not given"
                placeholderTextColor="#A3A3A3"
                multiline
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900"
                style={{ minHeight: 40, textAlignVertical: 'top' }}
              />
            ) : (
              <View className="border border-neutral-100 bg-neutral-50 rounded-lg px-3 py-2">
                <Text className="text-sm" style={{ color: value ? '#171717' : '#A3A3A3' }}>{value || 'Not given'}</Text>
              </View>
            )}
          </View>
        );
      })}

      {updatedAt ? (
        <Text className="text-2xs text-neutral-400 mb-2">
          Last updated {new Date(updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
      ) : null}
      {message ? (
        <Text className="text-xs mb-2" style={{ color: message.isError ? '#DC2626' : '#15803D' }}>{message.text}</Text>
      ) : null}
      {editable ? (
        <Pressable
          testID="client-checklist-save"
          onPress={handleSave}
          disabled={saving || !dirty}
          className="self-end px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5"
          style={{ opacity: saving || !dirty ? 0.5 : 1 }}
        >
          {saving && <ActivityIndicator size="small" color="#fff" />}
          <Text className="text-xs font-semibold text-white">Save Checklist</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
