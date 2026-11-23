import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, TextInput } from './ui/AppText';
import { Card } from './ui/Card';
import { fetchAndroidUpdateSetting, setAndroidMinBuild, type AppVersionSetting } from '../lib/forceUpdate';

const INPUT_CLASS = 'border border-neutral-200 rounded-lg px-3 py-2.5 text-sm text-neutral-900';
const DEFAULT_MESSAGE = 'A new version of PMC Portal is available. Please update to keep using the app.';

// Settings → Notifications → "App update" (2026-11-21, client), admin only.
// After a new build is live on Google Play, set it as required: every phone
// on an older build gets the full-screen "Update required" (ForceUpdateGate)
// and can't enter the app until it updates. 0 = nobody is blocked.
export function AppUpdateCard({ onResult }: { onResult: (type: 'success' | 'error', message: string) => void }) {
  const [setting, setSetting] = useState<AppVersionSetting | null>(null);
  const [newestSeen, setNewestSeen] = useState<number | null>(null);
  const [build, setBuild] = useState('');
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<'require' | 'off' | null>(null);

  const load = useCallback(() => {
    fetchAndroidUpdateSetting()
      .then(({ setting: s, newestSeen: n }) => {
        setSetting(s);
        setNewestSeen(n);
        setBuild(String(Math.max(s.minBuild, n ?? 0) || ''));
        setMessage(s.message ?? '');
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  const target = Number(build);
  const valid = Number.isInteger(target) && target > 0;

  async function save(minBuild: number) {
    setSaving(true);
    try {
      await setAndroidMinBuild(minBuild, minBuild ? message || DEFAULT_MESSAGE : message);
      onResult('success', minBuild ? `Build ${minBuild} is now required. Older phones must update to enter the app.` : 'Update requirement turned off.');
      setConfirming(null);
      load();
    } catch (e) {
      onResult('error', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <View className="flex-row items-center gap-2 mb-1">
        <Ionicons name="cloud-download-outline" size={16} color="#0F1F33" />
        <Text className="text-sm font-bold text-neutral-900">App update (Android)</Text>
      </View>
      <Text className="text-2xs text-neutral-400 mb-3">
        Make a build required: phones on an older build see “Update required” and can’t enter the app until they update from Google Play.
      </Text>

      <Text className="text-xs mb-1" style={{ color: loadError ? '#DC2626' : '#374151' }}>
        {loadError
          ? `Couldn't load: ${loadError}`
          : setting
            ? setting.minBuild
              ? `Required now: build ${setting.minBuild}`
              : 'Required now: none — nobody is blocked'
            : 'Loading…'}
      </Text>
      {newestSeen ? <Text className="text-2xs text-neutral-500 mb-3">Newest build opened on a phone: {newestSeen}</Text> : <View className="mb-3" />}

      <Text className="text-xs text-neutral-400 mb-1.5">Required build number</Text>
      <TextInput
        value={build}
        onChangeText={(t) => {
          setBuild(t.replace(/[^0-9]/g, ''));
          setConfirming(null);
        }}
        keyboardType="number-pad"
        placeholder="e.g. 46"
        placeholderTextColor="#9CA3AF"
        className={`${INPUT_CLASS} mb-3`}
      />
      <Text className="text-xs text-neutral-400 mb-1.5">Message on the update screen</Text>
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder={DEFAULT_MESSAGE}
        placeholderTextColor="#9CA3AF"
        multiline
        maxLength={200}
        className={`${INPUT_CLASS} mb-3`}
        style={{ minHeight: 56, textAlignVertical: 'top' }}
      />
      <View className="rounded-lg px-3 py-2 mb-3" style={{ backgroundColor: '#FEF3C7' }}>
        <Text className="text-2xs" style={{ color: '#92400E' }}>
          Only require a build once it’s live on Google Play for the testers — otherwise they’ll be stuck on the update screen with nothing to install.
        </Text>
      </View>

      <View className="flex-row gap-2">
        <Pressable
          onPress={() => (confirming === 'off' ? void save(0) : setConfirming('off'))}
          disabled={saving || !setting?.minBuild}
          className="flex-1 px-3 py-2.5 rounded-lg border border-neutral-300 items-center"
          style={{ opacity: saving || !setting?.minBuild ? 0.5 : 1 }}
        >
          <Text className="text-xs font-semibold text-neutral-800">{confirming === 'off' ? 'Tap again to turn off' : 'Turn off'}</Text>
        </Pressable>
        <Pressable
          onPress={() => (confirming === 'require' ? void save(target) : setConfirming('require'))}
          disabled={saving || !valid}
          className="flex-1 px-3 py-2.5 rounded-lg items-center flex-row justify-center gap-2"
          style={{ backgroundColor: confirming === 'require' ? '#B45309' : '#0F1F33', opacity: saving || !valid ? 0.5 : 1 }}
        >
          {saving && <ActivityIndicator size="small" color="#fff" />}
          <Text className="text-xs font-semibold text-white">
            {confirming === 'require' ? `Tap again: require ${target}` : `Require build ${valid ? target : ''}`}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}
