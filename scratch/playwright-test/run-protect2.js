const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const sharp = require('sharp');

const OUT_DIR = 'C:/PinIt/scratch/playwright-test';

async function makeFreshPhotoLike(seed) {
  const width = 640, height = 640, channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  const out = `${OUT_DIR}/demo-original-${seed}.jpg`;
  // Blur the noise into smooth, photo-like blobs of color/texture — unique every run,
  // won't collide with anything already in the DB, but still has real low/high-frequency
  // structure for the perceptual/structural/patch layers to key off.
  await sharp(buf, { raw: { width, height, channels } })
    .blur(6)
    .modulate({ saturation: 1.4 })
    .jpeg({ quality: 90 })
    .toFile(out);
  return out;
}

async function makeCroppedVariant(baseFile, seed) {
  const meta = await sharp(baseFile).metadata();
  const cropW = Math.round(meta.width * 0.7), cropH = Math.round(meta.height * 0.7);
  const left = Math.round((meta.width - cropW) / 2), top = Math.round((meta.height - cropH) / 2);
  const out = `${OUT_DIR}/demo-cropped-${seed}.jpg`;
  await sharp(baseFile).extract({ left, top, width: cropW, height: cropH }).jpeg({ quality: 92 }).toFile(out);
  return out;
}

(async () => {
  const authRes = await axios.post('http://localhost:4000/api/v1/auth/create', {});
  const { accessToken, refreshToken, user } = authRes.data.data;
  console.log('Created user:', user.shortId);
  fs.writeFileSync('user-info.json', JSON.stringify({ accessToken, refreshToken, user }, null, 2));

  const seed = Date.now();
  const baseFile = await makeFreshPhotoLike(seed);
  const croppedFile = await makeCroppedVariant(baseFile, seed);
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
  console.log('Clicked Protect This File...');

  let finished = false;
  let lastText = '';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(3000);
    const text = await page.textContent('body').catch(() => '');
    if (text !== lastText) {
      console.log(`[${i * 3}s]`, text.replace(/\s+/g, ' ').slice(0, 220));
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

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
