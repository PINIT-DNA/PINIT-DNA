const { chromium } = require('C:/PinIt/scratch/pw-driver/node_modules/playwright');
const fs = require('fs');

const token = fs.readFileSync('C:/PinIt/scratch/pw-driver/token.txt', 'utf-8').trim();
const BASE = 'http://localhost:3003';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(`${BASE}/access-denied`);
  await page.evaluate((t) => { localStorage.setItem('master_admin_access_token', t); }, token);

  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

  await page.goto(`${BASE}/verification`, { waitUntil: 'networkidle' });
  await page.locator('text=Log Request').waitFor({ state: 'visible', timeout: 10000 });
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-verif-empty.png', fullPage: true });
  console.log('initial load errors:', errors.length ? errors.join(' | ') : 'none');

  // Create a real request for a real user.
  await page.click('button:has-text("Log Request")');
  const modal = page.locator('div.fixed');
  await modal.locator('input[placeholder="PINIT-XXXXXXXX"]').fill('PINIT-DSPUSQ76');
  await modal.locator('select').selectOption('IDENTITY');
  await modal.locator('input[placeholder*="Government ID"]').fill('Government ID (Aadhaar)');
  await modal.locator('textarea').fill('Received via email attachment during onboarding call.');
  errors.length = 0;
  await modal.locator('button:has-text("Log Request")').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-verif-created.png', fullPage: true });
  console.log('create errors:', errors.length ? errors.join(' | ') : 'none');
  console.log('page text sample:', (await page.locator('body').innerText()).slice(0, 600));

  const rowCount = await page.locator('tbody tr').count();
  if (rowCount > 0) {
    // Review it: approve.
    await page.locator('tbody tr').first().click();
    await modal.locator('text=Approve').waitFor({ state: 'visible', timeout: 10000 });
    await modal.locator('textarea').fill('Documents verified against government ID database — looks legitimate.');
    errors.length = 0;
    await modal.locator('button:has-text("Approve")').click();
    await page.locator('text=Request approved').waitFor({ state: 'visible', timeout: 10000 });
    await modal.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-verif-approved.png', fullPage: true });
    console.log('review errors:', errors.length ? errors.join(' | ') : 'none');
    console.log('APPROVED text present:', await page.locator('text=APPROVED').count());
  } else {
    console.log('no rows to review — create likely failed');
  }

  await browser.close();
})();
