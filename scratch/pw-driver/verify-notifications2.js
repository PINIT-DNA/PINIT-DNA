const { chromium } = require('C:/PinIt/scratch/pw-driver/node_modules/playwright');
const fs = require('fs');

const token = fs.readFileSync('C:/PinIt/scratch/pw-driver/token.txt', 'utf-8').trim();
const BASE = 'http://localhost:3003';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(`${BASE}/access-denied`);
  await page.evaluate((t) => { localStorage.setItem('master_admin_access_token', t); }, token);

  page.on('console', (msg) => console.log(`[console:${msg.type()}]`, msg.text()));
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure()?.errorText));
  page.on('response', (res) => {
    if (res.url().includes('/notifications')) {
      console.log('[response]', res.status(), res.url());
    }
  });

  await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-notifications2.png', fullPage: true });
  const rowCount = await page.locator('tbody tr').count();
  console.log('rows:', rowCount);

  await browser.close();
})();
