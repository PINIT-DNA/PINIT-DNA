const { chromium } = require('C:/PinIt/scratch/pw-driver/node_modules/playwright');
const fs = require('fs');

const token = fs.readFileSync('C:/PinIt/scratch/pw-driver/token.txt', 'utf-8').trim();
const BASE = 'http://localhost:3003';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(`${BASE}/access-denied`);
  await page.evaluate((t) => { localStorage.setItem('master_admin_access_token', t); }, token);

  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

  // Load command center, then click the bell to prove the real click path works.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('button[title*="notifications" i], button[title="Notifications"]');
  await page.waitForURL('**/notifications');
  await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-notifications.png', fullPage: true });

  const rowCount = await page.locator('tbody tr').count();
  console.log('landed on:', page.url(), 'rows:', rowCount, 'errors:', errors.length ? errors.join(' | ') : 'none');

  // Exercise the unread-only filter too.
  errors.length = 0;
  await page.click('text=Unread only');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-notifications-unread.png', fullPage: true });
  console.log('unread filter errors:', errors.length ? errors.join(' | ') : 'none');

  await browser.close();
})();
