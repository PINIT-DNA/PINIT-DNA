const { chromium } = require('playwright');
const fs = require('fs');

const { accessToken, refreshToken } = JSON.parse(fs.readFileSync('user-info.json', 'utf8'));
const { splicedFile } = JSON.parse(fs.readFileSync('splice-info.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  await page.goto('http://localhost:3002/pinit-hub/investigation', { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('input[type=file]').first().setInputFiles(splicedFile);
  console.log('Uploaded, waiting for Unknown Asset summary...');

  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(3000);
    const text = await page.textContent('body').catch(() => '');
    if (/Unknown Asset/i.test(text)) { console.log(`Unknown Asset summary visible at ${i*3}s`); break; }
  }
  // Give the SSE stream extra time to deliver the tamper/fragment sections after the summary appears
  console.log('Waiting extra 90s for tamper/fragment sections to stream in...');
  await page.waitForTimeout(90000);

  await page.screenshot({ path: 'shot-23-splice-final.png', fullPage: true });

  const fragCard = page.locator('text=Fragment reuse detected').first();
  console.log('Fragment reuse card found:', await fragCard.count());
  if (await fragCard.count() > 0) {
    await fragCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'shot-24-fragment-card.png', fullPage: false });
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
