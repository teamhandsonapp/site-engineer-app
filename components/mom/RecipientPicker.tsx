// Pick people from the Contact Book + this project's Specific Book.
// Used for meeting invitees, automated-report recipients and the task-list
// send in Custom Alerts. Search by name/company/phone, filter by category.

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '../ui/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONTACT_CATEGORIES, CONTACT_CATEGORY_LABEL, type ContactCategory } from '../../lib/contacts';
import { fetchRecipients } from '../../lib/mom/share';
import type { Recipient } from '../../lib/mom/types';
import { Button, Chip, NAVY } from './ui';

export function RecipientPicker({
  visible,
  projectId,
  selected,
  onClose,
  onDone,
  title = 'Add people',
  onlyCategories,
}: {
  visible: boolean;
  projectId: string;
  selected: Recipient[];
  onClose: () => void;
  onDone: (people: Recipient[]) => void;
  title?: string;
  onlyCategories?: ContactCategory[];
}) {
  const insets = useSafeAreaInsets();
  const [all, setAll] = useState<Recipient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ContactCategory | null>(null);
  const [picked, setPicked] = useState<Map<string, Recipient>>(new Map());

  useEffect(() => {
    if (!visible) return;
    setPicked(new Map(selected.map((r) => [r.key, r])));
    setSearch('');
    setCategory(null);
    let cancelled = false;
    setAll(null);
    setError(null);
    fetchRecipients(projectId)
      .then((list) => !cancelled && setAll(list))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // selected is read once on open, on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, projectId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (all ?? []).filter((r) => {
      if (onlyCategories && !onlyCategories.includes(r.category)) return false;
      if (category && r.category !== category) return false;
      if (!q) return true;
      return [r.name, r.company ?? '', r.phone ?? '', r.email ?? ''].some((v) => v.toLowerCase().includes(q));
    });
  }, [all, search, category, onlyCategories]);

  const categories = onlyCategories ?? CONTACT_CATEGORIES;

  function toggle(r: Recipient) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(r.key)) next.delete(r.key);
      else next.set(r.key, r);
      return next;
    });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-neutral-50">
        {/* Full-screen modal (edge-to-edge): header below the status bar,
            Done above the navigation bar. */}
        <View className="flex-row items-center gap-3 px-4 pb-3 bg-white border-b border-neutral-100" style={{ paddingTop: insets.top + 12 }}>
          <Pressable hitSlop={10} onPress={onClose}>
            <Ionicons name="close" size={22} color={NAVY} />
          </Pressable>
          <Text className="text-base font-bold text-neutral-900 flex-1">{title}</Text>
          <Text className="text-xs text-neutral-500">{picked.size} selected</Text>
        </View>

        <View className="px-4 pt-3 gap-2.5">
          <View className="flex-row items-center gap-2 border border-neutral-200 rounded-lg px-3 bg-white">
            <Ionicons name="search" size={16} color="#9CA3AF" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search name, company, phone"
              placeholderTextColor="#9CA3AF"
              className="flex-1 py-2.5 text-sm text-neutral-900"
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Chip label="All" active={category == null} onPress={() => setCategory(null)} />
            {categories.map((c) => (
              <Chip key={c} label={CONTACT_CATEGORY_LABEL[c]} active={category === c} onPress={() => setCategory(c)} />
            ))}
          </ScrollView>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 6 }}>
          {error && <Text className="text-sm text-red-600">{error}</Text>}
          {!all && !error && <ActivityIndicator color={NAVY} style={{ marginTop: 24 }} />}
          {all && filtered.length === 0 && (
            <Text className="text-sm text-neutral-500 text-center mt-6">
              {all.length === 0 ? 'No contacts yet. Add people in Contact Book or Specific Book first.' : 'No one matches.'}
            </Text>
          )}
          {filtered.map((r) => {
            const on = picked.has(r.key);
            return (
              <Pressable
                key={r.key}
                onPress={() => toggle(r)}
                className="flex-row items-center gap-3 rounded-xl bg-white px-3 py-2.5 border"
                style={{ borderColor: on ? NAVY : '#F3F4F6' }}
              >
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? NAVY : '#9CA3AF'} />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-neutral-900">{r.name}</Text>
                  <Text className="text-2xs text-neutral-500" numberOfLines={1}>
                    {[CONTACT_CATEGORY_LABEL[r.category], r.company, r.phone, r.email].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text className="text-2xs text-neutral-400">{r.source === 'project' ? 'Specific' : 'Contact'}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View className="px-4 pt-3 bg-white border-t border-neutral-100" style={{ paddingBottom: insets.bottom + 12 }}>
          <Button label={`Done (${picked.size})`} icon="checkmark" onPress={() => onDone(Array.from(picked.values()))} />
        </View>
      </View>
    </Modal>
  );
}
