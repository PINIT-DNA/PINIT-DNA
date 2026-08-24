const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const sharp = require('sharp');

const IMG_DIR = 'C:/PinIt/scratch/tamper-test-images';
const OUT_DIR = 'C:/PinIt/scratch/playwright-test';

async function makeUniqueBase() {
  const marker = Buffer.from(
    `<svg width="640" height="640"><circle cx="${5 + Math.floor(Math.random()*3)}" cy="5" r="2" fill="rgb(${Math.floor(Math.random()*255)},${Math.floor(Math.random()*255)},${Math.floor(Math.random()*255)})"/></svg>`
  );
  const out = `${OUT_DIR}/base-browser-test.jpg`;
  await sharp(`${IMG_DIR}/base.jpg`).composite([{ input: marker }]).jpeg({ quality: 92 }).toFile(out);
  return out;
}

(async () => {
  const authRes = await axios.post('http://localhost:4000/api/v1/auth/create', {});
  const { accessToken, refreshToken, user } = authRes.data.data;
  console.log('Created user:', user.shortId);
  fs.writeFileSync('user-info.json', JSON.stringify({ accessToken, refreshToken, user }, null, 2));

  const baseFile = await makeUniqueBase();
  console.log('Unique base image:', baseFile);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console error]', msg.text()); });
  page.on('pageerror', err => console.log('[page error]', err.message));

  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  await page.goto('http://localhost:3002/generate', { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('input[type=file]').first().setInputFiles(baseFile);
  await page.waitForTimeout(1500);
  await page.click('text=Protect This File');
  console.log('Clicked Protect This File, waiting for processing...');

  let done = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const text = await page.textContent('body').catch(() => '');
    if (/already exists under another/i.test(text)) {
      console.log('DUPLICATE ERROR still showing at iteration', i);
      break;
    }
    if (/Protected!|protection complete|successfully protected|View in Vault|Vault ID/i.test(text)) {
      console.log('Looks complete at iteration', i);
      done = true;
      break;
    }
  }
  await page.screenshot({ path: 'shot-06-protect-result.png', fullPage: true });
  console.log('Final URL:', page.url(), 'done=', done);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
