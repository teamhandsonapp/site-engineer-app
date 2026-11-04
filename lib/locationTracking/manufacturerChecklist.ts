import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { MANUFACTURER_CHECKLIST_DONE_KEY } from './storageKeys';

// Escalation from deviceInfo.ts's optional, self-serve "If tracking seems
// unreliable" help card to a MANDATORY, blocking, checkbox-confirmed gate —
// built directly from a real live failure (Prashuramu's Oppo device never
// once successfully reported a location ping, most likely because none of
// these OEM-specific toggles were ever set, and the optional card is easy
// to skip/ignore). Only the worst, most aggressive background-killers get
// the mandatory treatment; deviceInfo.ts's own KNOWN_PROBLEM_MANUFACTURERS
// list covers the rest with the softer, non-blocking path.
//
// Samsung promoted to mandatory 2026-08-16 from a second real live failure
// (Periyasamy's Samsung SM-E236B: zero successful location pings ever,
// background task silent ~76 min after first login) — same shape as the
// original Oppo failure that justified this file existing at all.
//
// Every step below is sourced from dontkillmyapp.com's own current
// per-manufacturer pages (fetched directly, not written from general
// knowledge — exact OEM menu wording drifts across OS versions/regions and
// getting it wrong would make a MANDATORY gate actively unhelpful, per the
// spec this was built against). Still worth re-verifying against whatever
// ColorOS/MIUI/etc. version a specific problem device is actually running
// if a checklist stops matching reality.
export interface ChecklistStep {
  id: string;
  instruction: string;
}

export interface ManufacturerChecklist {
  key: string;
  displayName: string;
  steps: ChecklistStep[];
}

const APP_NAME = 'PMC Portal';

