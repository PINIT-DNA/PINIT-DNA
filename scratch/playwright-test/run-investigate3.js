const { chromium } = require('playwright');
const fs = require('fs');

const { accessToken, refreshToken } = JSON.parse(fs.readFileSync('user-info.json', 'utf8'));
const { croppedFile } = JSON.parse(fs.readFileSync('files-info.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  await page.goto('http://localhost:3002/pinit-hub/investigation', { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('input[type=file]').first().setInputFiles(croppedFile);
  console.log('Uploaded, waiting for report (staying on same page instance)...');

  let sawReport = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(5000);
    const text = await page.textContent('body').catch(() => '');
    if (/Ownership Verified|No Signature|Possible Similarity/i.test(text)) {
      sawReport = true;
      console.log(`Report visible at ${i * 5}s`);
      break;
    }
  }
  await page.waitForTimeout(3000);
  console.log('sawReport=', sawReport);

  // Scroll down section by section looking for the Tamper Analysis card
  let found = false;
  for (let scrollStep = 0; scrollStep < 15; scrollStep++) {
    const text = await page.textContent('body').catch(() => '');
    if (/What Changed vs Original|Tamper Analysis/i.test(text)) {
      found = true;
      console.log('Found Tamper Analysis text at scroll step', scrollStep);
      break;
    }
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(400);
  }
  console.log('found tamper section text=', found);
  await page.screenshot({ path: 'shot-14-tamper-scrolled.png', fullPage: false });
  await page.screenshot({ path: 'shot-15-full-final.png', fullPage: true });

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
