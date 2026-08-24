const { chromium } = require('playwright');
const fs = require('fs');

const { accessToken, refreshToken } = JSON.parse(fs.readFileSync('user-info.json', 'utf8'));
const { croppedFile } = JSON.parse(fs.readFileSync('files-info.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console error]', msg.text()); });
  page.on('pageerror', err => console.log('[page error]', err.message));

  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  await page.goto('http://localhost:3002/pinit-hub/investigation', { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('input[type=file]').first().setInputFiles(croppedFile);
  console.log('Uploaded cropped file, waiting for investigation to run (this takes 3-5 min)...');

  let lastText = '';
  let sawReport = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(5000);
    const text = await page.textContent('body').catch(() => '');
    const snippet = text.replace(/\s+/g, ' ').slice(0, 150);
    if (snippet !== lastText.slice(0, 150)) {
      console.log(`[${i * 5}s]`, snippet);
      lastText = text;
    }
    if (/Tamper Analysis|Investigation Summary|Ownership Verified|No Signature|Possible Similarity/i.test(text)) {
      sawReport = true;
      console.log(`=== Report visible at ${i * 5}s ===`);
      break;
    }
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'shot-11-investigate-report.png', fullPage: true });
  console.log('sawReport=', sawReport, 'url=', page.url());

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