const CHECKLISTS: Record<string, ManufacturerChecklist> = {
  oppo: {
    key: 'oppo',
    displayName: 'Oppo (ColorOS)',
    // Re-checked 2026-08-14 against the CPH2721's actual installed version
    // (ColorOS 16). One step below is now independently confirmed for
    // THIS version specifically (the sleep-standby path, via web search —
    // "Settings > Battery > More Settings > Sleep Standby Optimization" on
    // ColorOS 16); the other two (battery-management, auto-startup) could
    // NOT be independently re-confirmed for ColorOS 15/16 specifically in
    // this pass — the only sourced material found for those was for much
    // older ColorOS (F1S/ColorOS 6), and dontkillmyapp.com's own Oppo page
    // states outright it only has confirmed steps for that old version.
    // Wording below is the best available (unchanged from before, still
    // plausible/consistent with newer ColorOS's general structure) but is
    // NOT re-verified against ColorOS 16 the way the sleep-standby step
    // now is. Flagging rather than presenting all 3 as equally confirmed.
    steps: [
      { id: 'battery-management', instruction: `Settings → Battery → App Battery Management → find ${APP_NAME} → set it to allow background/foreground activity (not "Optimize" or "Restrict"). (Not independently re-confirmed against ColorOS 16 specifically — see this checklist's own code comment.)` },
      { id: 'no-optimize', instruction: `Settings → Battery → More Settings → Sleep Standby Optimization → turn this OFF for ${APP_NAME} (confirmed present under this exact path on ColorOS 16).` },
      { id: 'auto-startup', instruction: `Settings → Apps → App info → ${APP_NAME} → enable "Allow Auto Start-up". (Not independently re-confirmed against ColorOS 16 specifically.)` },
    ],
  },
  realme: {
    key: 'realme',
    displayName: 'Realme (Realme UI / ColorOS)',
    steps: [
      { id: 'battery-management', instruction: `Settings → Battery → Power saving settings → App battery management → find ${APP_NAME}.` },
      { id: 'allow-activity', instruction: `Enable "Allow background activity" and "Allow foreground activity", and turn OFF "Optimize battery use" for ${APP_NAME}.` },
      { id: 'popup-access', instruction: `Settings → Apps → Special access → allow ${APP_NAME} to display pop-up windows while running in the background.` },
    ],
  },
  xiaomi: {
    key: 'xiaomi',
    displayName: 'Xiaomi / Redmi / POCO (MIUI / HyperOS)',
    // Re-checked 2026-08-14 against the Redmi 13C 5G's actual installed
    // version (HyperOS 2.0.207.0.VGQINXM) via web search. The menu PATHS
    // are the same shape as older MIUI (confirmed), but HyperOS has one
    // real behavioral difference worth calling out explicitly: the
    // App-permissions "Background autostart" toggle and the separate
    // Security-app "Autostart" toggle are TWO INDEPENDENT permissions on
    // HyperOS, not one setting surfaced in two places — someone who only
    // finds/enables one can wrongly assume they're done. Added as its own
    // step rather than folding it into the existing autostart step, since
    // it's a distinct action, not just alternate wording for the same one.
    steps: [
      { id: 'autostart', instruction: `Settings → Apps → Manage apps → ${APP_NAME} → App permissions → enable "Autostart" / "Background autostart".` },
      { id: 'autostart-security-app', instruction: `HyperOS specifically: this is a SEPARATE permission from the step above, not the same setting — also open the Security app → Autostart (or App Lock/Boost) → enable ${APP_NAME} there too. Enabling only one of these two is a common way this gets half-done.` },
      { id: 'battery-saver', instruction: `Settings → Battery & performance → App battery saver (or "Manage apps' battery usage") → ${APP_NAME} → set to "No restrictions".` },
      { id: 'keep-running', instruction: `If shown: Settings → Apps → ${APP_NAME} → Battery → enable "Keep running after screen off" and turn off "Power-intensive prompt".` },
    ],
  },
  vivo: {
    key: 'vivo',
    displayName: 'Vivo (Funtouch OS / OriginOS)',
    steps: [
      { id: 'autostart', instruction: `Settings → More settings → Applications → Autostart → enable ${APP_NAME}. (Older Funtouch OS: i Manager → App manager → Autostart manager.)` },
      { id: 'background-power', instruction: `Settings → Battery → Background power consumption management → allow ${APP_NAME} to run in the background.` },
      { id: 'high-background', instruction: `Settings → Battery → High background power consumption → enable ${APP_NAME} if shown, and set its battery usage to "Not optimized".` },
    ],
  },
  huawei: {
    key: 'huawei',
    displayName: 'Huawei (EMUI)',
    steps: [
      { id: 'app-launch', instruction: `Settings → Battery → App launch → find ${APP_NAME} → turn OFF "Manage automatically" → enable all three toggles (Auto-launch, Secondary launch, Run in background).` },
      { id: 'ignore-optimization', instruction: `Settings → Battery → Battery optimization ("Ignore battery optimizations") → find ${APP_NAME} → set to "Don't optimize" / "Allow".` },
    ],
  },
  oneplus: {
    key: 'oneplus',
    displayName: 'OnePlus (OxygenOS)',
    steps: [
      { id: 'battery-optimization', instruction: `Settings → Battery → Battery optimization → switch to "All apps" → find ${APP_NAME} → "Don't optimize".` },
      { id: 'auto-launch-off', instruction: `If your phone has an "App Auto-Launch" toggle for ${APP_NAME}, make sure it's turned OFF — on some OnePlus phones this setting actually blocks background apps despite the name.` },
      { id: 'lock-recents', instruction: `Open Recent Apps, find ${APP_NAME}, and tap the lock icon if available — OnePlus phones can otherwise silently revert this setting on their own.` },
    ],
  },
  samsung: {
    key: 'samsung',
    displayName: 'Samsung (One UI)',
    // Sourced 2026-08-16 from dontkillmyapp.com's Samsung page. One UI's
    // exact menu path for the sleeping-apps list has moved across versions
    // (Android 9-10: Settings → Device care → Battery → ⋮ → Settings →
    // Sleeping apps; Android 11-13: Settings → Battery → Background usage
    // limits), and Android 14 dropped the explicit list in favor of the
    // "Good Guardians" app's Memory Guardian — Periyasamy's SM-E236B's
    // actual One UI version isn't confirmed from this machine (no device
    // access), so both menu paths are given rather than guessing one.
    // dontkillmyapp.com itself flags that Samsung can silently re-add an
    // app to these restricted lists after a firmware update, so this is
    // worth re-checking periodically, not just once.
    steps: [
      { id: 'sleeping-apps', instruction: `Settings → Battery → Background usage limits (older One UI: Settings → Device care → Battery → ⋮ menu → Settings → Sleeping apps) → remove ${APP_NAME} from "Sleeping apps" / "Deep sleeping apps", and turn OFF "Put unused apps to sleep" entirely — this is the step most likely to be the actual cause if tracking stops after running fine for a while.` },
      { id: 'battery-unrestricted', instruction: `Settings → Apps → ${APP_NAME} → Battery → set to "Unrestricted" (not "Optimized").` },
      { id: 'adaptive-battery-off', instruction: `If present on your One UI version: Settings → Battery → More battery settings → Adaptive battery → turn OFF.` },
      { id: 'lock-recents', instruction: `Open Recent Apps, find ${APP_NAME}, and tap the lock icon if available (or use the Good Guardians app's Memory Guardian → "Keep more apps in the background" on newer One UI) — Samsung can otherwise silently put this app back to sleep later, even after the steps above.` },
    ],
  },
};

