import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { Card } from '../../components/ui/Card';
import { DateField } from '../../components/ui/DateField';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { fetchProjectTaskOptions, type ProjectTaskOption } from '../../lib/reports/taskList';
import {
  assignDocumentToTask,
  deleteDocument,
  fetchDocumentTaskLinks,
  fetchDocuments,
  pickDocumentFile,
  unassignDocumentFromTask,
  uploadDocument,
  type DocumentTaskLink,
  type PickedDocumentFile,
  type ProjectDocument,
} from '../../lib/documents';

// Upload — admin only (revision label + date, per the request), opened
// from the header button which is itself hidden for non-admins.
function UploadDocumentModal({
  visible,
  onUploaded,
  onClose,
}: {
  visible: boolean;
  onUploaded: (file: PickedDocumentFile, title: string, revisionLabel: string, documentDateISO: string) => Promise<void>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<PickedDocumentFile | null>(null);
  const [title, setTitle] = useState('');
  const [revisionLabel, setRevisionLabel] = useState('');
  const [documentDate, setDocumentDate] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setFile(null);
    setTitle('');
    setRevisionLabel('');
    setDocumentDate(null);
    setError(null);
  }, [visible]);

  async function handlePickFile() {
    try {
      const picked = await pickDocumentFile();
      if (picked) {
        setFile(picked);
        if (!title) setTitle(picked.name.replace(/\.[^.]+$/, ''));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const canSave = !!file && title.trim().length > 0 && revisionLabel.trim().length > 0 && !!documentDate && !uploading;

  async function handleSave() {
    if (!file || !documentDate || !canSave) return;
    setUploading(true);
    setError(null);
    try {
      await onUploaded(file, title.trim(), revisionLabel.trim(), documentDate);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4 w-full" style={{ maxWidth: 400, maxHeight: '85%' }}>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-md font-bold text-neutral-900">Upload Document</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#9CA3AF" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Pressable
              onPress={handlePickFile}
              className="flex-row items-center gap-2 border border-dashed border-neutral-300 rounded-lg px-3 py-3 mb-3"
            >
              <Ionicons name="document-attach-outline" size={18} color="#0F1F33" />
              <Text className="text-sm text-neutral-700 flex-1" numberOfLines={1}>
                {file ? file.name : 'Choose a file (PDF, JPG, PNG)'}
              </Text>
            </Pressable>

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Ground Floor Plan"
              placeholderTextColor="#9CA3AF"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Revision</Text>
            <TextInput
              value={revisionLabel}
              onChangeText={setRevisionLabel}
              placeholder="e.g. R1"
              placeholderTextColor="#9CA3AF"
              className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 mb-3"
            />

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Date</Text>
            <View className="mb-3">
              <DateField value={documentDate} onChange={setDocumentDate} />
            </View>
          </ScrollView>

          {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}

          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            className="flex-row items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-navy"
            style={{ opacity: canSave ? 1 : 0.4 }}
          >
            {uploading && <ActivityIndicator color="#fff" size="small" />}
            <Text className="text-sm font-bold text-white">{uploading ? 'Uploading…' : 'Upload'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Assign — any staff role, from a document's own detail sheet. Search-then-
// tap, by explicit request ("Search bar to search task and assign").
function AssignTaskPicker({
  projectId,
  alreadyLinkedTaskIds,
  onAssign,
  onClose,
}: {
  projectId: string;
  alreadyLinkedTaskIds: Set<string>;
  onAssign: (task: ProjectTaskOption) => Promise<void>;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<ProjectTaskOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [assigningId, setAssigningId] = useState<string | null>(null);

  useEffect(() => {
    fetchProjectTaskOptions(projectId)
      .then(setOptions)
      .finally(() => setLoading(false));
  }, [projectId]);

  const q = query.trim().toLowerCase();
  const filtered = options.filter(
    (t) => !alreadyLinkedTaskIds.has(t.id) && (q === '' || t.taskName.toLowerCase().includes(q) || t.taskCode.toLowerCase().includes(q))
  );

  async function handlePick(task: ProjectTaskOption) {
    setAssigningId(task.id);
    try {
      await onAssign(task);
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4 w-full" style={{ maxWidth: 400, maxHeight: '75%' }}>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-md font-bold text-neutral-900">Assign to Task</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#9CA3AF" />
            </Pressable>
          </View>

          <View className="flex-row items-center gap-2 bg-neutral-50 rounded-xl border border-neutral-200 px-3 py-2.5 mb-3">
            <Ionicons name="search-outline" size={16} color="#a3a3a3" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by task name or code"
              placeholderTextColor="#a3a3a3"
              className="flex-1 text-sm text-neutral-900"
            />
          </View>

          {loading ? (
            <ActivityIndicator color="#0F1F33" />
          ) : filtered.length === 0 ? (
            <Text className="text-xs text-neutral-400">No matching tasks.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 320 }}>
              {filtered.map((task) => (
                <Pressable
                  key={task.id}
                  onPress={() => handlePick(task)}
                  disabled={assigningId === task.id}
                  className="flex-row items-center justify-between px-3 py-2.5 rounded-lg mb-1 bg-neutral-50"
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-sm font-semibold text-neutral-800" numberOfLines={1}>{task.taskCode} — {task.taskName}</Text>
                    <Text className="text-2xs text-neutral-400">{task.workName}</Text>
                  </View>
                  {assigningId === task.id ? <ActivityIndicator size="small" color="#0F1F33" /> : <Ionicons name="add-circle-outline" size={20} color="#0F1F33" />}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Tap a document -> this sheet: open the file, see/manage its task
// assignments, and (admin only) delete it.
function DocumentDetailModal({
  document,
  projectId,
  isAdmin,
  onClose,
  onDeleted,
}: {
  document: ProjectDocument;
  projectId: string;
  isAdmin: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { state } = useAuth();
  const userId = state.status === 'signed-in' ? state.profile.id : null;
  const [links, setLinks] = useState<DocumentTaskLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    try {
      setLinks(await fetchDocumentTaskLinks(document.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingLinks(false);
    }
  }, [document.id]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  async function handleOpenFile() {
    if (!document.signedUrl) return;
    try {
      await Linking.openURL(document.signedUrl);
    } catch {
      Alert.alert("Couldn't open file", 'No app on this device can open this file type.');
    }
  }

  async function handleAssign(task: ProjectTaskOption) {
    try {
      await assignDocumentToTask(document.id, task.id, userId);
      await loadLinks();
    } catch (err) {
      Alert.alert('Could not assign', err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUnassign(linkId: string) {
    try {
      await unassignDocumentFromTask(linkId);
      await loadLinks();
    } catch (err) {
      Alert.alert('Could not remove', err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteDocument(document.id, document.storagePath);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  return (
    <>
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
          <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4 w-full" style={{ maxWidth: 400, maxHeight: '80%' }}>
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-md font-bold text-neutral-900 flex-1 pr-2" numberOfLines={2}>{document.title}</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color="#9CA3AF" />
              </Pressable>
            </View>
            <View className="flex-row items-center gap-1.5 mb-3">
              <View className="px-2 py-0.5 rounded-full bg-blue-50">
                <Text className="text-2xs font-bold text-blue-700">{document.revisionLabel}</Text>
              </View>
              <Text className="text-2xs text-neutral-400">{document.documentDateISO}</Text>
            </View>

            {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}

            <Pressable onPress={handleOpenFile} className="flex-row items-center justify-center gap-2 py-2.5 rounded-xl border border-neutral-200 mb-3">
              <Ionicons name="open-outline" size={16} color="#0F1F33" />
              <Text className="text-xs font-bold text-neutral-800">Open File</Text>
            </Pressable>

            <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Assigned Tasks</Text>
            {loadingLinks ? (
              <ActivityIndicator color="#0F1F33" />
            ) : links.length === 0 ? (
              <Text className="text-xs text-neutral-400 mb-3">Not assigned to any task yet.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 160 }} className="mb-3">
                {links.map((link) => (
                  <View key={link.linkId} className="flex-row items-center justify-between px-3 py-2 rounded-lg bg-neutral-50 mb-1">
                    <Text className="text-xs font-semibold text-neutral-800 flex-1 pr-2" numberOfLines={1}>
                      {link.taskCode} — {link.taskName}
                    </Text>
                    <Pressable onPress={() => handleUnassign(link.linkId)} hitSlop={6}>
                      <Ionicons name="close-circle" size={16} color="#9CA3AF" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}

            <Pressable onPress={() => setAssignOpen(true)} className="flex-row items-center justify-center gap-2 py-2.5 rounded-xl bg-brand-navy mb-2">
              <Ionicons name="link-outline" size={16} color="#fff" />
              <Text className="text-xs font-bold text-white">Assign to Task</Text>
            </Pressable>

            {isAdmin && (
              <Pressable onPress={() => setDeleteConfirmOpen(true)} className="flex-row items-center justify-center gap-2 py-2.5 rounded-xl bg-red-50">
                <Ionicons name="trash-outline" size={16} color="#DC2626" />
                <Text className="text-xs font-bold text-red-600">Delete Document</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {assignOpen && (
        <AssignTaskPicker
          projectId={projectId}
          alreadyLinkedTaskIds={new Set(links.map((l) => l.taskId))}
          onAssign={handleAssign}
          onClose={() => setAssignOpen(false)}
        />
      )}

      {deleteConfirmOpen && (
        <ConfirmDialog
          title="Delete this document?"
          description={`"${document.title}" (${document.revisionLabel}) will be permanently removed, including its file.`}
          confirmLabel="Delete"
          variant="danger"
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </>
  );
}

function DocumentRow({ document, onPress }: { document: ProjectDocument; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-2.5 flex-row items-center justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>{document.title}</Text>
          <Text className="text-2xs text-neutral-400 mt-0.5">{document.documentDateISO}</Text>
        </View>
        <View className="px-2 py-0.5 rounded-full bg-blue-50">
          <Text className="text-2xs font-bold text-blue-700">{document.revisionLabel}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function DocumentsScreen() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isStaff = profile ? appRoleFor(profile.role) === 'staff' : false;
  const isAdmin = profile?.role === 'admin';
  const { selectedProjectId } = useProject();

  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<ProjectDocument | null>(null);

  const load = useCallback(async () => {
    if (!selectedProjectId) {
      setDocuments([]);
      return;
    }
    try {
      setError(null);
      setDocuments(await fetchDocuments(selectedProjectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedProjectId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!isStaff) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  async function handleUploaded(file: PickedDocumentFile, title: string, revisionLabel: string, documentDateISO: string) {
    if (!selectedProjectId) return;
    const uploadedBy = state.status === 'signed-in' ? state.profile.id : null;
    await uploadDocument(selectedProjectId, file, title, revisionLabel, documentDateISO, uploadedBy);
    await load();
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <View className="px-4 pt-4 pb-2">
        {isAdmin && (
          <Pressable
            onPress={() => setUploadOpen(true)}
            className="flex-row items-center justify-center gap-2 py-3 rounded-xl bg-brand-navy"
          >
            <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
            <Text className="text-sm font-bold text-white">Upload Document</Text>
          </Pressable>
        )}
      </View>

      {!selectedProjectId ? (
        <EmptyState icon="folder-open-outline" iconColor="#9CA3AF" title="No project selected" subtitle="Pick a project from Home to see its documents." />
      ) : loading ? (
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

          {documents.length === 0 ? (
            <EmptyState
              icon="folder-open-outline"
              iconColor="#9CA3AF"
              title="No documents yet"
              subtitle={isAdmin ? 'Tap "Upload Document" to add the first one.' : 'No drawings or floor plans have been uploaded yet.'}
            />
          ) : (
            documents.map((doc) => <DocumentRow key={doc.id} document={doc} onPress={() => setSelectedDoc(doc)} />)
          )}
        </ScrollView>
      )}

      <UploadDocumentModal visible={uploadOpen} onUploaded={handleUploaded} onClose={() => setUploadOpen(false)} />

      {selectedDoc && selectedProjectId && (
        <DocumentDetailModal
          document={selectedDoc}
          projectId={selectedProjectId}
          isAdmin={isAdmin}
          onClose={() => setSelectedDoc(null)}
          onDeleted={() => {
            setSelectedDoc(null);
            void load();
          }}
        />
      )}
    </View>
  );
}
