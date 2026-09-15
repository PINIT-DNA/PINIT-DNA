const { chromium } = require('C:/PinIt/scratch/pw-driver/node_modules/playwright');
const fs = require('fs');

const token = fs.readFileSync('C:/PinIt/scratch/pw-driver/token.txt', 'utf-8').trim();
const BASE = 'http://localhost:3003';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(`${BASE}/access-denied`);
  await page.evaluate((t) => { localStorage.setItem('master_admin_access_token', t); }, token);

  page.on('request', (req) => {
    if (req.url().includes('/super-admin/notifications')) console.log('[request]', req.url());
  });
  page.on('response', (res) => {
    if (res.url().includes('/super-admin/notifications')) console.log('[response]', res.status(), res.url());
  });
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console:error]', msg.text()); });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
  await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
  console.log('initial rows:', await page.locator('tbody tr').count());

  const checkbox = page.locator('input[type="checkbox"]');
  await checkbox.click();
  console.log('checkbox checked now:', await checkbox.isChecked());

  await page.waitForResponse((res) => res.url().includes('/super-admin/notifications') && res.url().includes('unread=true'), { timeout: 10000 });
  await page.waitForTimeout(300);
  const filteredRows = await page.locator('tbody tr').count();
  console.log('filtered rows:', filteredRows);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-notifications-unread2.png', fullPage: true });

  await browser.close();
})();
