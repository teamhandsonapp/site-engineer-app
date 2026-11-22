// Settings → Devices & Logins (2026-11-21, client): only phone app logins,
// and only who is signed in on each phone NOW — worked out from user_devices,
// because the app never records a sign-out:
//   1. Phones only (Android / iPhone app). Web sessions are never shown.
//   2. One account per phone install: an install (device_id) belongs to the
//      account that logged in on it last; earlier accounts there signed out.
//   3. A reinstall makes a new device_id. An install is replaced when a newer
//      install of the same phone (same maker + model) was used by the same
//      person — the old one is gone, so it isn't shown.
//   4. Phones not used for STALE_DAYS are left out (no longer in use).
//   5. One row per person: their most recently used phone.
export const STALE_DAYS = 30;

export interface PhoneRow {
  id: string;
  userId: string;
  deviceId: string;
  platform: string | null;
  manufacturer: string | null;
  model: string | null;
  firstSeenAt: Date;
  lastLoginAt: Date | null;
  lastSeenAt: Date;
}

const isPhone = (r: PhoneRow) => r.platform === 'android' || r.platform === 'ios';
const loginTime = (r: PhoneRow) => (r.lastLoginAt ?? r.firstSeenAt).getTime();
const phoneKey = (r: PhoneRow) => `${r.platform}|${(r.manufacturer ?? '').toLowerCase()}|${(r.model ?? '').toLowerCase()}`;

/** Each person's current phone (rule 1–5), most recently used first. `activeUserIds`: accounts still allowed to sign in. */
export function currentPhoneSessions<T extends PhoneRow>(rows: T[], now: number, activeUserIds?: ReadonlySet<string>): T[] {
  const phones = rows.filter(isPhone);

  // 2. Who is signed in on each install: the last login there.
  const ownerOf = new Map<string, T>();
  for (const r of phones) {
    const cur = ownerOf.get(r.deviceId);
    if (!cur || loginTime(r) > loginTime(cur) || (loginTime(r) === loginTime(cur) && r.lastSeenAt > cur.lastSeenAt)) ownerOf.set(r.deviceId, r);
  }

  // 3. Installs of the same phone, each with the people who used it.
  const installs = new Map<string, { key: string; users: Set<string>; firstSeen: number }>();
  for (const r of phones) {
    const i = installs.get(r.deviceId) ?? { key: phoneKey(r), users: new Set<string>(), firstSeen: Infinity };
    i.users.add(r.userId);
    i.firstSeen = Math.min(i.firstSeen, r.firstSeenAt.getTime());
    installs.set(r.deviceId, i);
  }
  const replaced = (deviceId: string) => {
    const me = installs.get(deviceId)!;
    for (const [id, other] of installs) {
      if (id === deviceId || other.key !== me.key || other.firstSeen <= me.firstSeen) continue;
      for (const u of other.users) if (me.users.has(u)) return true;
    }
    return false;
  };

  const staleBefore = now - STALE_DAYS * 86_400_000;
  const best = new Map<string, T>();
  for (const r of ownerOf.values()) {
    if (activeUserIds && !activeUserIds.has(r.userId)) continue;
    if (r.lastSeenAt.getTime() < staleBefore || replaced(r.deviceId)) continue;
    const cur = best.get(r.userId);
    if (!cur || r.lastSeenAt > cur.lastSeenAt) best.set(r.userId, r);
  }
  return [...best.values()].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}
