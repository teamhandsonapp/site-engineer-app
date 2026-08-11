import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { Card } from './Card';

// One shared confirm dialog — used by both link-deletion (series links only,
// per RelationshipToolbar) and task-deletion, matching admin-web's own
// ConfirmDialog pattern (title/description/confirmLabel/danger-vs-warning
// styling) rather than each caller building its own modal shell.
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'danger',
  busy = false,
  children,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  busy?: boolean;
  // Optional extra content between the description and the action buttons
  // (e.g. checklist verification's optional note TextInput) — every
  // existing caller omits this and renders exactly as before.
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onCancel}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 360 }}>
          <Card>
            <Text className="text-sm font-bold text-neutral-900 mb-1.5">{title}</Text>
            <Text className="text-xs text-neutral-500 mb-4">{description}</Text>
            {children}
            <View className="flex-row justify-end gap-2">
              <Pressable onPress={onCancel} disabled={busy} className="px-3.5 py-2 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">{cancelLabel}</Text>
              </Pressable>
              <Pressable
                onPress={onConfirm}
                disabled={busy}
                className={`px-3.5 py-2 rounded-lg flex-row items-center gap-1.5 ${variant === 'danger' ? 'bg-red-600' : 'bg-amber-500'}`}
              >
                {busy && <ActivityIndicator size="small" color="#fff" />}
                <Text className="text-xs font-semibold text-white">{confirmLabel}</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
