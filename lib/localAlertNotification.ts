import Constants, { AppOwnership } from 'expo-constants';
import { Platform } from 'react-native';
import { devWarn } from './devLog';

// Same require-guard as pushNotifications.ts / notificationRouting.ts — a
// static `import * as Notifications from 'expo-notifications'` crashes Expo
// Go on launch (SDK 53+ limitation), and the module has no real
// implementation on web either.
const isWeb = Platform.OS === 'web';
const isExpoGo = Constants.appOwnership === AppOwnership.Expo;
const Notifications = !isWeb && !isExpoGo
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-notifications') as typeof import('expo-notifications'))
  : null;

// expo-notifications has no sound API at all on web, so there's nothing for
// that module to call there. This plays an actual audible tone via the
// browser's own Web Audio API instead — no sound asset needed, just an
// oscillator — so testing this feature via `expo start --web` still
// produces real sound, not just the silent visual banner.
//
// Browsers refuse to play ANY audio (even oscillator tones) unless the
// AudioContext was created/resumed inside a direct user-gesture call stack
// (a click, a keypress) — an async callback from a Realtime WebSocket event
// does not count, which is exactly why the first attempt was silent. The
// fix is to create one shared AudioContext the moment the user first clicks
// anywhere on the page (satisfying that gesture requirement once) and reuse
// that same unlocked context for every later, gesture-less alert sound.
let sharedAudioCtx: AudioContext | null = null;

function getAudioContextClass(): typeof AudioContext | undefined {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext;
}

if (isWeb && typeof window !== 'undefined') {
  const unlock = () => {
    if (!sharedAudioCtx) {
      const AudioContextClass = getAudioContextClass();
      if (AudioContextClass) sharedAudioCtx = new AudioContextClass();
    }
    sharedAudioCtx?.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function playTone(ctx: AudioContext, freq: number, startDelayMs: number, durationSec: number, volume: number): void {
  setTimeout(() => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
  }, startDelayMs);
}

// Distinguishable-by-ear on web too, matching the native .wav pair's own
// character (see assets/sounds/ — a calm two-note chime vs. a sharper
// triple-beep) rather than the same generic double-beep for every alert
// type, so testing via `expo start --web` still proves the two sounds are
// actually different, not just differently named.
function playWebBeep(sound: LocalAlertSound | undefined): void {
  try {
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) return;
    // Reuse the gesture-unlocked context if one exists; only falls back to
    // a fresh (likely still-locked) context if the user hasn't clicked
    // anywhere on the page yet this session.
    const ctx = sharedAudioCtx ?? new AudioContextClass();
    sharedAudioCtx = ctx;
    ctx.resume().catch(() => {});

    if (sound === 'redzone_entry.wav') {
      // Sharp, fast, alternating-pitch triple beep — the higher-urgency tone.
      playTone(ctx, 880, 0, 0.15, 0.3);
      playTone(ctx, 1046, 160, 0.15, 0.3);
      playTone(ctx, 880, 320, 0.15, 0.3);
    } else {
      // Calmer two-note ascending chime — the default/boundary-exit tone.
      playTone(ctx, 523, 0, 0.3, 0.22);
      playTone(ctx, 659, 220, 0.35, 0.22);
    }
  } catch (err) {
    devWarn('[local-alert] Web beep failed:', err instanceof Error ? err.message : String(err));
  }
}

// The two registered filenames (app.json's expo-notifications plugin
// `sounds` array + the actual files under assets/sounds/) — a distinct
// sound per event severity, not the OS default for everything. Omitting
// `sound` entirely keeps the previous `true` (OS default) behavior for any
// caller that doesn't care which tone plays.
export type LocalAlertSound = 'boundary_exit.wav' | 'redzone_entry.wav';

// Fires a LOCAL notification (sound + banner, via the foreground-visible
// handler already configured in notificationRouting.ts) the instant a new
// row is detected through a Supabase Realtime subscription — see
// critical-alerts.tsx's restricted_zone_alerts/geofence_alerts channels.
// This is what makes an alert reach a signed-in admin/manager while the
// app is open WITHOUT depending on the trigger -> Edge Function -> Expo
// push token chain, which was root-caused separately as broken by
// configuration (an empty zone_alert_recipients table), not by this
// notification path.
export async function fireLocalAlertNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  sound?: LocalAlertSound
): Promise<void> {
  if (isWeb) {
    playWebBeep(sound);
    return;
  }
  if (!Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      // A real filename string here (not `true`, not the string 'default'
      // treated as a filename — that was the earlier, separate bug) is
      // exactly what expo-notifications needs to play a file registered in
      // app.json's own `sounds` array instead of the OS default tone.
      content: { title, body, data, sound: sound ?? true },
      trigger: null,
    });
  } catch (err) {
    devWarn('[local-alert] Failed to fire local notification:', err instanceof Error ? err.message : String(err));
  }
}
