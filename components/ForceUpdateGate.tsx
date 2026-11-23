import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, Linking, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from './ui/AppText';
import { checkForceUpdate, type UpdateRequirement } from '../lib/forceUpdate';

// Blocks the whole app with an "Update required" screen when this build is
// older than the minimum set in `app_versions` (lib/forceUpdate.ts). Checked
// on launch and every time the app comes back to the foreground, so raising
// the minimum takes effect without the user restarting the app.
export function ForceUpdateGate({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<UpdateRequirement | null>(null);

  const check = useCallback(() => {
    checkForceUpdate()
      .then(setReq)
      .catch(() => {}); // offline etc. → don't block
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, [check]);

  if (!req?.required) return <>{children}</>;

  return (
    <View style={{ flex: 1, backgroundColor: '#0F1F33', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#F0A227', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <Ionicons name="cloud-download-outline" size={36} color="#0F1F33" />
      </View>
      <Text style={{ fontSize: 22, fontWeight: '700', color: '#fff', textAlign: 'center' }}>Update required</Text>
      <Text style={{ fontSize: 15, color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: 10, lineHeight: 22 }}>
        {req.message || 'A new version of PMC Portal is available. Please update to keep using the app.'}
      </Text>
      <Pressable
        onPress={() => void Linking.openURL(req.storeUrl)}
        style={{ marginTop: 28, backgroundColor: '#F0A227', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 36 }}
      >
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F1F33' }}>Update now</Text>
      </Pressable>
      <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 18 }}>
        This version: {req.currentBuild} · Required: {req.minBuild}
      </Text>
    </View>
  );
}