// Raw expo-device `Device.manufacturer` values (lowercased) mapped to which
// checklist applies — Redmi/POCO devices can self-report as "Xiaomi",
// "Redmi", or "POCO" depending on device/region, all pointing at the same
// MIUI-family checklist.
//
// Deliberately does NOT include 'nothing'/'cmf' (CMF Phone 2 Pro, one of
// this project's real test devices, runs Nothing OS) — every checklist
// here is sourced from dontkillmyapp.com's own confirmed per-manufacturer
// page, and no equivalent confirmed page exists for Nothing OS. Real user
// reports do suggest it's not fully "stock Android reliable" either (see
// deviceInfo.ts's own KNOWN_PROBLEM_MANUFACTURERS comment) — that's
// exactly why it got added to the SOFTER, non-blocking tip list there
// instead of invented here with unconfirmed exact steps, which the header
// comment on this file calls out as actively unhelpful for a MANDATORY
// gate specifically.
const MANUFACTURER_TO_CHECKLIST_KEY: Record<string, string> = {
  oppo: 'oppo',
  realme: 'realme',
  xiaomi: 'xiaomi',
  redmi: 'xiaomi',
  poco: 'xiaomi',
  vivo: 'vivo',
  huawei: 'huawei',
  honor: 'huawei', // Honor devices ship the same EMUI-derived battery/app-launch settings.
  oneplus: 'oneplus',
  samsung: 'samsung',
};

export function isMandatoryChecklistManufacturer(manufacturer: string | null): boolean {
  if (!manufacturer) return false;
  return manufacturer.toLowerCase() in MANUFACTURER_TO_CHECKLIST_KEY;
}

export function getMandatoryChecklist(manufacturer: string | null): ManufacturerChecklist | null {
  if (!manufacturer) return null;
  const key = MANUFACTURER_TO_CHECKLIST_KEY[manufacturer.toLowerCase()];
  return key ? CHECKLISTS[key] : null;
}

export async function hasCompletedManufacturerChecklist(): Promise<boolean> {
  return (await AsyncStorage.getItem(MANUFACTURER_CHECKLIST_DONE_KEY)) === 'true';
}

// Marked complete locally AND synced to user_profiles (best-effort — a
// failed sync here shouldn't block the engineer from using the app, since
// the local flag is what actually prevents this gate from re-showing on
// this device). Per the spec's own re-verification requirement: almost
// every step above is an OEM custom toggle with no standard Android API to
// check programmatically (confirmed — this is a fully managed Expo project
// with no native module for PowerManager-style checks), so this column is
// explicitly a manual-confirmation record, not a verified-true state —
// paired with the already-recorded tracking_device_manufacturer so admin
// can see which manufacturer's checklist a given device went through.
export async function markManufacturerChecklistComplete(userId: string): Promise<void> {
  await AsyncStorage.setItem(MANUFACTURER_CHECKLIST_DONE_KEY, 'true');
  // Best-effort — see comment above. A failed sync here shouldn't block the
  // engineer from using the app; the local flag above is what actually
  // gates this screen from re-showing on this device. Supabase's client
  // resolves with an `error` field rather than throwing on an API-level
  // failure, so this is a plain no-op on error, not a caught exception.
  await supabase
    .from('user_profiles')
    .update({ manufacturer_checklist_completed_at: new Date().toISOString() })
    .eq('id', userId);
}
