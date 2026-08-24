const { chromium } = require('playwright');
const fs = require('fs');

const OUT_DIR = 'C:/PinIt/scratch/playwright-test';
const { accessToken, refreshToken, user } = JSON.parse(fs.readFileSync('user-info.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console error]', msg.text()); });

  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  await page.goto('http://localhost:3002/generate', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('Reloaded generate page, checking state...');

  // Wait for protection pipeline to finish (poll up to ~3 min)
  let finished = false;
  for (let i = 0; i < 90; i++) {
    const text = await page.textContent('body').catch(() => '');
    if (/Protected!|Ready\b.*Vault|View in Vault|Go to Vault|protection complete/i.test(text)) {
      finished = true;
      console.log('Protection complete at iteration', i);
      break;
    }
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: 'shot-07-protect-final.png', fullPage: true });
  console.log('finished=', finished, 'url=', page.url());

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
