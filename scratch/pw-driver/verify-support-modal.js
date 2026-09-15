const { chromium } = require('C:/PinIt/scratch/pw-driver/node_modules/playwright');
const fs = require('fs');

const token = fs.readFileSync('C:/PinIt/scratch/pw-driver/token.txt', 'utf-8').trim();
const BASE = 'http://localhost:3003';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(`${BASE}/access-denied`);
  await page.evaluate((t) => { localStorage.setItem('master_admin_access_token', t); }, token);

  page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console:error]', msg.text()); });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  await page.goto(`${BASE}/support`, { waitUntil: 'networkidle' });
  await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('tbody tr').first().click();

  // Just poll the modal's text content directly instead of a specific locator.
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    const modalText = await page.locator('div.fixed').innerText();
    console.log(`--- tick ${i} ---`);
    console.log(modalText);
    if (modalText.includes('Fixed — link ACL')) {
      console.log('RESOLUTION NOTE FOUND');
      break;
    }
  }

  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-support-detail-poll.png', fullPage: true });
  await browser.close();
})();
