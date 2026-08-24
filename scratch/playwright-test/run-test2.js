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

  const fileInputCount = await page.locator('input[type=file]').count();
  console.log('file inputs found:', fileInputCount);

  await page.locator('input[type=file]').first().setInputFiles(`${IMG_DIR}/base.jpg`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'shot-04-after-upload.png', fullPage: true });
  console.log('URL after upload:', page.url());

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
