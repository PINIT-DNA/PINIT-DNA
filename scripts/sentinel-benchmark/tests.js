/**
 * Representative Sentinel benchmark test set (~34 tests) — a slice of the full
 * 150+50 spec covering categories A (basic transform), B (compression/format),
 * D (visual manipulation), E/F (region add/remove), I (AI-composite/fragment),
 * plus negative controls for false-positive measurement.
 *
 * Each test's `generate(baseBuf, meta)` derives a probe image from the real
 * protected base photo. `sourceExpected` records ground truth (all positive
 * tests are genuinely derived from the protected asset, so a miss is a
 * FALSE_NEGATIVE, not an ambiguous FAIL — see grade.js). `extractSignal` pulls
 * the relevant confidence number out of a real UnifiedInvestigationReport;
 * returning null (rather than guessing) documents a real gap — e.g. there is
 * no dedicated "Flip"/"Rotation-invariant" detector today, so those tests
 * intentionally return null and will grade as PARTIAL-at-best, surfacing the
 * gap rather than papering over it.
 */
const sharp = require('sharp');
const { randomNoiseImage, solidRect, loadBasePhoto } = require('./lib');

// ─── Signal extractors ─────────────────────────────────────────────────────

function sourceDetected(report, expectedDnaRecordId) {
  if (!report) return false;
  if (report.owner?.dnaRecordId === expectedDnaRecordId) return true;
  if (report.fragmentReuseAnalysis?.findings?.some((f) => f.dnaRecordId === expectedDnaRecordId)) return true;
  if (report.candidateRanking?.some((c) => c.dnaRecordId === expectedDnaRecordId && c.selected)) return true;
  return false;
}

function vectorConfidence(report, label) {
  const v = report?.tamperAnalysis?.vectors?.find((x) => x.label === label);
  return v?.detected ? v.confidence : null;
}

function changeConfidence(report, type) {
  const c = report?.tamperAnalysis?.changesVsOriginal?.find((x) => x.type === type);
  return c ? c.confidence : null;
}

function overallMatchConfidence(report) {
  return report?.summary?.dnaMatchPercent ?? report?.summary?.retrievalConfidence ?? null;
}

function fragmentConfidence(report) {
  return report?.fragmentReuseAnalysis?.findings?.[0]?.confidence ?? null;
}

/** No detector carries an explicit confidence for "a region was added/removed"
 * today — overallTamperScore is used as a documented proxy when regions[] or
 * modifiedPercent is present, so grading reflects real (if imprecise) signal
 * rather than inventing a number that doesn't exist in the report. */
function regionSignalConfidence(report) {
  const t = report?.tamperAnalysis;
  if (t?.regions?.length || t?.modifiedPercent != null) return t.overallTamperScore ?? null;
  return null;
}

function cropConfidence(report) {
  return changeConfidence(report, 'Crop') ?? vectorConfidence(report, 'Crop');
}

// ─── Image generation helpers ──────────────────────────────────────────────

async function cropAway(baseBuf, meta, fractionRemoved) {
  const keepRatio = Math.sqrt(1 - fractionRemoved);
  const w = Math.round(meta.width * keepRatio);
  const h = Math.round(meta.height * keepRatio);
  const left = Math.round((meta.width - w) / 2);
  const top = Math.round((meta.height - h) / 2);
  return sharp(baseBuf).extract({ left, top, width: w, height: h }).jpeg({ quality: 92 }).toBuffer();
}

async function resizeScale(baseBuf, meta, scale) {
  return sharp(baseBuf).resize(Math.max(8, Math.round(meta.width * scale)), Math.max(8, Math.round(meta.height * scale))).jpeg({ quality: 92 }).toBuffer();
}

async function rotate(baseBuf, degrees) {
  return sharp(baseBuf).rotate(degrees).jpeg({ quality: 92 }).toBuffer();
}

async function flipH(baseBuf) {
  return sharp(baseBuf).flop().jpeg({ quality: 92 }).toBuffer();
}

async function jpegQuality(baseBuf, quality) {
  return sharp(baseBuf).jpeg({ quality }).toBuffer();
}

async function pngThenJpeg(baseBuf, quality = 90) {
  const png = await sharp(baseBuf).png().toBuffer();
  return sharp(png).jpeg({ quality }).toBuffer();
}

async function webpRoundTrip(baseBuf, quality = 90) {
  const webp = await sharp(baseBuf).webp({ quality: 85 }).toBuffer();
  return sharp(webp).jpeg({ quality }).toBuffer();
}

async function recompressTwice(baseBuf) {
  const once = await sharp(baseBuf).jpeg({ quality: 80 }).toBuffer();
  return sharp(once).jpeg({ quality: 80 }).toBuffer();
}

