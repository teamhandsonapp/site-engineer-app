import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ParamCheckResult } from '../../lib/debug/taskReportParamCheck';

// TEMP DEBUG - REMOVE BEFORE CLIENT DELIVERY. See
// lib/debug/taskReportParamCheck.ts's own header comment for exactly what
// else to delete alongside this file once verification is done. Collapsed
// by default so it stays out of the way until someone deliberately opens
// it — this is a verification tool, not part of the real report UI.
export function DebugParamCheckPanel({ results }: { results: ParamCheckResult[] }) {
  const [open, setOpen] = useState(false);
  const okCount = results.filter((r) => r.ok).length;

  return (
    <View className="rounded-xl border border-dashed border-amber-300 bg-amber-50 mb-3.5 overflow-hidden">
      <Pressable onPress={() => setOpen((v) => !v)} className="flex-row items-center justify-between px-3.5 py-2.5">
        <Text className="text-2xs font-bold uppercase tracking-wide text-amber-700">
          🐛 Debug: Parameter Check ({okCount}/{results.length} green)
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#B45309" />
      </Pressable>

      {open && (
        <View className="px-3.5 pb-3 pt-0.5">
          {results.map((r) => (
            <View key={r.key} className="flex-row items-start justify-between gap-2 py-1.5 border-t border-amber-100">
              <View className="flex-row items-center gap-1.5 flex-1 pr-2">
                <Ionicons name={r.ok ? 'checkmark-circle' : 'close-circle'} size={14} color={r.ok ? '#16A34A' : '#DC2626'} />
                <Text className="text-xs font-medium text-neutral-800 flex-1" numberOfLines={2}>{r.label}</Text>
              </View>
              <Text className="text-2xs text-neutral-500 flex-shrink-0" numberOfLines={1} style={{ maxWidth: 120 }}>
                {r.detail}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
