// The 10 selectable critical-alert tones (assets/sounds/alarm_XX.wav, all
// registered in app.json's expo-notifications `sounds`). Each has its OWN
// Android channel because a channel's sound is fixed forever once created —
// switching tones means switching channels. The server
// (send-zone-alert) maps the id stored on the alert back to the same
// file/channel, so the ids here must stay in sync with its ALARM_IDS.
export interface AlarmSound {
  id: string;
  label: string;
  file: string;
  channelId: string;
}

const LABELS = [
  'Hi-Lo alarm',
  'Siren wail',
  'Police yelp',
  'Fire bell',
  'Klaxon horn',
  'Urgent beeps',
  'Red alert whoop',
  'Pulsing buzzer',
  'Two-tone siren',
  'Emergency chime',
];

export const ALARM_SOUNDS: AlarmSound[] = LABELS.map((label, i) => {
  const id = `alarm_${String(i + 1).padStart(2, '0')}`;
  // #1 (Hi-Lo) reuses the original critical-alarm channel/file, which
  // phones on older builds (25) already have — so the default tone keeps
  // working there instead of falling back to the plain notification sound.
  if (i === 0) return { id, label, file: 'critical_alarm.wav', channelId: 'critical-alarm' };
  return { id, label, file: `${id}.wav`, channelId: `critical-${id}` };
});

export const DEFAULT_ALARM_ID = ALARM_SOUNDS[0].id;

// "Test" in Settings → Send Critical Alert: posts a local notification on the
// tone's own channel, so the admin hears exactly what an engineer's phone
// plays (same file, same channel, same vibration) — no audio library needed.
// Lazy require for the same Expo Go / web reason as pushNotifications.ts.
export async function previewAlarm(alarm: AlarmSound): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Platform } = require('react-native') as typeof import('react-native');
  if (Platform.OS === 'web') throw new Error('Sound preview works in the phone app, not the web preview.');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') throw new Error('Turn on notifications for PMC Portal to preview sounds.');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(alarm.channelId, {
      name: `Critical alarm – ${alarm.label}`,
      importance: Notifications.AndroidImportance.MAX,
      sound: alarm.file,
      vibrationPattern: [0, 800, 300, 800, 300, 800, 300, 800],
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  await Notifications.scheduleNotificationAsync({
    content: { title: `Sound test: ${alarm.label}`, body: 'This is how a critical alert will sound.', sound: alarm.file },
    trigger: Platform.OS === 'android' ? { channelId: alarm.channelId } : null,
  });
}
