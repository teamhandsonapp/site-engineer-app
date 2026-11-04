import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { createItemComment, fetchItemComments, type ItemComment } from '../../lib/taskDetail/data';

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function CommentThreadModal({
  itemId,
  itemLabel,
  authorId,
  onClose,
  onPosted,
}: {
  itemId: string;
  itemLabel: string;
  authorId: string | null;
  onClose: () => void;
  // Keeps the parent row's own commentCount in sync — that count is what
  // decides whether the inline quick-add box shows at all (see
  // ChecklistItemRow's showQuickAdd), so it must reflect a post made from
  // in here too, not just from the quick-add box itself.
  onPosted?: () => void;
}) {
  const [comments, setComments] = useState<ItemComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetchItemComments(itemId)
      .then(setComments)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [itemId]);

  async function handlePost() {
    if (!body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await createItemComment(itemId, body, authorId);
      setBody('');
      setComments(await fetchItemComments(itemId));
      onPosted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post comment');
    } finally {
      setPosting(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-white rounded-2xl p-4" style={{ width: '100%', maxWidth: 400, maxHeight: '75%' }}>
          <Text className="text-sm font-bold text-neutral-900">Comments</Text>
          <Text className="text-xs text-neutral-400 mb-3">{itemLabel}</Text>

          {loading ? (
            <ActivityIndicator color="#0F1F33" />
          ) : (
            // FlatList, not a ScrollView + .map() — fetchItemComments() has
            // no query limit (a long-lived task item's thread is never
            // silently truncated), so only the comments actually visible in
            // this 280px window should render.
            <FlatList
              data={comments}
              keyExtractor={(c) => c.id}
              style={{ maxHeight: 280 }}
              className="mb-2"
              ListEmptyComponent={<Text className="text-xs text-neutral-400 py-3">No comments yet.</Text>}
              renderItem={({ item: c }) => (
                <View className="flex-row gap-2 mb-3">
                  <View className="w-7 h-7 rounded-full bg-brand-navy items-center justify-center">
                    <Text className="text-2xs font-bold text-white">{(c.authorName ?? '?').charAt(0).toUpperCase()}</Text>
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-1.5">
                      <Text className="text-xs font-semibold text-neutral-800">{c.authorName ?? 'Unknown'}</Text>
                      <Text className="text-2xs text-neutral-400">{formatRelative(c.createdAtISO)}</Text>
                    </View>
                    <Text className="text-xs text-neutral-600 mt-0.5">{c.body}</Text>
                  </View>
                </View>
              )}
            />
          )}

          {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}

          <View className="flex-row items-end gap-2 border-t border-neutral-100 pt-2.5">
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Add a comment…"
              multiline
              className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900"
              style={{ maxHeight: 80 }}
            />
            <Pressable onPress={handlePost} disabled={posting || !body.trim()} className="px-3 py-2.5 rounded-lg bg-brand-navy">
              {posting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-xs font-semibold text-white">Post</Text>}
            </Pressable>
          </View>
          <Pressable onPress={onClose} className="self-end mt-2 px-3 py-1.5 rounded-lg bg-neutral-100">
            <Text className="text-xs font-semibold text-neutral-600">Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
