const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const sharp = require('sharp');

const IMG_DIR = 'C:/PinIt/scratch/tamper-test-images';
const OUT_DIR = 'C:/PinIt/scratch/playwright-test';

async function makeDistinctBase() {
  const out = `${OUT_DIR}/browser-demo-base2.jpg`;
  await sharp(`${IMG_DIR}/base.jpg`)
    .modulate({ hue: 250, saturation: 1.7, brightness: 0.95 })
    .jpeg({ quality: 92 })
    .toFile(out);
  return out;
}

async function makeCroppedVariant(baseFile) {
  const meta = await sharp(baseFile).metadata();
  const cropW = Math.round(meta.width * 0.7), cropH = Math.round(meta.height * 0.7);
  const left = Math.round((meta.width - cropW) / 2), top = Math.round((meta.height - cropH) / 2);
  const out = `${OUT_DIR}/browser-demo-cropped2.jpg`;
  await sharp(baseFile).extract({ left, top, width: cropW, height: cropH }).jpeg({ quality: 92 }).toFile(out);
  return out;
}

(async () => {
  const authRes = await axios.post('http://localhost:4000/api/v1/auth/create', {});
  const { accessToken, refreshToken, user } = authRes.data.data;
  console.log('Created user:', user.shortId);
  fs.writeFileSync('user-info.json', JSON.stringify({ accessToken, refreshToken, user }, null, 2));

  const baseFile = await makeDistinctBase();
  const croppedFile = await makeCroppedVariant(baseFile);
  console.log('Base:', baseFile, '| Cropped:', croppedFile);
  fs.writeFileSync('files-info.json', JSON.stringify({ baseFile, croppedFile }, null, 2));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console error]', msg.text()); });

  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  await page.goto('http://localhost:3002/generate', { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('input[type=file]').first().setInputFiles(baseFile);
  await page.waitForTimeout(1500);
  await page.click('text=Protect This File');
  console.log('Clicked Protect This File, waiting on same page (no reload)...');

  let finished = false;
  let lastText = '';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(3000);
    const text = await page.textContent('body').catch(() => '');
    if (text !== lastText) {
      const snippet = text.replace(/\s+/g, ' ').slice(0, 200);
      console.log(`[${i * 3}s]`, snippet);
      lastText = text;
    }
    if (/already exists under another/i.test(text)) { console.log('DUPLICATE, aborting'); break; }
    if (/1 of 5 protected|View in Vault|Protected!|Go to Vault|protection complete|Investigate this file/i.test(text)) {
      finished = true;
      console.log('=== Protection complete at', i * 3, 's ===');
      break;
    }
  }
  await page.screenshot({ path: 'shot-08-protect-complete.png', fullPage: true });
  console.log('finished=', finished, 'url=', page.url());

  if (finished) {
    await page.goto('http://localhost:3002/dashboard', { waitUntil: 'networkidle', timeout: 20000 });
    await page.screenshot({ path: 'shot-09-dashboard-after-protect.png', fullPage: true });
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
