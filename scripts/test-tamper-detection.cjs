/**
 * End-to-end test for tamper detection: crop / resize / region add-delete /
 * spliced-fragment reuse. Drives the REAL running dev backend (localhost:4000)
 * with real HTTP calls — no mocks, no unit-level shortcuts.
 *
 * Usage: node scripts/test-tamper-detection.cjs
 * Requires: npm run dev:all already running (backend :4000, python-ai :8001).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api/v1';
const TEST_FILENAME = 'pinit-test-vaibhavi.jpg';
const prisma = new PrismaClient();

/** Directly remove any DnaRecord rows left by a prior test run (cascades to
 * vault/local-DNA index/layers), so reruns never trip cross-account duplicate
 * detection on the fixed test filename/content. The DELETE /vault API doesn't
 * remove the underlying DnaRecord (by design — DNA is permanent evidence), so
 * a Prisma-level cleanup is the correct way to reset test state between runs. */
async function purgePriorTestRecords() {
  // Investigate probes that don't match anything get auto-registered as
  // "[probe] <filename>" DnaRecords (see src/lib/dna-immutability.ts) — the
  // "pinit-test-" marker keeps this purge scoped to only our own test data,
  // never touching a real user's investigation history.
  const del = await prisma.dnaRecord.deleteMany({
    where: { imageFilename: { contains: 'pinit-test-' } },
  });
  if (del.count) console.log(`[setup] Purged ${del.count} leftover test DnaRecord(s) from prior runs`);
}
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'scratch', 'tamper-test-images');

function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }

// Pure per-pixel random RGB static — maximum entropy, no periodicity, no repeated tiles.
// Earlier attempts used a smooth gradient (hashed close enough to pass as a photo "crop")
// and a checkerboard+rings pattern (too repetitive — many near-identical flat patches
// produced spurious patch-hash collisions with the vault original across the WHOLE
// canvas). Uncorrelated static avoids both failure modes: no two regions look alike, so
// genuine patch matches can only come from the one place the real fragment was pasted.
async function makeSyntheticBackground(width, height) {
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return sharp(buf, { raw: { width, height, channels } }).jpeg({ quality: 92 }).toBuffer();
}

async function solidRect(width, height, color) {
  return sharp({
    create: { width, height, channels: 3, background: color },
  }).jpeg().toBuffer();
}

