const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const htmlPath = 'file:///' + path.resolve(__dirname, 'pixel-doc.html').replace(/\\/g, '/');
  await page.goto(htmlPath, { waitUntil: 'networkidle' });
  const outPath = path.resolve(__dirname, '..', '..', 'docs', 'PINIT-DNA_Pixel_Level_Protection_Technical_Documentation.pdf');
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '22mm', bottom: '22mm', left: '18mm', right: '18mm' },
  });
  console.log('PDF written to', outPath);
  await browser.close();
})().catch((err) => {
  console.error('PDF RENDER FAILED', err);
  process.exit(1);
});
