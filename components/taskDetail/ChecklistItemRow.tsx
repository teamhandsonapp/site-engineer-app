import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusPicker } from './StatusPicker';
import { QuantityControl } from './QuantityControl';
import { CommentThreadModal } from './CommentThreadModal';
import { DrawingRevisionDrawer } from './DrawingRevisionDrawer';
import { StatusHistoryDrawer } from './StatusHistoryDrawer';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  createItemComment,
  deleteChecklistItem,
  updateItemQuantity,
  updateItemStatus,
  type ChecklistItem,
} from '../../lib/taskDetail/data';
import { STATUS_CHIP, hasDrawingRevisions, type CompletionStatus, type QuantityUnit } from '../../lib/taskDetail/constants';

export function ChecklistItemRow({
  item,
  editable,
  userId,
  onChanged,
  onDeleted,
  isLast,
}: {
  item: ChecklistItem;
  editable: boolean;
  userId: string | null;
  onChanged: (itemId: string, patch: Partial<ChecklistItem>) => void;
  onDeleted: (itemId: string) => void;
  // Drops the trailing divider on the last row in a group — the Card
  // wrapping this list already ends cleanly, so a last-row divider was just
  // a redundant line sitting right above the card's own bottom edge.
  isLast?: boolean;
}) {
  const [openThread, setOpenThread] = useState<'comments' | 'drawings' | 'history' | null>(null);
  const [quickComment, setQuickComment] = useState('');
  const [postingQuick, setPostingQuick] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The quick-add box used to render full-width on EVERY item with zero
  // comments yet — on a long group (Procurement runs 16 items) that's 16
  // repeated input+Send pairs stacked end to end, most never used. Collapsed
  // behind a small link instead; tapping it reveals the exact same input.
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  async function handleStatusChange(next: CompletionStatus) {
    const previous = item.hadCompletionRow ? item.status : null;
    const previousChangedAt = item.statusChangedAtISO;
    onChanged(item.id, { status: next, hadCompletionRow: true, statusChangedAtISO: new Date().toISOString() }); // optimistic
    try {
      const changedAtISO = await updateItemStatus(item.id, next, previous, userId ?? '');
      onChanged(item.id, { statusChangedAtISO: changedAtISO }); // reconcile with the real server timestamp
    } catch {
      onChanged(item.id, { status: item.status, hadCompletionRow: item.hadCompletionRow, statusChangedAtISO: previousChangedAt }); // revert
    }
  }

  async function handleQuantitySave(unit: QuantityUnit, value: number) {
    onChanged(item.id, { quantityUnit: unit, quantityValue: value }); // optimistic
    try {
      await updateItemQuantity(item.id, unit, value);
    } catch {
      onChanged(item.id, { quantityUnit: item.quantityUnit, quantityValue: item.quantityValue }); // revert
    }
  }

  // Same "quick add" shortcut as admin-web's DefaultCommentBox — an inline
  // box right in the row, only shown before the item has any comments yet
  // (once it does, the icon + full thread modal below is the path). Posts
  // through the same createItemComment the full thread uses.
  async function handleQuickPost() {
    if (!quickComment.trim()) return;
    setPostingQuick(true);
    try {
      await createItemComment(item.id, quickComment, userId);
      setQuickComment('');
      onChanged(item.id, { commentCount: item.commentCount + 1 });
    } catch {
      // Left in the input so the user can retry rather than losing what they typed.
    } finally {
      setPostingQuick(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteChecklistItem(item.id);
      onDeleted(item.id);
    } catch {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  const showDrawingIcon = hasDrawingRevisions(item.category, item.itemLabel);
  const showQuickAdd = item.commentCount === 0 && openThread !== 'comments' && quickAddOpen;
  const statusColor = STATUS_CHIP[item.status].dot;

  return (
    <View className={`flex-row py-3 ${isLast ? '' : 'border-b border-neutral-100'}`}>
      {/* A thin status-colored bar per row — a long group (Procurement runs
          16 items) otherwise reads as a wall of identical rows; this lets
          the eye scan for red (Pending) without reading every pill. */}
      <View className="w-0.5 rounded-full mr-3" style={{ backgroundColor: statusColor }} />
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <Text className="text-xs font-semibold text-neutral-800 mb-1.5">{item.itemLabel}</Text>
            <View className="flex-row items-center gap-3">
              <StatusPicker status={item.status} changedAtISO={item.statusChangedAtISO} editable={editable} onChange={handleStatusChange} />
              <QuantityControl
                unit={item.quantityUnit}
                value={item.quantityValue}
                readOnly={item.isComputedQuantity}
                editable={editable}
                onSave={handleQuantitySave}
              />
            </View>
          </View>

          <View className="flex-row items-center gap-1">
            <Pressable onPress={() => setOpenThread('comments')} hitSlop={6} className="flex-row items-center gap-0.5 w-7 h-7 rounded-full items-center justify-center bg-neutral-50">
              <Ionicons name="chatbubble-outline" size={14} color="#78716C" />
              {item.commentCount > 0 && <Text className="text-2xs text-neutral-500 absolute -top-1 -right-1 bg-neutral-200 rounded-full w-3.5 h-3.5 text-center" style={{ fontSize: 9, lineHeight: 14 }}>{item.commentCount}</Text>}
            </Pressable>
            {showDrawingIcon && (
              <Pressable onPress={() => setOpenThread('drawings')} hitSlop={6} className="w-7 h-7 rounded-full items-center justify-center bg-neutral-50">
                <Ionicons name="attach-outline" size={15} color="#78716C" />
              </Pressable>
            )}
            <Pressable onPress={() => setOpenThread('history')} hitSlop={6} className="w-7 h-7 rounded-full items-center justify-center bg-neutral-50">
              <Ionicons name="time-outline" size={14} color="#78716C" />
            </Pressable>
            {editable && (
              <Pressable onPress={() => setDeleteConfirmOpen(true)} hitSlop={6} className="w-7 h-7 rounded-full items-center justify-center bg-red-50">
                <Ionicons name="trash-outline" size={14} color="#DC2626" />
              </Pressable>
            )}
          </View>
        </View>

        {item.commentCount === 0 && openThread !== 'comments' && !quickAddOpen && (
          <Pressable onPress={() => setQuickAddOpen(true)} className="self-start mt-2">
            <Text className="text-2xs font-semibold text-neutral-400">+ Add a comment</Text>
          </Pressable>
        )}

        {showQuickAdd && (
          <View className="flex-row items-center gap-1.5 mt-2">
            <TextInput
              value={quickComment}
              onChangeText={setQuickComment}
              placeholder="Add comments…"
              autoFocus
              className="flex-1 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs text-neutral-900"
            />
            <Pressable
              onPress={async () => { await handleQuickPost(); setQuickAddOpen(false); }}
              disabled={postingQuick || !quickComment.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-brand-navy"
            >
              {postingQuick ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-2xs font-semibold text-white">Send</Text>}
            </Pressable>
          </View>
        )}
      </View>

      {openThread === 'comments' && (
        <CommentThreadModal
          itemId={item.id}
          itemLabel={item.itemLabel}
          authorId={userId}
          onClose={() => setOpenThread(null)}
          onPosted={() => onChanged(item.id, { commentCount: item.commentCount + 1 })}
        />
      )}
      {openThread === 'drawings' && (
        <DrawingRevisionDrawer itemId={item.id} itemLabel={item.itemLabel} uploadedBy={userId ?? ''} onClose={() => setOpenThread(null)} />
      )}
      {openThread === 'history' && (
        <StatusHistoryDrawer itemId={item.id} itemLabel={item.itemLabel} currentStatus={item.status} onClose={() => setOpenThread(null)} />
      )}
      {deleteConfirmOpen && (
        <ConfirmDialog
          title="Delete this checklist item?"
          description={`"${item.itemLabel}" and all of its comments, drawing revisions, and status history will be permanently removed.`}
          confirmLabel="Delete"
          variant="danger"
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </View>
  );
}
