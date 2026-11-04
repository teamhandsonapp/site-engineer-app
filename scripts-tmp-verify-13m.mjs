import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const email = `verify-13m-${randomUUID().slice(0, 8)}@example.invalid`;
const password = `Tmp-${randomUUID()}`;
let authUserId = null;

async function main() {
  const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  authUserId = created.user.id;
  await admin.from('user_profiles').insert({
    id: authUserId, email, full_name: 'Verify 13m Temp', role: 'site_engineer', status: 'active', is_active: true, updated_at: new Date().toISOString(),
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 1000 } });

  await page.goto('http://localhost:8081/login', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('name@company.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByText('Log In', { exact: true }).click();
  await page.waitForTimeout(2500);

  await page.getByText('Your Projects', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByText('ROAST @ Kokapet').first().click();
  await page.waitForTimeout(2000);

  await page.locator('button[aria-label*="menu" i]').first().click();
  await page.waitForTimeout(500);
  await page.getByText('DPR', { exact: true }).click();
  await page.waitForTimeout(1500);

  await page.getByText('New DPR', { exact: true }).click();
  await page.waitForTimeout(2000);

  await page.getByText(/13m/).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'verify-13m.png', fullPage: true });

  console.log('SCREENSHOT_OK');
  await browser.close();
}

main()
  .catch((err) => console.error('SCRIPT_FAILED', err))
  .finally(async () => {
    try { if (authUserId) await admin.from('user_profiles').delete().eq('id', authUserId); } catch {}
    try { if (authUserId) await admin.auth.admin.deleteUser(authUserId); } catch {}
    console.log('CLEANUP_DONE');
  });