async function buildTestImages() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const tigerPath = path.join(ROOT, 'tiger.jpeg');
  if (!fs.existsSync(tigerPath)) {
    throw new Error(`Base test photo not found at ${tigerPath}`);
  }
  // Downscale to keep the full 15-layer DNA + forensic pipeline fast for iteration.
  // A tiny per-run random marker keeps the SHA/pHash unique across reruns so a leftover
  // record from a prior (e.g. interrupted) run never trips cross-account duplicate detection.
  const marker = Buffer.from(
    `<svg width="640" height="640"><circle cx="${5 + Math.floor(Math.random() * 3)}" cy="5" r="2" fill="rgb(${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)})"/></svg>`,
  );
  const baseBuf = await sharp(tigerPath)
    .resize(640, 640, { fit: 'inside' })
    .composite([{ input: marker }])
    .jpeg({ quality: 92 })
    .toBuffer();
  const meta = await sharp(baseBuf).metadata();
  const W = meta.width, H = meta.height;
  console.log(`[setup] Base photo (protected original): ${W}x${H}`);

  // 1. Cropped — central ~70% region (known crop %)
  const cropW = Math.round(W * 0.7);
  const cropH = Math.round(H * 0.7);
  const cropLeft = Math.round((W - cropW) / 2);
  const cropTop = Math.round((H - cropH) / 2);
  const croppedBuf = await sharp(baseBuf)
    .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
    .jpeg({ quality: 92 })
    .toBuffer();

  // 2. Resized — 50% dimensions
  const resizedBuf = await sharp(baseBuf)
    .resize(Math.round(W * 0.5), Math.round(H * 0.5))
    .jpeg({ quality: 92 })
    .toBuffer();

  // 3. Region deleted — solid block painted over a known region
  const delW = Math.round(W * 0.2), delH = Math.round(H * 0.2);
  const delLeft = Math.round(W * 0.1), delTop = Math.round(H * 0.1);
  const blackBlock = await solidRect(delW, delH, { r: 10, g: 10, b: 10 });
  const regionDeletedBuf = await sharp(baseBuf)
    .composite([{ input: blackBlock, left: delLeft, top: delTop }])
    .jpeg({ quality: 92 })
    .toBuffer();

  // 4. Region added — foreign patch composited onto a known region
  const addW = Math.round(W * 0.18), addH = Math.round(H * 0.18);
  const addLeft = Math.round(W * 0.65), addTop = Math.round(H * 0.65);
  const bg = await makeSyntheticBackground(400, 400);
  const foreignPatch = await sharp(bg).resize(addW, addH).toBuffer();
  const regionAddedBuf = await sharp(baseBuf)
    .composite([{ input: foreignPatch, left: addLeft, top: addTop }])
    .jpeg({ quality: 92 })
    .toBuffer();

  // 5. Eyes-spliced — small fragment of base composited into an UNRELATED background
  const bgW = Math.round(W * 1.1), bgH = Math.round(H * 1.1);
  const unrelatedBg = await makeSyntheticBackground(bgW, bgH);
  const fragW = Math.round(W * 0.24), fragH = Math.round(H * 0.16);
  const fragLeft = Math.round(W * 0.4), fragTop = Math.round(H * 0.25); // "eyes" region stand-in
  const fragment = await sharp(baseBuf)
    .extract({ left: fragLeft, top: fragTop, width: fragW, height: fragH })
    .toBuffer();
  const spliceLeft = Math.round(bgW * 0.3), spliceTop = Math.round(bgH * 0.15);
  const eyesSplicedBuf = await sharp(unrelatedBg)
    .composite([{ input: fragment, left: spliceLeft, top: spliceTop }])
    .jpeg({ quality: 92 })
    .toBuffer();

  const files = {
    base: baseBuf,
    cropped: croppedBuf,
    resized: resizedBuf,
    region_deleted: regionDeletedBuf,
    region_added: regionAddedBuf,
    eyes_spliced: eyesSplicedBuf,
  };
  for (const [name, buf] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT_DIR, `${name}.jpg`), buf);
  }
  console.log(`[setup] Wrote test images to ${OUT_DIR}`);

  return {
    files,
    knownCropPercent: Math.round((1 - (cropW * cropH) / (W * H)) * 100),
  };
}

async function uploadField(url, token, fieldName, buffer, filename, extraFields) {
  const form = new FormData();
  form.append(fieldName, buffer, { filename, contentType: 'image/jpeg' });
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) form.append(k, String(v));
  }
  const res = await axios.post(url, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 300_000,
    validateStatus: () => true,
  });
  return res;
}

function summarizeTamper(report) {
  const t = report.tamperAnalysis || {};
  return {
    primaryVector: t.primaryVector,
    overallTamperScore: t.overallTamperScore,
    cropDetection: t.cropDetection,
    modifiedPercent: t.modifiedPercent,
    insertedRegions: t.insertedRegions,
    regions: t.regions,
    changesVsOriginal: (t.changesVsOriginal || []).map((c) => `${c.type} (${c.confidence}%)`),
    fragmentReuseAnalysis: report.fragmentReuseAnalysis,
    reportState: report.summary && report.summary.reportState,
    success: report.success,
  };
}