async function colorAdjust(baseBuf, opts) {
  return sharp(baseBuf).modulate(opts).jpeg({ quality: 92 }).toBuffer();
}

async function toGrayscale(baseBuf) {
  return sharp(baseBuf).grayscale().jpeg({ quality: 92 }).toBuffer();
}

async function gaussianBlur(baseBuf, sigma) {
  return sharp(baseBuf).blur(sigma).jpeg({ quality: 92 }).toBuffer();
}

async function addNoise(baseBuf, meta, opacity = 0.18) {
  const noise = await randomNoiseImage(meta.width, meta.height);
  return sharp(baseBuf)
    .composite([{ input: await sharp(noise).ensureAlpha(opacity).toBuffer(), blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Localized edit applied to a sub-region, composited back — used for both
 * "local brightness modification" and "local color replacement" style tests. */
async function localRegionEdit(baseBuf, meta, fraction, modulateOpts) {
  const side = Math.round(Math.sqrt(fraction * meta.width * meta.height));
  const left = Math.round((meta.width - side) / 2);
  const top = Math.round((meta.height - side) / 2);
  const region = await sharp(baseBuf).extract({ left, top, width: side, height: side }).modulate(modulateOpts).toBuffer();
  return sharp(baseBuf).composite([{ input: region, left, top }]).jpeg({ quality: 92 }).toBuffer();
}

async function removeRegion(baseBuf, meta, fraction) {
  const side = Math.round(Math.sqrt(fraction * meta.width * meta.height));
  const left = Math.round((meta.width - side) / 2);
  const top = Math.round((meta.height - side) / 2);
  const block = await solidRect(side, side, { r: 12, g: 12, b: 12 });
  return sharp(baseBuf).composite([{ input: block, left, top }]).jpeg({ quality: 92 }).toBuffer();
}

async function addRegion(baseBuf, meta, fraction) {
  const side = Math.min(Math.round(Math.sqrt(fraction * meta.width * meta.height)), meta.width - 2, meta.height - 2);
  const left = Math.min(Math.round(meta.width * 0.6), meta.width - side - 1);
  const top = Math.min(Math.round(meta.height * 0.6), meta.height - side - 1);
  const bg = await randomNoiseImage(400, 400);
  const patch = await sharp(bg).resize(side, side).toBuffer();
  return sharp(baseBuf).composite([{ input: patch, left: Math.max(0, left), top: Math.max(0, top) }]).jpeg({ quality: 92 }).toBuffer();
}

/** A fragment of the protected original, of a given area fraction, composited
 * into an unrelated high-entropy background — the core "AI compositing"
 * scenario (spec Section I). Generalizes the proven eyes_spliced pattern from
 * scripts/test-tamper-detection.cjs to an arbitrary target area fraction. */
async function compositeFragment(baseBuf, meta, areaFraction) {
  const bgW = Math.round(meta.width * 1.3);
  const bgH = Math.round(meta.height * 1.3);
  const bg = await randomNoiseImage(bgW, bgH);

  const fragSide = Math.min(Math.round(Math.sqrt(areaFraction * meta.width * meta.height)), meta.width, meta.height);
  const fragLeft = Math.round((meta.width - fragSide) / 2);
  const fragTop = Math.round((meta.height - fragSide) / 2);
  const fragment = await sharp(baseBuf).extract({ left: fragLeft, top: fragTop, width: fragSide, height: fragSide }).toBuffer();

  const placeLeft = Math.min(Math.round(bgW * 0.25), bgW - fragSide - 1);
  const placeTop = Math.min(Math.round(bgH * 0.2), bgH - fragSide - 1);
  return sharp(bg).composite([{ input: fragment, left: Math.max(0, placeLeft), top: Math.max(0, placeTop) }]).jpeg({ quality: 92 }).toBuffer();
}

// ─── Test definitions ──────────────────────────────────────────────────────

function buildTests() {
  return [
    // ── A. Basic transformation ──────────────────────────────────────────
    { id: 'IMG-001', category: 'A-transform', label: 'Original unchanged', sourceExpected: true, targetConfidencePct: 99,
      generate: (b) => jpegQuality(b, 95), extractSignal: (r) => overallMatchConfidence(r) },
    { id: 'IMG-002', category: 'A-transform', label: '5% crop', sourceExpected: true, targetConfidencePct: 98,
      generate: (b, m) => cropAway(b, m, 0.05), extractSignal: (r) => cropConfidence(r) },
    { id: 'IMG-004', category: 'A-transform', label: '25% crop', sourceExpected: true, targetConfidencePct: 95,
      generate: (b, m) => cropAway(b, m, 0.25), extractSignal: (r) => cropConfidence(r) },
    { id: 'IMG-006', category: 'A-transform', label: '75% crop (extreme)', sourceExpected: true, targetConfidencePct: 80,
      generate: (b, m) => cropAway(b, m, 0.75), extractSignal: (r) => cropConfidence(r) },
    { id: 'IMG-007', category: 'A-transform', label: '10% resize down', sourceExpected: true, targetConfidencePct: 98,
      generate: (b, m) => resizeScale(b, m, 0.9), extractSignal: (r) => vectorConfidence(r, 'Resize') ?? overallMatchConfidence(r) },
    { id: 'IMG-009', category: 'A-transform', label: '90% resize down', sourceExpected: true, targetConfidencePct: 90,
      generate: (b, m) => resizeScale(b, m, 0.1), extractSignal: (r) => vectorConfidence(r, 'Resize') ?? overallMatchConfidence(r) },
    { id: 'IMG-011', category: 'A-transform', label: '4x upscale', sourceExpected: true, targetConfidencePct: 95,
      generate: (b, m) => resizeScale(b, m, 4.0), extractSignal: (r) => vectorConfidence(r, 'Resize') ?? overallMatchConfidence(r) },
    { id: 'IMG-012', category: 'A-transform', label: 'Horizontal flip', sourceExpected: true, targetConfidencePct: 95,
      generate: (b) => flipH(b), extractSignal: () => null, note: 'No dedicated flip/mirror detector exists today' },
    { id: 'IMG-014', category: 'A-transform', label: '90 degree rotation', sourceExpected: true, targetConfidencePct: 95,
      generate: (b) => rotate(b, 90), extractSignal: (r) => vectorConfidence(r, 'Rotation') },

    // ── B. Compression & format ──────────────────────────────────────────
    { id: 'IMG-021', category: 'B-compression', label: 'JPEG Q90', sourceExpected: true, targetConfidencePct: 98,
      generate: (b) => jpegQuality(b, 90), extractSignal: (r) => overallMatchConfidence(r) },
    { id: 'IMG-023', category: 'B-compression', label: 'JPEG Q50', sourceExpected: true, targetConfidencePct: 90,
      generate: (b) => jpegQuality(b, 50), extractSignal: (r) => vectorConfidence(r, 'Compression') ?? overallMatchConfidence(r) },
    { id: 'IMG-025', category: 'B-compression', label: 'JPEG Q10 (heavy)', sourceExpected: true, targetConfidencePct: 70,
      generate: (b) => jpegQuality(b, 10), extractSignal: (r) => vectorConfidence(r, 'Compression') ?? overallMatchConfidence(r) },
    { id: 'IMG-028', category: 'B-compression', label: 'PNG -> JPEG', sourceExpected: true, targetConfidencePct: 98,
      generate: (b) => pngThenJpeg(b), extractSignal: (r) => overallMatchConfidence(r) },
    { id: 'IMG-030', category: 'B-compression', label: 'JPEG -> WebP -> JPEG', sourceExpected: true, targetConfidencePct: 95,
      generate: (b) => webpRoundTrip(b), extractSignal: (r) => overallMatchConfidence(r) },
    { id: 'IMG-035', category: 'B-compression', label: 'Recompress twice (platform reupload sim)', sourceExpected: true, targetConfidencePct: 90,
      generate: (b) => recompressTwice(b), extractSignal: (r) => overallMatchConfidence(r) },

    // ── D. Visual manipulation ───────────────────────────────────────────
    { id: 'IMG-046', category: 'D-visual', label: 'Brightness +20%', sourceExpected: true, targetConfidencePct: 95,
      generate: (b) => colorAdjust(b, { brightness: 1.2 }), extractSignal: (r) => vectorConfidence(r, 'Contrast / Brightness') ?? overallMatchConfidence(r) },
    { id: 'IMG-050', category: 'D-visual', label: 'Saturation +50%', sourceExpected: true, targetConfidencePct: 95,
      generate: (b) => colorAdjust(b, { saturation: 1.5 }), extractSignal: (r) => vectorConfidence(r, 'Color Filters') ?? overallMatchConfidence(r) },
    { id: 'IMG-054', category: 'D-visual', label: 'Black & white', sourceExpected: true, targetConfidencePct: 90,
      generate: (b) => toGrayscale(b), extractSignal: (r) => vectorConfidence(r, 'Color Filters') ?? overallMatchConfidence(r) },
    { id: 'IMG-057', category: 'D-visual', label: 'Gaussian blur', sourceExpected: true, targetConfidencePct: 85,
      generate: (b) => gaussianBlur(b, 8), extractSignal: (r) => vectorConfidence(r, 'Blur') ?? overallMatchConfidence(r) },
    { id: 'IMG-061', category: 'D-visual', label: 'Gaussian noise', sourceExpected: true, targetConfidencePct: 85,
      generate: (b, m) => addNoise(b, m), extractSignal: (r) => overallMatchConfidence(r), note: 'No dedicated noise detector exists today' },
    { id: 'IMG-064', category: 'D-visual', label: 'Local brightness modification (regional)', sourceExpected: true, targetConfidencePct: 80,
      generate: (b, m) => localRegionEdit(b, m, 0.15, { brightness: 1.6 }), extractSignal: (r) => regionSignalConfidence(r) },
    { id: 'IMG-065', category: 'D-visual', label: 'Local color replacement (regional)', sourceExpected: true, targetConfidencePct: 80,
      generate: (b, m) => localRegionEdit(b, m, 0.15, { hue: 180, saturation: 2 }), extractSignal: (r) => regionSignalConfidence(r) },

    // ── E/F. Object removal / addition ───────────────────────────────────
    { id: 'IMG-066', category: 'E-removal', label: 'Remove small object (~5%)', sourceExpected: true, targetConfidencePct: 85,
      generate: (b, m) => removeRegion(b, m, 0.05), extractSignal: (r) => regionSignalConfidence(r) },
    { id: 'IMG-068', category: 'E-removal', label: 'Remove large object (~30%)', sourceExpected: true, targetConfidencePct: 70,
      generate: (b, m) => removeRegion(b, m, 0.30), extractSignal: (r) => regionSignalConfidence(r) },
    { id: 'IMG-081', category: 'F-addition', label: 'Add small object (~5%)', sourceExpected: true, targetConfidencePct: 85,
      generate: (b, m) => addRegion(b, m, 0.05), extractSignal: (r) => regionSignalConfidence(r) },
    { id: 'IMG-089', category: 'F-addition', label: 'Add 50% new content', sourceExpected: true, targetConfidencePct: 60,
      generate: (b, m) => addRegion(b, m, 0.50), extractSignal: (r) => regionSignalConfidence(r) },

    // ── I. AI + protected-asset compositing ──────────────────────────────
    { id: 'IMG-121', category: 'I-ai-composite', label: 'AI background + original subject, 50% protected', sourceExpected: true, targetConfidencePct: 60,
      generate: (b, m) => compositeFragment(b, m, 0.50), extractSignal: (r) => fragmentConfidence(r) ?? overallMatchConfidence(r) },
    { id: 'IMG-123', category: 'I-ai-composite', label: 'AI background + original subject, 10% protected', sourceExpected: true, targetConfidencePct: 70,
      generate: (b, m) => compositeFragment(b, m, 0.10), extractSignal: (r) => fragmentConfidence(r) ?? overallMatchConfidence(r) },
    { id: 'IMG-124', category: 'I-ai-composite', label: 'AI background + original subject, 5% protected', sourceExpected: true, targetConfidencePct: 70,
      generate: (b, m) => compositeFragment(b, m, 0.05), extractSignal: (r) => fragmentConfidence(r) ?? overallMatchConfidence(r) },
    { id: 'IMG-127', category: 'I-ai-composite', label: 'AI scene + protected product, 10% protected', sourceExpected: true, targetConfidencePct: 70,
      generate: (b, m) => compositeFragment(b, m, 0.10), extractSignal: (r) => fragmentConfidence(r) ?? overallMatchConfidence(r) },
    { id: 'IMG-128', category: 'I-ai-composite', label: 'AI scene + protected logo, 5% protected', sourceExpected: true, targetConfidencePct: 70,
      generate: (b, m) => compositeFragment(b, m, 0.05), extractSignal: (r) => fragmentConfidence(r) ?? overallMatchConfidence(r) },
    { id: 'IMG-135', category: 'I-ai-composite', label: 'AI composite + screenshot-style degradation', sourceExpected: true, targetConfidencePct: 55,
      generate: async (b, m) => jpegQuality(await resizeScale(await compositeFragment(b, m, 0.10), { width: Math.round(m.width * 1.3), height: Math.round(m.height * 1.3) }, 0.8), 60),
      extractSignal: (r) => fragmentConfidence(r) ?? overallMatchConfidence(r) },

    // ── Negative controls (false-positive measurement) ───────────────────
    { id: 'NEG-001', category: 'negative-control', label: 'Completely unrelated image', sourceExpected: false, targetConfidencePct: 0,
      generate: (_b, m) => randomNoiseImage(m.width, m.height), extractSignal: () => null },
    { id: 'NEG-002', category: 'negative-control', label: 'Completely unrelated image (larger canvas)', sourceExpected: false, targetConfidencePct: 0,
      generate: (_b, m) => randomNoiseImage(Math.round(m.width * 1.5), Math.round(m.height * 1.5)), extractSignal: () => null },
  ];
}

module.exports = { buildTests, sourceDetected, vectorConfidence, changeConfidence, overallMatchConfidence, fragmentConfidence, regionSignalConfidence };
