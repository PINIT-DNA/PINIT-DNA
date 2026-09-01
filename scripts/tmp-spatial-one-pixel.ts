import 'dotenv/config';
import fs from 'fs';
import sharp from 'sharp';
import { verifyExactSpatialAuthForDna } from '../src/services/spatial/verify-exact.service';

async function main() {
  const base = fs.readFileSync('C:/Users/vaibh/Desktop/vaibhavi-spatial-base.png');
  const { data, info } = await sharp(base).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const x = 200;
  const y = 80;
  const i = (y * info.width + x) * 3;
  data[i] = 0;
  data[i + 1] = 0;
  data[i + 2] = 0;
  const out = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 3 },
  })
    .png()
    .toBuffer();
  fs.writeFileSync('C:/Users/vaibh/Desktop/vaibhavi-spatial-DOT.png', out);

  const r = await verifyExactSpatialAuthForDna({
    dnaRecordId: 'a22010fc-83d7-4a7b-9668-2e5a22c6ee58',
    candidateImageBuffer: out,
  });

  console.log({
    status: r.status,
    blocksFailed: r.blocksFailed,
    blocksPassed: r.blocksPassed,
    fineFailed: r.fineLocalization?.stats.cellsFailed,
    pixel1Failed: r.pixel1Localization?.stats.pixelsFailed,
    firstTamperedBlock: r.localization?.tamperedBlocks?.[0],
    firstPixel: r.pixel1Localization?.tamperedPixels?.[0],
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
