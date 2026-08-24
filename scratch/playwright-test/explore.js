const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3002', { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: 'shot-01-landing.png', fullPage: true });
  console.log('URL:', page.url());
  console.log('Title:', await page.title());
  const bodyText = await page.textContent('body');
  console.log('Body text (first 800 chars):', bodyText.slice(0, 800));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
