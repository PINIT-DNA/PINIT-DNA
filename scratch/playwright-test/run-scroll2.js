const { chromium } = require('playwright');
const fs = require('fs');

const { accessToken, refreshToken } = JSON.parse(fs.readFileSync('user-info.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  // Re-navigate won't have the report; instead reuse same flow quickly since dna/vault already exists,
  // just re-upload the same cropped file (fast path likely cached).
  const { croppedFile } = JSON.parse(fs.readFileSync('files-info.json', 'utf8'));
  await page.goto('http://localhost:3002/pinit-hub/investigation', { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('input[type=file]').first().setInputFiles(croppedFile);

  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(5000);
    const text = await page.textContent('body').catch(() => '');
    if (/What Changed vs Original/i.test(text)) { console.log('ready at', i*5, 's'); break; }
  }
  await page.waitForTimeout(2000);

  const el = page.locator('text=Tamper Analysis').first();
  await el.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shot-18-crop-detail.png', fullPage: false });

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
