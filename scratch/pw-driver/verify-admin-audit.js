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

  await page.goto(`${BASE}/audit`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Admin Actions")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-admin-actions.png', fullPage: true });

  const rowCount = await page.locator('tbody tr').count();
  console.log('admin actions rows:', rowCount, 'errors:', errors.length ? errors.join(' | ') : 'none');

  if (rowCount > 0) {
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-admin-actions-detail.png', fullPage: true });
  }

  await browser.close();
})();
