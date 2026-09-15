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

  await page.goto(`${BASE}/support`, { waitUntil: 'networkidle' });
  await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-support-list-final.png', fullPage: true });

  await page.locator('tbody tr').first().click();
  await page.locator('text=Resolution').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-support-detail-final.png', fullPage: true });
  console.log('errors:', errors.length ? errors.join(' | ') : 'none');

  await browser.close();
})();