async function main() {
  const results = [];
  function record(name, pass, detail) {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}: ${detail}`);
  }

  await purgePriorTestRecords();

  console.log('=== Building synthetic test images ===');
  const { files, knownCropPercent } = await buildTestImages();
  console.log(`[setup] Known crop amount for cropped.jpg: ~${knownCropPercent}%`);

  console.log('\n=== Creating test account ===');
  const authRes = await axios.post(`${BASE}/auth/create`, {});
  if (!authRes.data?.success) throw new Error(`auth/create failed: ${JSON.stringify(authRes.data)}`);
  const token = authRes.data.data.accessToken;
  const shortId = authRes.data.data.user.shortId;
  console.log(`[auth] Created test user ${shortId}`);

  let vaultId = null;
  let dnaRecordId = null;
  const reports = {};

  try {
    console.log('\n=== Protecting base photo (DNA generate + vault store) ===');
    const genRes = await uploadField(`${BASE}/dna/generate`, token, 'image', files.base, TEST_FILENAME);
    if (genRes.status >= 400) throw new Error(`dna/generate failed (${genRes.status}): ${JSON.stringify(genRes.data)}`);
    dnaRecordId = genRes.data.dnaRecordId;
    console.log(`[dna] dnaRecordId=${dnaRecordId}`);

    const storeRes = await uploadField(`${BASE}/vault/store`, token, 'image', files.base, TEST_FILENAME, { dnaRecordId });
    if (storeRes.status >= 400) throw new Error(`vault/store failed (${storeRes.status}): ${JSON.stringify(storeRes.data)}`);
    vaultId = storeRes.data.vaultId;
    console.log(`[vault] vaultId=${vaultId}`);

    console.log('\n=== Ensuring local-DNA patch index is built (backfill, synchronous) ===');
    const backfillRes = await axios.post(`${BASE}/vault/local-dna/backfill`, {}, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: () => true,
    });
    console.log(`[backfill] ${JSON.stringify(backfillRes.data)}`);

    console.log('\n=== Running Investigate on each variant ===');
    for (const variant of ['cropped', 'resized', 'region_deleted', 'region_added', 'eyes_spliced']) {
      const res = await uploadField(`${BASE}/forensics/unified-investigate`, token, 'image', files[variant], `pinit-test-${variant}.jpg`);
      if (res.status >= 400) {
        console.log(`[investigate:${variant}] HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
        reports[variant] = null;
        continue;
      }
      reports[variant] = res.data.report;
      console.log(`\n--- ${variant} ---`);
      console.log(JSON.stringify(summarizeTamper(res.data.report), null, 2));
    }
  } finally {
    if (vaultId) {
      console.log('\n=== Cleanup ===');
      const delRes = await axios.delete(`${BASE}/vault/${vaultId}`, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true,
      });
      console.log(`[cleanup] DELETE /vault/${vaultId} -> ${delRes.status}`);
    }
    if (dnaRecordId) {
      const del = await prisma.dnaRecord.deleteMany({ where: { id: dnaRecordId } });
      console.log(`[cleanup] Purged DnaRecord ${dnaRecordId} (${del.count} row)`);
    }
  }

  console.log('\n=== Assertions ===');

  // 1. Crop
  const cropReport = reports.cropped;
  const cropDet = cropReport?.tamperAnalysis?.cropDetection;
  const cropChange = cropReport?.tamperAnalysis?.changesVsOriginal?.find((c) => c.type === 'Crop');
  record(
    'Crop % detected',
    !!(cropDet?.cropPercent != null || cropDet?.missingPercent != null || cropChange),
    cropDet ? `cropPercent=${cropDet.cropPercent ?? cropDet.missingPercent} (expected ~${knownCropPercent}%)` : 'no cropDetection in report',
  );

  // 2. Resize
  const resizeReport = reports.resized;
  const resizeVec = resizeReport?.tamperAnalysis?.vectors?.find((v) => v.label === 'Resize');
  record(
    'Resize detected',
    !!resizeVec?.detected,
    resizeVec ? `Resize detector detected=${resizeVec.detected} confidence=${resizeVec.confidence}` : 'no Resize vector in report',
  );

  // 3. Region deleted/added
  for (const variant of ['region_deleted', 'region_added']) {
    const r = reports[variant];
    const regions = r?.tamperAnalysis?.regions;
    const modPct = r?.tamperAnalysis?.modifiedPercent;
    record(
      `${variant}: region-level change detected`,
      !!(regions?.length || modPct != null),
      regions?.length ? `regions=${JSON.stringify(regions)}` : `modifiedPercent=${modPct}`,
    );
  }

  // 4. Fragment splice — the hard case
  const spliceReport = reports.eyes_spliced;
  const fragmentAnalysis = spliceReport?.fragmentReuseAnalysis;
  const topFinding = fragmentAnalysis?.findings?.[0];
  record(
    'Eyes-fragment splice detected',
    !!(fragmentAnalysis?.detected && topFinding),
    topFinding
      ? `matched dnaRecordId=${topFinding.dnaRecordId} (expected ${dnaRecordId}), confidence=${topFinding.confidence}%, probeRegion=${JSON.stringify(topFinding.probeRegion)}`
      : `fragmentReuseAnalysis=${JSON.stringify(fragmentAnalysis)}`,
  );
  if (topFinding) {
    record(
      'Fragment match points back to the protected original',
      topFinding.dnaRecordId === dnaRecordId,
      `${topFinding.dnaRecordId} === ${dnaRecordId}`,
    );
  }

  console.log('\n=== Summary ===');
  const passed = results.filter((r) => r.pass).length;
  console.log(`${passed}/${results.length} checks passed`);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}`);

  if (passed < results.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('\n[FATAL]', err.response?.data ?? err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
