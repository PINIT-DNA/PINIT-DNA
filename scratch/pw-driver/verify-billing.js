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

  await page.goto(`${BASE}/billing`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-billing.png', fullPage: true });
  console.log('subscriptions tab errors:', errors.length ? errors.join(' | ') : 'none');

  errors.length = 0;
  await page.click('button:has-text("Billing History")');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-billing-history.png', fullPage: true });
  console.log('history tab errors:', errors.length ? errors.join(' | ') : 'none');

  await browser.close();
})();
