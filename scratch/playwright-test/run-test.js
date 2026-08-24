const { chromium } = require('playwright');
const axios = require('axios');

const IMG_DIR = 'C:\PinIt\scratch\tamper-test-images';

(async () => {
  const authRes = await axios.post('http://localhost:4000/api/v1/auth/create', {});
  const { accessToken, refreshToken, user } = authRes.data.data;
  console.log('Created user:', user.shortId);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console error]', msg.text()); });

  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  await page.goto('http://localhost:3002/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
  await page.click('text=Protect file');
  await page.waitForLoadState('networkidle');
  console.log('URL after clicking Protect file:', page.url());
  await page.screenshot({ path: 'shot-03-protect-page.png', fullPage: true });

  fs = require('fs');
  fs.writeFileSync('user-info.json', JSON.stringify({ accessToken, refreshToken, user }, null, 2));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
