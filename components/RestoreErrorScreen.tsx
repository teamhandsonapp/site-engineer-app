import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Shown when AuthContext's restore() genuinely fails (dead network, an
// unreachable Supabase project, or a hung request past its timeout) —
// this is what replaces an indefinite loading spinner with an honest,
// recoverable state.
export function RestoreErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center bg-brand-navy px-8">
      <Ionicons name="cloud-offline-outline" size={40} color="#F0A227" />
      <Text className="text-lg font-semibold text-white text-center mt-4 mb-2">Couldn&apos;t load your session</Text>
      <Text className="text-sm text-white/60 text-center leading-[19px] mb-6">{message}</Text>
      <Pressable
        onPress={onRetry}
        className="px-6 py-3 rounded-xl bg-brand-amber"
        style={{ minHeight: 48, justifyContent: 'center' }}
      >
        <Text className="text-sm font-semibold text-brand-amber-deep">Retry</Text>
      </Pressable>
    </View>
  );
}
