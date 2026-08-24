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

  await page.goto('http://localhost:3002/pinit-hub/investigation', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Find the Tamper Analysis heading and scroll to it
  const tamperHeading = page.locator('text=Tamper Analysis').first();
  const count = await tamperHeading.count();
  console.log('Tamper Analysis heading found:', count);
  if (count > 0) {
    await tamperHeading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: 'shot-12-tamper-section.png', fullPage: false });

  // Also grab a full-page screenshot for completeness
  await page.screenshot({ path: 'shot-13-full-report.png', fullPage: true });

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
