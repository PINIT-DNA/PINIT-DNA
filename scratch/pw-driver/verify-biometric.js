const { chromium } = require('C:/PinIt/scratch/pw-driver/node_modules/playwright');
const fs = require('fs');

const token = fs.readFileSync('C:/PinIt/scratch/pw-driver/token.txt', 'utf-8').trim();
const BASE = 'http://localhost:3003';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${BASE}/access-denied`);
  await page.evaluate((t) => { localStorage.setItem('master_admin_access_token', t); }, token);

  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

  await page.goto(`${BASE}/verification`, { waitUntil: 'networkidle' });
  await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-biometric.png', fullPage: true });
  console.log('rows:', await page.locator('tbody tr').count(), 'errors:', errors.length ? errors.join(' | ') : 'none');

  // Confirm no templateCipher/templateHash ever crossed the wire.
  const resp = await page.request.get('http://localhost:4000/api/v1/super-admin/biometric-identities', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await resp.text();
  console.log('leaks templateCipher:', body.includes('templateCipher'), 'leaks templateHash:', body.includes('templateHash'));

  await browser.close();
})();
