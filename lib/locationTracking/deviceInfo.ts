import * as Device from 'expo-device';

// Point 6 of the geofencing rebuild spec — Build.MANUFACTURER/Build.MODEL,
// read once and reused everywhere a tracking-related event or status is
// logged/synced, rather than re-deriving per call site. Both are plain
// synchronous constants on native (null on web/unsupported devices) — no
// permission or async read involved.
export function getDeviceManufacturer(): string | null {
  return Device.manufacturer ?? null;
}

export function getDeviceModel(): string | null {
  return Device.modelName ?? null;
}

// There is no single OS API to detect whether a device's OEM layers its
// own aggressive battery/autostart management on top of stock Android — so
// this is a plain known-problem-manufacturer list (per the spec's own
// naming), sourced from dontkillmyapp.com's own running list of the worst
// offenders. Lowercased comparison: expo-device documents Android
// `manufacturer` values as inconsistently-cased across OEMs (its own
// example shows "xiaomi" lowercase, "Google" capitalized).
const KNOWN_PROBLEM_MANUFACTURERS = ['xiaomi', 'samsung', 'huawei', 'oneplus', 'oppo', 'vivo'];

export function isKnownProblemManufacturer(manufacturer: string | null): boolean {
  if (!manufacturer) return false;
  return KNOWN_PROBLEM_MANUFACTURERS.includes(manufacturer.toLowerCase());
}

// Short, settings-path-specific tips per manufacturer — full detail always
// lives at dontkillmyapp.com (see DONT_KILL_MY_APP_URL below), this is just
// enough to point someone at the right settings screen without leaving the
// app. Exact menu wording drifts across OS versions/regions, hence "similar
// to" phrasing rather than a literal step-by-step.
const MANUFACTURER_TIPS: Record<string, string> = {
  xiaomi:
    "MIUI: Settings → Apps → Manage apps → PMC Portal → turn on \"Autostart\", and set battery saver for this app to \"No restrictions\".",
  samsung:
    'Settings → Battery → Background usage limits → remove PMC Portal from "Sleeping apps" / "Deep sleeping apps", and turn off "Put unused apps to sleep" for it.',
  huawei:
    'Settings → Battery → App launch → find PMC Portal and switch it to "Manage manually", then enable all three toggles (auto-launch, secondary launch, run in background).',
  oneplus: 'Settings → Apps → App management → Autostart → turn on PMC Portal, and set its battery usage to unrestricted.',
  oppo: 'Settings → Battery → App battery management → find PMC Portal and set it to allow background activity / autostart.',
  vivo: 'Settings → Battery → Background power consumption management → allow PMC Portal to run in the background, and enable it under Autostart.',
};

export function getManufacturerTip(manufacturer: string | null): string | null {
  if (!manufacturer) return null;
  return MANUFACTURER_TIPS[manufacturer.toLowerCase()] ?? null;
}

// User-provided source for this whole list (point 6 of the geofencing
// rebuild spec names this site explicitly) — a "Learn more" link out to it
// rather than this app trying to keep a full copy in sync with a
// third-party site that tracks OS-version-specific changes over time.
export const DONT_KILL_MY_APP_URL = 'https://dontkillmyapp.com';
