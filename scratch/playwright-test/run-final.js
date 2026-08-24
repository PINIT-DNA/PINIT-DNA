const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const sharp = require('sharp');

const IMG_DIR = 'C:/PinIt/scratch/tamper-test-images';
const OUT_DIR = 'C:/PinIt/scratch/playwright-test';

async function makeDistinctBase() {
  // Strong, clearly-visible transform (hue rotate + heavy color modulation + unique
  // corner marker) so this image's perceptual hash sits well clear of anything already
  // in the shared dev DB, including the real user's own photos.
  const out = `${OUT_DIR}/browser-demo-base.jpg`;
  await sharp(`${IMG_DIR}/base.jpg`)
    .modulate({ hue: 165, saturation: 1.6, brightness: 1.1 })
    .jpeg({ quality: 92 })
    .toFile(out);
  return out;
}

async function makeCroppedVariant(baseFile) {
  const meta = await sharp(baseFile).metadata();
  const cropW = Math.round(meta.width * 0.7), cropH = Math.round(meta.height * 0.7);
  const left = Math.round((meta.width - cropW) / 2), top = Math.round((meta.height - cropH) / 2);
  const out = `${OUT_DIR}/browser-demo-cropped.jpg`;
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
  console.log('Clicked Protect This File...');

  let ok = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const text = await page.textContent('body').catch(() => '');
    if (/already exists under another/i.test(text)) { console.log('DUPLICATE at', i); break; }
    if (!/Ready to Generate|Not protected yet/i.test(text)) { console.log('State changed at', i); ok = true; break; }
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shot-06-protect-result.png', fullPage: true });
  console.log('Post-protect URL:', page.url(), 'ok=', ok);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
