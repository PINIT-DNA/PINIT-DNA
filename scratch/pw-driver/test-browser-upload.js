const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN = fs.readFileSync('C:\\PinIt\\scratch\\access-token.txt', 'utf8').trim();
const PDF_PATH = 'C:\\PinIt\\scratch\\test-doc-5page.pdf';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const networkLog = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/')) {
      networkLog.push({ type: 'request', url: req.url(), method: req.method(), time: Date.now() });
    }
  });
  page.on('response', (res) => {
    if (res.url().includes('/api/')) {
      networkLog.push({ type: 'response', url: res.url(), status: res.status(), time: Date.now() });
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('/api/')) {
      networkLog.push({ type: 'requestfailed', url: req.url(), method: req.method(), failure: req.failure()?.errorText, time: Date.now() });
    }
  });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push('PAGEERROR: ' + err.message);
  });

  console.log('Navigating to http://localhost:3002 ...');
  await page.goto('http://localhost:3002', { waitUntil: 'networkidle', timeout: 30000 });

  console.log('Injecting auth tokens into localStorage ...');
  await page.evaluate((token) => {
    localStorage.setItem('pinit_access_token', token);
    localStorage.setItem('pinit_refresh_token', 'dummy-not-needed-for-1h-access-token');
  }, ACCESS_TOKEN);

  console.log('Reloading with auth ...');
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: 'C:\\PinIt\\scratch\\pw-1-after-login.png' });

  console.log('Navigating to Protect file page ...');
  const protectNavLink = page.getByText('Protect file', { exact: true }).first();
  await protectNavLink.waitFor({ state: 'visible', timeout: 10000 });
  await protectNavLink.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:\\PinIt\\scratch\\pw-1b-protect-page.png' });

  console.log('Looking for file input ...');
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ state: 'attached', timeout: 10000 });
  await fileInput.setInputFiles(PDF_PATH);
  console.log('File set. Waiting for UI to reflect selection ...');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'C:\\PinIt\\scratch\\pw-2-file-selected.png' });

  console.log('Clicking "Protect This File" ...');
  const protectBtn = page.getByText('Protect This File', { exact: false });
  await protectBtn.waitFor({ state: 'visible', timeout: 10000 });
  await protectBtn.click();

  console.log('Waiting for outcome (up to 100s) ...');
  try {
    await page.waitForResponse((res) => res.url().includes('/dna/generate'), { timeout: 100000 });
  } catch (e) {
    console.log('No /dna/generate response observed within timeout:', e.message);
  }
  console.log('Waiting specifically for /vault/store response (up to 5 min) ...');
  const vaultStoreStart = Date.now();
  try {
    const vaultRes = await page.waitForResponse((res) => res.url().includes('/vault/store'), { timeout: 300000 });
    console.log(`/vault/store responded: status=${vaultRes.status()} after ${Date.now() - vaultStoreStart}ms`);
  } catch (e) {
    console.log(`/vault/store did NOT respond within 5 min (elapsed ${Date.now() - vaultStoreStart}ms):`, e.message);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:\\PinIt\\scratch\\pw-3-after-generate.png', fullPage: true });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'C:\\PinIt\\scratch\\pw-4-final-state.png', fullPage: true });

  const bodyText = await page.locator('body').innerText();
  console.log('=== PAGE TEXT SNIPPET ===');
  console.log(bodyText.slice(0, 1500));

  console.log('=== NETWORK LOG (api calls) ===');
  console.log(JSON.stringify(networkLog, null, 2));

  console.log('=== CONSOLE ERRORS ===');
  console.log(JSON.stringify(consoleErrors, null, 2));

  await browser.close();
})().catch((err) => {
  console.error('DRIVER FAILED', err);
  process.exit(1);
});
