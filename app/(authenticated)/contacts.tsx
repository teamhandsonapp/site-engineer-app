import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABEL,
  createContact,
  deleteContact,
  fetchContacts,
  formatContactCard,
  updateContact,
  whatsappShareUrl,
  type Contact,
  type ContactCategory,
  type ContactFields,
} from '../../lib/contacts';

const EMPTY_FIELDS: ContactFields = {
  name: '',
  phoneNumber: '',
  altPhoneNumber: null,
  teamMemberNumber: null,
  email: null,
  locationLink: null,
  companyName: null,
  category: 'contractor',
  notes: null,
};

// Add/Edit share the same form — editingContact null means "creating new",
// same convention as this app's other add-vs-edit modals.
function ContactFormModal({
  visible,
  editingContact,
  onSaved,
  onClose,
}: {
  visible: boolean;
  editingContact: Contact | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { state } = useAuth();
  const [fields, setFields] = useState<ContactFields>(EMPTY_FIELDS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setFields(
      editingContact
        ? {
            name: editingContact.name,
            phoneNumber: editingContact.phoneNumber,
            altPhoneNumber: editingContact.altPhoneNumber,
            teamMemberNumber: editingContact.teamMemberNumber,
            email: editingContact.email,
            locationLink: editingContact.locationLink,
            companyName: editingContact.companyName,
            category: editingContact.category,
            notes: editingContact.notes,
          }
        : EMPTY_FIELDS
    );
  }, [visible, editingContact]);

  const canSave = fields.name.trim().length > 0 && fields.phoneNumber.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const cleaned: ContactFields = {
        name: fields.name.trim(),
        phoneNumber: fields.phoneNumber.trim(),
        altPhoneNumber: fields.altPhoneNumber?.trim() || null,
        teamMemberNumber: fields.teamMemberNumber?.trim() || null,
        email: fields.email?.trim() || null,
        locationLink: fields.locationLink?.trim() || null,
        companyName: fields.companyName?.trim() || null,
        category: fields.category,
        notes: fields.notes?.trim() || null,
      };
      if (editingContact) {
        await updateContact(editingContact.id, cleaned);
      } else {
        await createContact(cleaned, state.status === 'signed-in' ? state.profile.id : null);
      }
      onSaved();
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
            <Text className="text-md font-bold text-neutral-900">{editingContact ? 'Edit Contact' : 'Add Contact'}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#9CA3AF" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
              Name<Text style={{ color: '#DC2626' }}> *</Text>
            </Text>
            <TextInput
              value={fields.name}
              onChangeText={(name) => setFields((prev) => ({ ...prev, name }))}
              placeholder="e.g. Suresh Reddy"
              placeholderTextColor="#9CA3AF"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
              Phone Number<Text style={{ color: '#DC2626' }}> *</Text>
            </Text>
            <TextInput
              value={fields.phoneNumber}
              onChangeText={(phoneNumber) => setFields((prev) => ({ ...prev, phoneNumber }))}
              placeholder="e.g. +91-98765-00001"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Alternative Number</Text>
            <TextInput
              value={fields.altPhoneNumber ?? ''}
              onChangeText={(altPhoneNumber) => setFields((prev) => ({ ...prev, altPhoneNumber }))}
              placeholder="Optional"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Team Member Number</Text>
            <TextInput
              value={fields.teamMemberNumber ?? ''}
              onChangeText={(teamMemberNumber) => setFields((prev) => ({ ...prev, teamMemberNumber }))}
              placeholder="Optional"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Email</Text>
            <TextInput
              value={fields.email ?? ''}
              onChangeText={(email) => setFields((prev) => ({ ...prev, email }))}
              placeholder="Optional"
              placeholderTextColor="#9CA3AF"
              keyboardType="email-address"
              autoCapitalize="none"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Address / Location Link</Text>
            <TextInput
              value={fields.locationLink ?? ''}
              onChangeText={(locationLink) => setFields((prev) => ({ ...prev, locationLink }))}
              placeholder="Address, or a Google Maps link"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Company Name</Text>
            <TextInput
              value={fields.companyName ?? ''}
              onChangeText={(companyName) => setFields((prev) => ({ ...prev, companyName }))}
              placeholder="Optional"
              placeholderTextColor="#9CA3AF"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
              Role / Category<Text style={{ color: '#DC2626' }}> *</Text>
            </Text>
            <View className="flex-row flex-wrap gap-1.5 mb-3">
              {CONTACT_CATEGORIES.map((cat) => {
                const active = cat === fields.category;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setFields((prev) => ({ ...prev, category: cat }))}
                    className="px-2.5 py-1.5 rounded-full"
                    style={{ backgroundColor: active ? '#0F1F33' : '#F5F5F5' }}
                  >
                    <Text className="text-2xs font-semibold" style={{ color: active ? '#fff' : '#525252' }}>
                      {CONTACT_CATEGORY_LABEL[cat]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Notes</Text>
            <TextInput
              value={fields.notes ?? ''}
              onChangeText={(notes) => setFields((prev) => ({ ...prev, notes }))}
              placeholder="Optional"
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
              style={{ minHeight: 64, textAlignVertical: 'top' }}
            />
          </ScrollView>

          {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}

          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            className="flex-row items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-navy"
            style={{ opacity: canSave ? 1 : 0.4 }}
          >
            {saving && <ActivityIndicator color="#fff" size="small" />}
            <Text className="text-sm font-bold text-white">{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Tap a contact -> this menu. Share via WhatsApp / Copy per point 4; Edit /
// Delete per point 5 — combined into one sheet rather than four separate
// entry points, same "tap row, see a small action menu" shape as
// components/flowchart/TaskActionMenu.tsx.
function ContactActionMenu({
  contact,
  onShareWhatsApp,
  onCopy,
  onEdit,
  onDelete,
  onCancel,
}: {
  contact: Contact;
  onShareWhatsApp: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onCancel}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 340 }}>
          <Card>
            <Text className="text-sm font-bold text-neutral-900 mb-0.5">{contact.name}</Text>
            <Text className="text-2xs text-neutral-400 mb-1">
              {CONTACT_CATEGORY_LABEL[contact.category]}
              {contact.companyName ? ` · ${contact.companyName}` : ''}
            </Text>
            {(contact.altPhoneNumber || contact.teamMemberNumber || contact.email || contact.locationLink) && (
              <View className="mb-2 gap-0.5">
                {contact.altPhoneNumber && <Text className="text-2xs text-neutral-500">Alt: {contact.altPhoneNumber}</Text>}
                {contact.teamMemberNumber && <Text className="text-2xs text-neutral-500">Team: {contact.teamMemberNumber}</Text>}
                {contact.email && <Text className="text-2xs text-neutral-500">{contact.email}</Text>}
                {contact.locationLink && (
                  <Pressable onPress={() => Linking.openURL(contact.locationLink!).catch(() => {})}>
                    <Text className="text-2xs text-blue-600 underline">{contact.locationLink}</Text>
                  </Pressable>
                )}
              </View>
            )}
            <View className="gap-1.5">
              <Pressable onPress={onShareWhatsApp} className="flex-row items-center gap-3 px-3 py-3 rounded-lg bg-neutral-50">
                <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                <Text className="text-sm font-semibold text-neutral-800">Share via WhatsApp</Text>
              </Pressable>
              <Pressable onPress={onCopy} className="flex-row items-center gap-3 px-3 py-3 rounded-lg bg-neutral-50">
                <Ionicons name="copy-outline" size={18} color="#0F1F33" />
                <Text className="text-sm font-semibold text-neutral-800">Copy</Text>
              </Pressable>
              <Pressable onPress={onEdit} className="flex-row items-center gap-3 px-3 py-3 rounded-lg bg-neutral-50">
                <Ionicons name="create-outline" size={18} color="#0F1F33" />
                <Text className="text-sm font-semibold text-neutral-800">Edit</Text>
              </Pressable>
              <Pressable onPress={onDelete} className="flex-row items-center gap-3 px-3 py-3 rounded-lg bg-red-50">
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
                <Text className="text-sm font-semibold text-red-600">Delete</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ContactRow({ contact, onPress }: { contact: Contact; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-2.5 flex-row items-center justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>{contact.name}</Text>
          <Text className="text-xs text-neutral-400 mt-0.5" numberOfLines={1}>
            {CONTACT_CATEGORY_LABEL[contact.category]}
            {contact.companyName ? ` · ${contact.companyName}` : ''}
          </Text>
        </View>
        <Text className="text-xs font-semibold text-neutral-600">{contact.phoneNumber}</Text>
      </Card>
    </Pressable>
  );
}

export default function ContactsScreen() {
  const { state } = useAuth();
  const isAdmin = state.status === 'signed-in' && state.profile.role === 'admin';

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ContactCategory | 'all'>('all');
  const [actionContact, setActionContact] = useState<Contact | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setContacts(await fetchContacts());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  if (!isAdmin) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const q = query.trim().toLowerCase();
  const filtered = contacts.filter((c) => {
    if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.companyName?.toLowerCase().includes(q) ?? false) ||
      CONTACT_CATEGORY_LABEL[c.category].toLowerCase().includes(q)
    );
  });

  async function handleShareWhatsApp(contact: Contact) {
    setActionContact(null);
    try {
      await Linking.openURL(whatsappShareUrl(contact));
    } catch {
      Alert.alert('WhatsApp not available', 'WhatsApp doesn’t appear to be installed on this device.');
    }
  }

  async function handleCopy(contact: Contact) {
    setActionContact(null);
    await Clipboard.setStringAsync(formatContactCard(contact));
    setToast('Copied to clipboard');
  }

  function handleEdit(contact: Contact) {
    setActionContact(null);
    setEditingContact(contact);
    setFormVisible(true);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteContact(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <View className="px-4 pt-4 pb-2">
        {/* Contact Book (global, admin-only) vs. Specific Book (project-
            scoped, for site engineers) — admin reaches the latter from here
            instead of it being its own top-level drawer row, by explicit
            request. Only admin sees this screen at all (isAdmin gate
            below), so this tab pair is effectively admin-only too. */}
        <View className="flex-row rounded-xl bg-neutral-100 p-1 mb-3">
          <View className="flex-1 items-center py-2 rounded-lg bg-white">
            <Text className="text-xs font-bold text-brand-navy">Contact Book</Text>
          </View>
          <Pressable onPress={() => router.push('/project-contacts')} className="flex-1 items-center py-2 rounded-lg">
            <Text className="text-xs font-bold text-neutral-400">Specific Book</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            setEditingContact(null);
            setFormVisible(true);
          }}
          className="flex-row items-center justify-center gap-2 py-3 rounded-xl bg-brand-navy mb-3"
        >
          <Ionicons name="add-circle" size={18} color="#fff" />
          <Text className="text-sm font-bold text-white">Add Contact</Text>
        </Pressable>

        <View className="flex-row items-center gap-2 bg-white rounded-xl border border-neutral-200 px-3 py-2.5 mb-3">
          <Ionicons name="search-outline" size={16} color="#a3a3a3" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name, company, or role"
            placeholderTextColor="#a3a3a3"
            className="flex-1 text-sm text-neutral-900"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={16} color="#a3a3a3" />
            </Pressable>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-1.5">
            {(['all', ...CONTACT_CATEGORIES] as const).map((cat) => {
              const active = cat === categoryFilter;
              const count = cat === 'all' ? contacts.length : contacts.filter((c) => c.category === cat).length;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategoryFilter(cat)}
                  className="px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: active ? '#0F1F33' : '#F5F5F5' }}
                >
                  <Text className="text-2xs font-bold" style={{ color: active ? '#fff' : '#525252' }}>
                    {cat === 'all' ? 'All' : CONTACT_CATEGORY_LABEL[cat]} ({count})
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="px-4 pb-8 flex-grow"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
        >
          {error && (
            <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-4">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          )}

          {filtered.length === 0 ? (
            <EmptyState
              icon="people-outline"
              iconColor="#9CA3AF"
              title={contacts.length === 0 ? 'No contacts yet' : 'No matching contacts'}
              subtitle={contacts.length === 0 ? 'Tap "Add Contact" to create your first one.' : 'Try a different search or filter.'}
            />
          ) : (
            filtered.map((contact) => (
              <ContactRow key={contact.id} contact={contact} onPress={() => setActionContact(contact)} />
            ))
          )}
        </ScrollView>
      )}

      {toast && (
        <View className="absolute bottom-6 self-center px-4 py-2 rounded-full bg-neutral-900">
          <Text className="text-xs font-semibold text-white">{toast}</Text>
        </View>
      )}

      {actionContact && (
        <ContactActionMenu
          contact={actionContact}
          onShareWhatsApp={() => handleShareWhatsApp(actionContact)}
          onCopy={() => handleCopy(actionContact)}
          onEdit={() => handleEdit(actionContact)}
          onDelete={() => {
            setDeleteTarget(actionContact);
            setActionContact(null);
          }}
          onCancel={() => setActionContact(null)}
        />
      )}

      <ContactFormModal
        visible={formVisible}
        editingContact={editingContact}
        onSaved={load}
        onClose={() => setFormVisible(false)}
      />

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this contact?"
          description={`"${deleteTarget.name}" will be permanently removed from the Contact Book.`}
          confirmLabel="Delete"
          variant="danger"
          busy={deleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </View>
  );
}
