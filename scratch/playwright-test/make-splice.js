const sharp = require('sharp');
const fs = require('fs');

const OUT_DIR = 'C:/PinIt/scratch/playwright-test';
const { baseFile } = JSON.parse(fs.readFileSync('files-info.json', 'utf8'));

async function main() {
  const meta = await sharp(baseFile).metadata();
  const W = meta.width, H = meta.height;

  // Fresh unrelated high-entropy background (different seed/content from base)
  const bgW = Math.round(W * 1.1), bgH = Math.round(H * 1.1);
  const bgBuf = Buffer.alloc(bgW * bgH * 3);
  for (let i = 0; i < bgBuf.length; i++) bgBuf[i] = Math.floor(Math.random() * 256);
  const bg = await sharp(bgBuf, { raw: { width: bgW, height: bgH, channels: 3 } }).png().toBuffer();

  const fragW = Math.round(W * 0.24), fragH = Math.round(H * 0.16);
  const fragLeft = Math.round(W * 0.4), fragTop = Math.round(H * 0.25);
  const fragment = await sharp(baseFile).extract({ left: fragLeft, top: fragTop, width: fragW, height: fragH }).toBuffer();

  const spliceLeft = Math.round(bgW * 0.3), spliceTop = Math.round(bgH * 0.15);
  const out = `${OUT_DIR}/demo-spliced.jpg`;
  await sharp(bg).composite([{ input: fragment, left: spliceLeft, top: spliceTop }]).jpeg({ quality: 92 }).toFile(out);
  console.log('Wrote', out);
  fs.writeFileSync('splice-info.json', JSON.stringify({ splicedFile: out }, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
