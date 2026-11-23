// Small shared building blocks for the MoM tabs, styled to match the rest
// of the app (navy / amber, IBM Plex via the global font, Card surfaces).

import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, View, type TextInputProps } from 'react-native';
import { Text, TextInput } from '../ui/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useModalBottomPadding } from '../../lib/useSafeBottomOffset';

const NativeDateTimePicker = Platform.OS !== 'web' ? require('@react-native-community/datetimepicker').default : null;

export const NAVY = '#0F1F33';
export const AMBER = '#F0A227';

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between mt-1 mb-2">
      <Text className="flex-1 text-xs font-bold uppercase tracking-wider text-neutral-500 mr-2" numberOfLines={2}>{children}</Text>
      {right ? <View className="shrink-0">{right}</View> : null}
    </View>
  );
}

export function Button({
  label,
  icon,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  small,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
}) {
  const styles = {
    primary: { bg: NAVY, fg: '#fff', border: NAVY },
    secondary: { bg: '#fff', fg: NAVY, border: '#D1D5DB' },
    danger: { bg: '#DC2626', fg: '#fff', border: '#DC2626' },
    ghost: { bg: 'transparent', fg: NAVY, border: 'transparent' },
  }[variant];
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      className={`flex-row items-center justify-center gap-1.5 rounded-xl ${small ? 'px-3' : 'px-4'}`}
      style={{ minHeight: small ? 36 : 44, backgroundColor: styles.bg, borderWidth: 1, borderColor: styles.border, opacity: off ? 0.5 : 1 }}
    >
      {busy ? <ActivityIndicator size="small" color={styles.fg} /> : icon ? <Ionicons name={icon} size={small ? 15 : 17} color={styles.fg} /> : null}
      <Text className={`${small ? 'text-xs' : 'text-sm'} font-bold`} style={{ color: styles.fg, flexShrink: 1 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress, color }: { label: string; active: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full px-3 py-1.5 border"
      style={{ backgroundColor: active ? (color ?? NAVY) : '#fff', borderColor: active ? (color ?? NAVY) : '#E5E7EB' }}
    >
      <Text className="text-xs font-semibold" style={{ color: active ? '#fff' : '#374151' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label?: string }) {
  return (
    <View>
      {label && <Text className="text-xs text-neutral-400 mb-1">{label}</Text>}
      <TextInput
        placeholderTextColor="#9CA3AF"
        className="border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900 bg-white"
        style={props.multiline ? { minHeight: 80, textAlignVertical: 'top' } : undefined}
        {...props}
      />
    </View>
  );
}

export function Banner({ tone, children, onClose }: { tone: 'ok' | 'error' | 'info'; children: ReactNode; onClose?: () => void }) {
  const c = {
    ok: { bg: '#F0FDF4', border: '#BBF7D0', fg: '#166534', icon: 'checkmark-circle-outline' as const },
    error: { bg: '#FEF2F2', border: '#FECACA', fg: '#B91C1C', icon: 'alert-circle-outline' as const },
    info: { bg: '#EFF6FF', border: '#BFDBFE', fg: '#1E40AF', icon: 'information-circle-outline' as const },
  }[tone];
  return (
    <View className="rounded-xl px-3.5 py-3 mb-3 flex-row items-start gap-2" style={{ backgroundColor: c.bg, borderWidth: 1, borderColor: c.border }}>
      <Ionicons name={c.icon} size={16} color={c.fg} style={{ marginTop: 1 }} />
      <Text className="text-sm flex-1" style={{ color: c.fg }}>
        {children}
      </Text>
      {onClose && (
        <Pressable hitSlop={8} onPress={onClose}>
          <Ionicons name="close" size={16} color={c.fg} />
        </Pressable>
      )}
    </View>
  );
}

// 'HH:MM' 24h. Native clock picker on Android/iOS; a plain HH:MM box on web.
export function TimeField({ label, value, onChange }: { label?: string; value: string | null; onChange: (time: string) => void }) {
  const sheetBottomPad = useModalBottomPadding(8); // iPhone home bar
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? '');

  const display = value
    ? (() => {
        const [h, m] = value.split(':').map(Number);
        return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
      })()
    : 'Select time';

  if (Platform.OS === 'web') {
    return (
      <Field
        label={label ? `${label} (24h, HH:MM)` : 'Time (24h, HH:MM)'}
        value={text}
        placeholder="10:30"
        onChangeText={(t) => {
          setText(t);
          const m = t.match(/^(\d{1,2}):(\d{2})$/);
          if (m && Number(m[1]) < 24 && Number(m[2]) < 60) onChange(`${m[1].padStart(2, '0')}:${m[2]}`);
        }}
      />
    );
  }

  const base = new Date();
  if (value) {
    const [h, m] = value.split(':').map(Number);
    base.setHours(h, m, 0, 0);
  }

  return (
    <View>
      {label && <Text className="text-xs text-neutral-400 mb-1">{label}</Text>}
      <Pressable onPress={() => setOpen(true)} className="border border-neutral-200 rounded-lg px-3 py-2.5 bg-white">
        <Text className="text-sm text-neutral-900">{display}</Text>
      </Pressable>
      {open && Platform.OS === 'android' && (
        <NativeDateTimePicker
          value={base}
          mode="time"
          onChange={(e: { type: string }, d?: Date) => {
            setOpen(false);
            if (e.type === 'set' && d) onChange(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
          }}
        />
      )}
      {open && Platform.OS === 'ios' && (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setOpen(false)}>
            <Pressable className="bg-white rounded-t-2xl pt-2" style={{ paddingBottom: sheetBottomPad }}>
              <NativeDateTimePicker
                value={base}
                mode="time"
                display="spinner"
                onChange={(_e: unknown, d?: Date) => {
                  if (d) onChange(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
                }}
              />
              <View className="px-4">
                <Button label="Done" onPress={() => setOpen(false)} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

export function Row({ children, gap = 8 }: { children: ReactNode; gap?: number }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>{children}</View>;
}
