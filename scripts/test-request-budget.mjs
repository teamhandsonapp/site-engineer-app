// Request-budget test: proves screens make a bounded number of Supabase
// requests and then STOP fetching (no refetch loop).
//
// Regression guard for the useLatestRequest loop (Nov 2026): a new
// `{ begin }` object every render made `load` change every render, so
// Engineer Attendance, Completed Tasks, Documents and the engineer detail
// screen refetched forever (~25 requests/s).
//
// Runs against the Expo web dev build with a real account (live data,
// read-only: it only opens screens, never taps an action).
//
//   npx expo start --web --port 8081          # in another terminal
//   E2E_EMAIL=... E2E_PASSWORD=... npm run test:requests
//
// The account must be a manager or admin (Engineer Attendance is
// admin/manager only). Credentials come from the environment and are never
// printed. Optional: E2E_BASE_URL (default http://localhost:8081),
// E2E_PROJECT (default "ROAST @ Kokapet"), E2E_DETAIL_USER_ID (default: the
// first site engineer the account can see), E2E_CHROME (Chrome binary path;
// default: the installed Chrome channel).

import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:8081';
const PROJECT = process.env.E2E_PROJECT || 'ROAST @ Kokapet';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

// Budget per screen, counted over WINDOW_MS after opening it. Includes the
// signed-in layout's own requests (profile, bell, projects, badge), which
// this test's in-app navigation re-triggers. A healthy screen settles well
// under the cap; the loop made several hundred.
const WINDOW_MS = 14_000;
const QUIET_FROM_MS = 8_000; // after this point the screen must be silent
const MAX_REQUESTS = 120;
// Background pollers that may legitimately fire at any moment; they are not
// the screen's own data loading.
const POLLERS = [/\/rest\/v1\/critical_alert_messages/, /\/rest\/v1\/user_devices/, /select=force_logout_at/, /\/rest\/v1\/rpc\/get_group_chats/];

if (!EMAIL || !PASSWORD) {
  console.error('Set E2E_EMAIL and E2E_PASSWORD (a manager or admin account).');
  process.exit(2);
}

function readEnvFile(path) {
  if (!fs.existsSync(path)) return {};
  return Object.fromEntries(
    fs.readFileSync(path, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')])
  );
}

async function detailUserId() {
  if (process.env.E2E_DETAIL_USER_ID) return process.env.E2E_DETAIL_USER_ID;
  const env = { ...readEnvFile('.env'), ...readEnvFile('.env.local'), ...process.env };
  const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: authError } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (authError) throw new Error(`sign-in for lookup failed: ${authError.message}`);
  const { data, error } = await sb.from('user_profiles').select('id').eq('role', 'site_engineer').is('deleted_at', null).limit(1);
  await sb.auth.signOut();
  if (error || !data?.length) throw new Error('no site engineer visible to look up; set E2E_DETAIL_USER_ID');
  return data[0].id;
}

const userId = await detailUserId();
const SCREENS = [
  ['Site Engineer Attendance', '/engineer-attendance'],
  ['Completed Tasks', '/completed-tasks'],
  ['Documents', '/documents'],
  ['Engineer attendance detail', `/team-attendance-detail/${userId}`],
];

const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : { channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();

let log = [];
const pending = new Set();
const isApi = (u) => u.includes('.supabase.co/') && !u.includes('/realtime/');
page.on('request', (r) => {
  if (!isApi(r.url())) return;
  pending.add(r);
  log.push({ at: Date.now(), url: r.url(), method: r.method() });
});
page.on('requestfinished', (r) => pending.delete(r));
page.on('requestfailed', (r) => pending.delete(r));

async function settle(quietMs = 2000, maxMs = 30_000) {
  const t0 = Date.now();
  let last = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (pending.size) last = Date.now();
    else if (Date.now() - last > quietMs) return;
    await page.waitForTimeout(100);
  }
}
const nav = (p) =>
  page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, p);

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
await page.getByPlaceholder('name@company.com').waitFor({ timeout: 240_000 });
await page.getByPlaceholder('name@company.com').fill(EMAIL);
await page.getByPlaceholder('Enter your password').fill(PASSWORD);
await page.getByText('Log in', { exact: true }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
await settle(3000);
// Pick the project once (in memory), through a gated screen.
await nav('/completed-tasks');
await settle(2500);
if (await page.getByText('Select a Project').count()) {
  await page.getByText(PROJECT, { exact: true }).first().click();
  await settle(2500);
}

let failed = 0;
for (const [name, path] of SCREENS) {
  await nav('/settings');
  await settle(2500);
  log = [];
  const t0 = Date.now();
  await nav(path);
  await page.waitForTimeout(WINDOW_MS);
  const own = log.filter((e) => !POLLERS.some((re) => re.test(e.url)));
  const late = own.filter((e) => e.at - t0 >= QUIET_FROM_MS);
  const ok = log.length <= MAX_REQUESTS && late.length === 0;
  if (!ok) failed++;
  const top = Object.entries(own.reduce((m, e) => ((m[new URL(e.url).pathname.replace('/rest/v1/', '')] = (m[new URL(e.url).pathname.replace('/rest/v1/', '')] || 0) + 1), m), {}))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([p, n]) => `${p}×${n}`)
    .join(', ');
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${String(log.length).padStart(4)} requests in ${WINDOW_MS / 1000}s (cap ${MAX_REQUESTS}), ` +
      `${late.length} after ${QUIET_FROM_MS / 1000}s (must be 0)  [${top}]`
  );
}

await browser.close();
if (failed) {
  console.error(`\n${failed} screen(s) over budget or still fetching.`);
  process.exit(1);
}
console.log('\nAll screens settled within budget.');
