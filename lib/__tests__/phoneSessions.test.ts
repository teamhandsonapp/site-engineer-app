import { currentPhoneSessions, type PhoneRow } from '../phoneSessions';

// The live rows behind the 2026-11-21 report: one Nothing A001, signed in as
// Chandraprakash (16 Nov), then as Kabilan (21 Nov 3:48 PM); an older install of
// the same phone; a Xiaomi last used in October; a web session.
const row = (id: string, userId: string, deviceId: string, platform: string, model: string, first: string, login: string | null, seen: string, manufacturer = 'Nothing'): PhoneRow => ({
  id,
  userId,
  deviceId,
  platform,
  manufacturer,
  model,
  firstSeenAt: new Date(first),
  lastLoginAt: login ? new Date(login) : null,
  lastSeenAt: new Date(seen),
});
const CP = 'chandraprakash';
const KB = 'kabilan';
const rows = [
  row('1', CP, 'xiaomi', 'android', '23124RN87I', '2026-10-07T06:04Z', '2026-10-07T06:04Z', '2026-10-09T11:09Z', 'Xiaomi'),
  row('2', CP, 'old-install', 'android', 'A001', '2026-10-22T09:09Z', '2026-11-04T11:16Z', '2026-11-04T11:17Z'),
  row('3', KB, 'old-install', 'android', 'A001', '2026-09-27T14:06Z', '2026-09-28T15:13Z', '2026-09-28T15:18Z'),
  row('4', KB, 'phone', 'android', 'A001', '2026-11-05T12:35Z', '2026-11-21T10:18Z', '2026-11-21T10:23Z'),
  row('5', CP, 'phone', 'android', 'A001', '2026-11-13T13:27Z', '2026-11-16T05:50Z', '2026-11-21T10:12Z'),
  row('6', CP, 'browser', 'web', 'Unknown', '2026-11-14T07:13Z', '2026-11-20T13:01Z', '2026-11-21T10:24Z'),
];
const now = Date.parse('2026-11-21T10:24Z');

describe('Devices & Logins: who is signed in on a phone now', () => {
  it('only Kabilan — Chandraprakash was signed out of that phone when Kabilan logged in; no web', () => {
    const out = currentPhoneSessions(rows, now);
    expect(out.map((r) => `${r.userId}:${r.deviceId}`)).toEqual([`${KB}:phone`]);
  });

  it('an older install of the same phone is not shown', () => {
    // Before the newer install existed, the old install was Chandraprakash's current phone…
    const before = currentPhoneSessions(rows.filter((r) => r.deviceId !== 'phone'), Date.parse('2026-11-05T00:00Z'));
    expect(before.map((r) => `${r.userId}:${r.deviceId}`)).toEqual([`${CP}:old-install`]);
    // …once the phone was reinstalled, the old install is gone, even for him.
    const after = currentPhoneSessions(rows.filter((r) => r.id !== '4' && r.id !== '6'), Date.parse('2026-11-21T10:24Z'));
    expect(after.map((r) => `${r.userId}:${r.deviceId}`)).toEqual([`${CP}:phone`]);
  });

  it('phones unused for 30+ days are left out', () => {
    const out = currentPhoneSessions([rows[0]], now);
    expect(out).toEqual([]);
  });

  it('removed accounts are not listed', () => {
    const out = currentPhoneSessions(rows, now, new Set([CP]));
    expect(out).toEqual([]);
  });
});
