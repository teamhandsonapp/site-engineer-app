import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { DPR_COMMENT_LABEL, DPR_COMMENT_PRESETS, type DprComment, type DprCommentPreset } from '../../lib/dprEntries';

// Same tap-chip-opens-modal shape as StatusPicker — 'other' switches the
// same modal over to a free-text step instead of closing immediately,
// mirroring StatusPicker's own pendingStatus→backdate-date step.
export function CommentPicker({
  comment,
  required,
  editable,
  onChange,
}: {
  comment: DprComment | null;
  // Point 8 — Comments is required once the task's status is On Hold /
  // "Yet to Start"; drives the chip's empty-state styling only, the actual
  // block-on-submit happens one level up (app/(authenticated)/daily-updates.tsx's validation).
  required: boolean;
  editable: boolean;
  onChange: (next: DprComment | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customText, setCustomText] = useState(comment?.preset === 'other' ? (comment.text ?? '') : '');
  const [showCustomInput, setShowCustomInput] = useState(false);

  function closeAll() {
    setOpen(false);
    setShowCustomInput(false);
  }

  function selectPreset(preset: DprCommentPreset) {
    if (preset === 'other') {
      setCustomText(comment?.preset === 'other' ? (comment.text ?? '') : '');
      setShowCustomInput(true);
      return;
    }
    closeAll();
    onChange({ preset, text: null });
  }

  function confirmCustomText() {
    const text = customText.trim();
    if (!text) return;
    closeAll();
    onChange({ preset: 'other', text });
  }

  const label = comment ? (comment.preset === 'other' ? comment.text : DPR_COMMENT_LABEL[comment.preset]) : null;

  return (
    <>
      <Pressable
        onPress={() => editable && setOpen(true)}
        className="px-2.5 py-1.5 rounded-lg border"
        style={{
          borderColor: label ? '#E5E5E5' : required ? '#FCA5A5' : '#E5E5E5',
          backgroundColor: label ? '#FAFAFA' : required ? '#FEF2F2' : '#FAFAFA',
        }}
      >
        <Text className="text-xs" numberOfLines={2} style={{ color: label ? '#262626' : required ? '#DC2626' : '#A3A3A3' }}>
          {label ?? (required ? 'Required — select a reason' : 'Tap to add a comment')}
        </Text>
      </Pressable>

      {open && (
        <Modal visible transparent animationType="fade" onRequestClose={closeAll}>
          <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={closeAll}>
            <Pressable onPress={() => {}} className="bg-white rounded-2xl p-3" style={{ width: '100%', maxWidth: 340, maxHeight: '80%' }}>
              {showCustomInput ? (
                <View className="p-1">
                  <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">Type your own</Text>
                  <TextInput
                    value={customText}
                    onChangeText={setCustomText}
                    placeholder="Describe the reason…"
                    multiline
                    autoFocus
                    className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900"
                    style={{ minHeight: 70 }}
                  />
                  <View className="flex-row justify-end gap-2 mt-3.5">
                    <Pressable onPress={() => setShowCustomInput(false)} className="px-3.5 py-2 rounded-lg">
                      <Text className="text-xs font-semibold text-neutral-500">Back</Text>
                    </Pressable>
                    <Pressable
                      onPress={confirmCustomText}
                      disabled={!customText.trim()}
                      className="px-3.5 py-2 rounded-lg bg-brand-navy"
                      style={{ opacity: customText.trim() ? 1 : 0.5 }}
                    >
                      <Text className="text-xs font-bold text-white">Confirm</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-2 px-1">Comment</Text>
                  <View className="gap-1">
                    {DPR_COMMENT_PRESETS.map((preset) => {
                      const active = comment?.preset === preset;
                      return (
                        <Pressable
                          key={preset}
                          onPress={() => selectPreset(preset)}
                          className={`px-3 py-2.5 rounded-lg ${active ? 'bg-neutral-100' : ''}`}
                        >
                          <Text className="text-sm text-neutral-800" style={{ fontWeight: active ? '700' : '400' }}>
                            {DPR_COMMENT_LABEL[preset]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}
