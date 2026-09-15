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

  // 1. Credits & Usage
  await page.goto(`${BASE}/credits`, { waitUntil: 'networkidle' });
  await page.locator('text=Total Storage Used').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-credits.png', fullPage: true });
  console.log('credits errors:', errors.length ? errors.join(' | ') : 'none');

  // 2. Network Intelligence
  errors.length = 0;
  await page.goto(`${BASE}/network`, { waitUntil: 'networkidle' });
  await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-network.png', fullPage: true });
  console.log('network errors:', errors.length ? errors.join(' | ') : 'none', 'rows:', await page.locator('tbody tr').count());

  // 3. Support & Disputes — full workflow: create, reply, resolve
  errors.length = 0;
  await page.goto(`${BASE}/support`, { waitUntil: 'networkidle' });
  await page.locator('text=Open Ticket').waitFor({ state: 'visible', timeout: 10000 });
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-support-empty.png', fullPage: true });
  console.log('support load errors:', errors.length ? errors.join(' | ') : 'none');

  await page.click('button:has-text("Open Ticket")');
  const modal = page.locator('div.fixed');
  await modal.locator('input[placeholder="PINIT-XXXXXXXX"]').fill('PINIT-DSPUSQ76');
  await modal.locator('input[placeholder="Short summary"]').fill('Cannot access shared vault link');
  await modal.locator('select').nth(0).selectOption('DISPUTE');
  await modal.locator('select').nth(1).selectOption('HIGH');
  await modal.locator('textarea').fill('User reports the share link returns a 403 despite being active. Reported via email.');
  errors.length = 0;
  await modal.locator('button:has-text("Open Ticket")').click();
  await page.locator('text=Ticket opened').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-support-created.png', fullPage: true });
  console.log('create errors:', errors.length ? errors.join(' | ') : 'none');

  // Open the ticket, reply, then resolve
  await page.locator('tbody tr').first().click();
  await page.locator('text=Thread (0)').waitFor({ state: 'visible', timeout: 10000 });
  const detailModal = page.locator('div.fixed');
  await detailModal.locator('textarea').first().fill('Investigating — checking share link ACL now.');
  errors.length = 0;
  await detailModal.locator('button:has-text("Send")').click();
  await page.locator('text=Message added').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-support-replied.png', fullPage: true });
  console.log('reply errors:', errors.length ? errors.join(' | ') : 'none');

  await detailModal.locator('input[placeholder="Resolution note (optional)"]').fill('Fixed — link ACL had expired; regenerated and confirmed working.');
  errors.length = 0;
  await detailModal.locator('button:has-text("Resolve")').click();
  await page.locator('text=Ticket resolved').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/PinIt/scratch/pw-driver/shot-support-resolved.png', fullPage: true });
  console.log('resolve errors:', errors.length ? errors.join(' | ') : 'none');

  await browser.close();
})();
