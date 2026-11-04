// Record the meeting from the phone's mic. Recordings are moved out of the
// recorder's temp cache into the app's own documents folder so they survive
// app restarts, and listed with play / delete. Transcribe is shown but not
// connected yet (needs a speech-to-text service — see the MoM README notes).
//
// Recording only runs while PMC Portal is open on screen — background
// recording is deliberately OFF (app.json expo-audio plugin) so the Play
// release doesn't need a foreground-service declaration. Keep the phone
// awake / screen on during the meeting.

import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { newId } from '../../lib/mom/store';
import type { MeetingRecording } from '../../lib/mom/types';
import { logError } from '../../lib/sentryLog';
import { Banner, Button, NAVY } from './ui';

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

async function persist(tempUri: string, id: string): Promise<string> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return tempUri;
  const dir = `${FileSystem.documentDirectory}mom-recordings/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const ext = tempUri.split('.').pop()?.split('?')[0] || 'm4a';
  const dest = `${dir}${id}.${ext}`;
  await FileSystem.moveAsync({ from: tempUri, to: dest });
  return dest;
}

export function MeetingRecorder({
  recordings,
  onAdd,
  onDelete,
}: {
  recordings: MeetingRecording[];
  onAdd: (r: MeetingRecording) => void;
  onDelete: (id: string) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 500);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function start() {
    setError(null);
    setInfo(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone permission is needed to record. Allow it in your phone Settings → Apps → PMC Portal → Permissions.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPaused(false);
    } catch (e) {
      logError(e, 'mom_record_start');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function togglePause() {
    if (paused) {
      recorder.record();
      setPaused(false);
    } else {
      recorder.pause();
      setPaused(true);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      const duration = recorder.getStatus().durationMillis;
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      const temp = recorder.uri;
      if (!temp) throw new Error('The recording could not be saved.');
      const id = newId();
      const uri = await persist(temp, id);
      onAdd({ id, uri, durationMillis: duration, createdAtISO: new Date().toISOString(), transcript: null });
      setPaused(false);
      setInfo(Platform.OS === 'web' ? 'Saved for this browser session — download it before closing the tab.' : 'Recording saved on this phone.');
    } catch (e) {
      logError(e, 'mom_record_stop');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const recording = state.isRecording || paused;

  return (
    <View>
      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
      {info && <Banner tone="ok" onClose={() => setInfo(null)}>{info}</Banner>}

      <View className="rounded-2xl px-4 py-4 mb-3" style={{ backgroundColor: recording ? '#FEF2F2' : '#F8FAFC', borderWidth: 1, borderColor: recording ? '#FECACA' : '#E5E7EB' }}>
        <View className="flex-row items-center gap-3">
          <View className="h-3 w-3 rounded-full" style={{ backgroundColor: state.isRecording ? '#DC2626' : paused ? '#F59E0B' : '#9CA3AF' }} />
          <Text className="text-2xl font-bold text-neutral-900" style={{ fontVariant: ['tabular-nums'] }}>
            {clock(state.durationMillis ?? 0)}
          </Text>
          <Text className="text-xs text-neutral-500 flex-1">{state.isRecording ? 'Recording…' : paused ? 'Paused' : 'Ready to record'}</Text>
        </View>
        <View className="flex-row gap-2 mt-3">
          {!recording ? (
            <View className="flex-1">
              <Button label="Record" icon="mic" variant="danger" onPress={start} />
            </View>
          ) : (
            <>
              <View className="flex-1">
                <Button label={paused ? 'Resume' : 'Pause'} icon={paused ? 'play' : 'pause'} variant="secondary" onPress={togglePause} />
              </View>
              <View className="flex-1">
                <Button label="Stop & save" icon="stop" onPress={stop} busy={busy} />
              </View>
            </>
          )}
        </View>
        {recording && <Text className="text-2xs text-neutral-500 mt-2">Keep PMC Portal open on screen until you stop — recording pauses if you leave the app.</Text>}
      </View>

      {recordings.length === 0 ? (
        <Text className="text-xs text-neutral-400">No recordings yet.</Text>
      ) : (
        recordings.map((r, i) => <RecordingRow key={r.id} index={i + 1} recording={r} onDelete={() => onDelete(r.id)} />)
      )}
    </View>
  );
}

function RecordingRow({ recording, index, onDelete }: { recording: MeetingRecording; index: number; onDelete: () => void }) {
  const player = useAudioPlayer(recording.uri);
  const status = useAudioPlayerStatus(player);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (status.didJustFinish) {
      player.seekTo(0);
      player.pause();
    }
  }, [status.didJustFinish, player]);

  const when = new Date(recording.createdAtISO).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <View className="rounded-xl bg-white border border-neutral-100 px-3 py-2.5 mb-2">
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => (status.playing ? player.pause() : player.play())}
          className="h-9 w-9 rounded-full items-center justify-center"
          style={{ backgroundColor: NAVY }}
        >
          <Ionicons name={status.playing ? 'pause' : 'play'} size={16} color="#fff" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-neutral-900">Recording {index}</Text>
          <Text className="text-2xs text-neutral-500">
            {when} · {clock(recording.durationMillis)}
            {status.playing || status.currentTime > 0 ? ` · ${clock(status.currentTime * 1000)}` : ''}
          </Text>
        </View>
        <Pressable hitSlop={8} onPress={() => setNote('Transcribe will turn this recording into text minutes. It needs a speech-to-text service to be connected first.')}>
          <View className="flex-row items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1">
            <Ionicons name="document-text-outline" size={13} color={NAVY} />
            <Text className="text-2xs font-bold" style={{ color: NAVY }}>Transcribe</Text>
          </View>
        </Pressable>
        <Pressable hitSlop={8} onPress={() => (confirm ? onDelete() : setConfirm(true))}>
          <Ionicons name={confirm ? 'trash' : 'trash-outline'} size={17} color={confirm ? '#DC2626' : '#9CA3AF'} />
        </Pressable>
      </View>
      {confirm && (
        <View className="flex-row items-center gap-2 mt-2">
          <Text className="text-2xs text-red-600 flex-1">Tap the bin again to delete this recording.</Text>
          <Pressable onPress={() => setConfirm(false)}>
            <Text className="text-2xs font-bold text-neutral-500">Cancel</Text>
          </Pressable>
        </View>
      )}
      {recording.transcript && <Text className="text-xs text-neutral-700 mt-2">{recording.transcript}</Text>}
      {note && <Text className="text-2xs text-blue-700 mt-2">{note}</Text>}
    </View>
  );
}
