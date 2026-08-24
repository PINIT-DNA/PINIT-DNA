const { chromium } = require('playwright');
const fs = require('fs');

const { accessToken, refreshToken } = JSON.parse(fs.readFileSync('user-info.json', 'utf8'));
const { croppedFile } = JSON.parse(fs.readFileSync('files-info.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console error]', msg.text()); });

  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  await page.goto('http://localhost:3002/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
  await page.click('text=Investigate');
  await page.waitForLoadState('networkidle');
  console.log('URL:', page.url());
  await page.screenshot({ path: 'shot-10-investigate-page.png', fullPage: true });

  const fileInputCount = await page.locator('input[type=file]').count();
  console.log('file inputs on investigate page:', fileInputCount);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
