import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'http://localhost:8081';
const admin = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TEST_EMAIL = `__verify_flowfix_${Date.now()}@example.invalid`;
const TEST_PASSWORD = 'verify-flowfix-12345!';

async function main() {
  let authUserId = null;
  let browser = null;
  try {
    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({ email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true });
    if (userErr) throw userErr;
    authUserId = userRes.user.id;
    await admin.from('user_profiles').insert({
      id: authUserId, email: TEST_EMAIL, full_name: 'Verify Flow Fix', role: 'admin', status: 'active', is_active: true, updated_at: new Date().toISOString(),
    });

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 500, height: 1000 } });
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);
    await page.getByPlaceholder('name@company.com').fill(TEST_EMAIL);
    await page.getByPlaceholder('••••••••').fill(TEST_PASSWORD);
    await page.getByText('Log in', { exact: true }).click();
    await page.getByText('Overview').waitFor({ timeout: 20000 });
    await page.getByText(/^\d+%$/).first().click();
    await page.getByText('Overall Progress').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await page.locator('div.text-neutral-800', { hasText: /^Flowchart$/ }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: '/tmp/flowfix_top.png' });

    // Element screenshot instead of a page-clip — handles the canvas's own
    // pan/zoom transform correctly regardless of the (transformed) DOM
    // bounding box's raw numbers.
    const box1b = await page.getByText('Form Fixing', { exact: true }).first().boundingBox();
    if (box1b) {
      await page.screenshot({
        path: '/tmp/flowfix_fsbadge_zoom.png',
        clip: { x: box1b.x - 30, y: box1b.y - 10, width: 220, height: 130 },
      });
    }

    // Pan down to the 2a-2j / 3a-3g region (the one from the user's own
    // screenshot) to check column alignment across a much longer run.
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(250, 700);
      await page.mouse.down();
      await page.mouse.move(250, 200, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: '/tmp/flowfix_scrolled.png' });
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (authUserId) {
      await admin.from('user_profiles').delete().eq('id', authUserId);
      await admin.auth.admin.deleteUser(authUserId);
    }
    console.log('Cleaned up.');
  }
}
main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
