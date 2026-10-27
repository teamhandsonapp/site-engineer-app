#!/usr/bin/env node
// Tracking test report — reads the real data a test session produces and
// prints, per test account: device/build, ping count, every gap longer
// than the 5-min ping interval allows, how long it lasted, and what the
// database shows happening around the recovery (watchdog restart, app
// reopened, server silence episode).
//
//   npm run tracking-report -- --since "2026-09-28 10:00"          (IST)
//   npm run tracking-report -- --since "2026-09-28 10:00" --user kabilan
//
// Uses the service-role key from ../admin-web/.env.local (never shipped in
// the app). Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.join(here, '../../admin-web/.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const sinceIST = arg('since');
if (!sinceIST) { console.error('Usage: npm run tracking-report -- --since "YYYY-MM-DD HH:MM" [--user name]'); process.exit(1); }
const since = new Date(sinceIST.replace(' ', 'T') + ':00+05:30').toISOString();
const userFilter = arg('user')?.toLowerCase();

// A ping is expected every 5 min; allow slack for the OS batching fixes.
const GAP_MIN = 8;

async function get(table, query) {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}
const t = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const mins = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);

const profiles = await get('user_profiles', 'select=id,full_name,role&role=in.(site_engineer,senior_site_engineer)&deleted_at=is.null');
const targets = profiles.filter((p) => !userFilter || p.full_name.toLowerCase().includes(userFilter));

for (const p of targets) {
  const [pings, debug, silence, devices] = await Promise.all([
    get('location_pings', `select=occurred_at&user_id=eq.${p.id}&occurred_at=gte.${since}&order=occurred_at.asc&limit=5000`),
    get('tracking_debug_events', `select=event_type,created_at,detail&user_id=eq.${p.id}&created_at=gte.${since}&order=created_at.asc`).catch(() => []),
    get('location_disabled_alerts', `select=reason,disabled_at,enabled_at&user_id=eq.${p.id}&disabled_at=gte.${since}&order=disabled_at.asc`),
    get('user_devices', `select=platform,model,build_number,last_seen_at,last_login_at&user_id=eq.${p.id}&order=last_seen_at.desc`),
  ]);
  if (!pings.length && !silence.length) continue;

  const dev = devices[0];
  console.log(`\n=== ${p.full_name} — ${dev ? `${dev.platform} ${dev.model} (build ${dev.build_number ?? '?'})` : 'device unknown'} ===`);
  console.log(`Pings since ${sinceIST}: ${pings.length}${pings.length ? `  (first ${t(pings[0].occurred_at)}, last ${t(pings.at(-1).occurred_at)})` : ''}`);

  const rows = [];
  for (let i = 1; i < pings.length; i++) {
    const a = pings[i - 1].occurred_at, b = pings[i].occurred_at;
    const gap = mins(a, b);
    if (gap < GAP_MIN) continue;
    const within = (iso) => new Date(iso) > new Date(a) && new Date(iso) <= new Date(b).getTime() + 60000;
    const restart = debug.find((d) => d.event_type === 'watchdog_restart' && within(d.created_at));
    const episode = silence.find((s) => s.reason === 'no_heartbeat' && within(s.disabled_at));
    const reopened = devices.some((d) => d.last_login_at && within(d.last_login_at));
    const cause = restart ? `watchdog restart at ${t(restart.created_at)}` : reopened ? 'app reopened / login' : 'resumed on its own (PendingIntent / OS)';
    rows.push({ from: t(a), to: t(b), minutes: gap, recoveredBy: cause, serverFlagged: episode ? 'yes' : 'no' });
  }
  const openEnded = pings.length && mins(pings.at(-1).occurred_at, new Date().toISOString());
  if (rows.length) console.table(rows);
  else console.log('No gaps longer than', GAP_MIN, 'min between pings.');
  if (openEnded >= GAP_MIN) console.log(`⚠ No ping for the last ${openEnded} min — tracking currently NOT recovered.`);
  const restarts = debug.filter((d) => d.event_type === 'watchdog_restart').length;
  const checks = debug.filter((d) => d.event_type === 'watchdog_check').length;
  console.log(`Watchdog: ${checks} checks, ${restarts} restarts · Server silence episodes: ${silence.filter((s) => s.reason === 'no_heartbeat').length}`);
}
