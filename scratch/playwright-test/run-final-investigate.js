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
  console.log('Uploaded, waiting for FULL pipeline completion + tamper section...');

  let ready = false;
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(5000);
    const text = await page.textContent('body').catch(() => '');
    const pipelineMatch = text.match(/INVESTIGATION PIPELINE\s*—\s*(\d+)\/(\d+) COMPLETE/i);
    const pct = pipelineMatch ? `${pipelineMatch[1]}/${pipelineMatch[2]}` : '?';
    const hasTamperSection = /What Changed vs Original/i.test(text);
    if (i % 3 === 0) console.log(`[${i*5}s] pipeline=${pct} tamperSectionVisible=${hasTamperSection}`);
    if (hasTamperSection) {
      ready = true;
      console.log(`=== Tamper section visible at ${i * 5}s, pipeline=${pct} ===`);
      break;
    }
  }
  await page.waitForTimeout(2000);
  console.log('ready=', ready);

  // Scroll to the Tamper Analysis section specifically
  const el = page.locator('text=What Changed vs Original').first();
  if (await el.count() > 0) {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: 'shot-16-tamper-final.png', fullPage: false });
  await page.screenshot({ path: 'shot-17-full-page-final.png', fullPage: true });
  console.log('Screenshots saved.');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
