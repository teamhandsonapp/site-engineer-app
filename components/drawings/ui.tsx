import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../lib/theme';
import { useModalBottomPadding } from '../../lib/useSafeBottomOffset';
import type { ConsultantStatusDTO } from '../../lib/drawings/types';

// Phone versions of admin-web's side panels and dialogs: a bottom sheet with
// a title, a close button and scrolling content.
export function BottomSheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Keeps the footer buttons / last row above the navigation bar.
  const bottomPad = useModalBottomPadding(footer ? 8 : 24);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable className="flex-1 bg-black/40" onPress={onClose} />
        <View className="bg-white rounded-t-2xl" style={{ maxHeight: '88%' }}>
          <View className="items-center pt-2">
            <View className="w-10 h-1 rounded-full bg-neutral-200" />
          </View>
          <View className="flex-row items-start justify-between px-4 pt-2 pb-3 border-b border-neutral-100">
            <View className="flex-1 pr-3">
              <Text className="text-md font-bold text-neutral-900">{title}</Text>
              {subtitle ? <Text className="text-xs text-neutral-500 mt-0.5">{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close" className="w-9 h-9 items-center justify-center rounded-full bg-neutral-100">
              <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: footer ? 16 : bottomPad }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View className="px-4 pt-2 border-t border-neutral-100" style={{ paddingBottom: bottomPad }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const TONE: Record<'ok' | 'idle' | 'warn' | 'bad', { fg: string; bg: string }> = {
  ok: { fg: '#15803D', bg: '#DCFCE7' },
  idle: { fg: '#4B5563', bg: '#F3F4F6' },
  warn: { fg: '#B45309', bg: '#FEF3C7' },
  bad: { fg: '#B91C1C', bg: '#FEE2E2' },
};

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <View className="self-start rounded-full px-2 py-0.5" style={{ backgroundColor: TONE[tone].bg }}>
      <Text className="text-2xs font-semibold" style={{ color: TONE[tone].fg }}>
        {children}
      </Text>
    </View>
  );
}

// Same wording as admin-web's ConsultantStatusBadge.
export function ConsultantStatusBadge({ status }: { status: ConsultantStatusDTO }) {
  if (status.state === 'current') return <Badge tone="ok">Up to date</Badge>;
  if (status.state === 'no_base') return <Badge tone="idle">Base sheet not issued</Badge>;
  const what = status.state === 'never_issued' ? 'Not issued' : 'Out of date';
  if (status.overdueDays > 0) {
    return (
      <Badge tone="bad">
        {what} · {status.overdueDays} day{status.overdueDays === 1 ? '' : 's'} overdue
      </Badge>
    );
  }
  return (
    <Badge tone="warn">
      {what} · due {status.dueAt ? formatDate(status.dueAt) : ''}
    </Badge>
  );
}

export function Chip({ label, active, onPress, color, disabled, mono }: { label: string; active: boolean; onPress: () => void; color?: string; disabled?: boolean; mono?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center rounded-lg px-3 py-2 mr-1.5 mb-1.5 border ${active ? 'bg-brand-navy border-brand-navy' : 'bg-white border-neutral-200'} ${disabled ? 'opacity-50' : ''}`}
      style={{ minHeight: 36 }}
    >
      {color ? <View className="w-2.5 h-2.5 rounded-sm mr-1.5" style={{ backgroundColor: color }} /> : null}
      <Text className={`text-xs font-semibold ${active ? 'text-white' : 'text-neutral-700'}`}>{label}</Text>
      {mono ? <Text className={`text-2xs ml-1.5 ${active ? 'text-neutral-300' : 'text-neutral-400'}`}>{mono}</Text> : null}
    </Pressable>
  );
}

// Same formats as admin-web's formatDate / formatDateTime ("5 Nov 2026", "5 Nov 2026, 3:04 pm").
export function formatDate(iso: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text className="text-xs font-semibold text-neutral-700 mb-1.5">{children}</Text>;
}
