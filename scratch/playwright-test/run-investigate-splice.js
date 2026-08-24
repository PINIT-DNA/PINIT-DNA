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
  console.log('Uploaded spliced file, waiting for report...');

  let ready = false;
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(5000);
    const text = await page.textContent('body').catch(() => '');
    if (i % 4 === 0) {
      const pipelineMatch = text.match(/INVESTIGATION PIPELINE\s*—\s*(\d+)\/(\d+) COMPLETE/i);
      console.log(`[${i*5}s] pipeline=${pipelineMatch ? pipelineMatch[0] : '?'}`);
    }
    if (/What Changed vs Original|No Signature|Possible Similarity|Fragment reuse/i.test(text)) {
      ready = true;
      console.log(`=== ready at ${i * 5}s ===`);
      break;
    }
  }
  await page.waitForTimeout(3000);
  console.log('ready=', ready);
  await page.screenshot({ path: 'shot-19-splice-top.png', fullPage: true });

  const fragCard = page.locator('text=Fragment reuse detected').first();
  const fragCount = await fragCard.count();
  console.log('Fragment reuse card found:', fragCount);
  if (fragCount > 0) {
    await fragCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'shot-20-fragment-card.png', fullPage: false });
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
