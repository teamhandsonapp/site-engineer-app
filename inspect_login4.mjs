import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8081/login', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/login-direct.png', fullPage: true });
const html = await page.content();
console.log(html.includes('name@company.com') ? 'FOUND email placeholder' : 'no email placeholder found');
console.log(html.includes('Log In') ? 'FOUND Log In text' : 'no Log In text found');
await browser.close();
