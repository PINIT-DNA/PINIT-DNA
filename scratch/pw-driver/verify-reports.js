const { chromium } = require('C:/PinIt/scratch/pw-driver/node_modules/playwright');
const fs = require('fs');

const token = fs.readFileSync('C:/PinIt/scratch/pw-driver/token.txt', 'utf-8').trim();
const BASE = 'http://localhost:3003';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });

  await page.goto(`${BASE}/access-denied`);
  await page.evaluate((t) => { localStorage.setItem('master_admin_access_token', t); }, token);

  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  await page.locator('text=New Users').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-reports.png', fullPage: true });
  console.log('report load errors:', errors.length ? errors.join(' | ') : 'none');

  errors.length = 0;
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('button:has-text("CSV")'),
  ]);
  console.log('CSV download suggested filename:', csvDownload.suggestedFilename());

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('button:has-text("PDF")'),
  ]);
  console.log('PDF download suggested filename:', pdfDownload.suggestedFilename());
  console.log('export errors:', errors.length ? errors.join(' | ') : 'none');

  await csvDownload.saveAs('C:/PinIt/scratch/pw-driver/downloaded-report.csv');
  await pdfDownload.saveAs('C:/PinIt/scratch/pw-driver/downloaded-report.pdf');

  await browser.close();
})();
