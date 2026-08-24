const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1273 } });
  const htmlPath = 'file:///' + path.resolve(__dirname, 'pixel-doc.html').replace(/\\/g, '/');
  await page.goto(htmlPath, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.resolve(__dirname, '..', 'doc-preview-full.png'), fullPage: true });
  console.log('screenshot saved');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
