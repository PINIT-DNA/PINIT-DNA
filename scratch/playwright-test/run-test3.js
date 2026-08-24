const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

const IMG_DIR = 'C:/PinIt/scratch/tamper-test-images';

(async () => {
  const authRes = await axios.post('http://localhost:4000/api/v1/auth/create', {});
  const { accessToken, refreshToken, user } = authRes.data.data;
  console.log('Created user:', user.shortId);
  fs.writeFileSync('user-info.json', JSON.stringify({ accessToken, refreshToken, user }, null, 2));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console error]', msg.text()); });
  page.on('pageerror', err => console.log('[page error]', err.message));

  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  await page.goto('http://localhost:3002/generate', { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('input[type=file]').first().setInputFiles(`${IMG_DIR}/base.jpg`);
  await page.waitForTimeout(1500);

  await page.click('text=Protect This File');
  console.log('Clicked Protect This File, waiting for processing...');

  // Poll for completion — DNA gen + vault store, watch for navigation or success text
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const url = page.url();
    const text = await page.textContent('body').catch(() => '');
    if (/protected|success|vault|certificate/i.test(text) && !/not protected yet/i.test(text)) {
      console.log(`[${i}] url=${url}`);
    }
    if (url.includes('/vault') || url.includes('/protected') || /Protected!|Successfully/i.test(text)) {
      console.log('Looks complete at iteration', i, url);
      break;
    }
  }
  await page.screenshot({ path: 'shot-05-after-protect.png', fullPage: true });
  console.log('Final URL:', page.url());

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
