/**
 * Shared utilities for the Sentinel benchmark harness — auth, upload, cleanup,
 * and image-generation helpers. Drives the REAL running dev backend
 * (localhost:4000) with real HTTP calls; no mocks.
 *
 * Reuses the proven patterns from scripts/test-tamper-detection.cjs:
 * real /auth/create JWT, "pinit-test-" filename marker + Prisma purge for
 * repeatable reruns, real multipart uploads, polling with a generous timeout.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api/v1';
const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'scratch', 'sentinel-benchmark');
const MARKER_PREFIX = 'sentinel-bench-';

const prisma = new PrismaClient();

fs.mkdirSync(OUT_DIR, { recursive: true });

/** Purge only our own prior benchmark records (scoped by the sentinel-bench-
 * filename marker) — never touches real user data or other test suites'
 * "pinit-test-" marker. DELETE /vault doesn't remove the DnaRecord (by design
 * — DNA is permanent evidence), so a Prisma-level purge is required to reset
 * state between runs and dodge cross-account near-duplicate rejection. */
async function purgePriorBenchmarkRecords() {
  const del = await prisma.dnaRecord.deleteMany({
    where: { imageFilename: { contains: MARKER_PREFIX } },
  });
  if (del.count) console.log(`[setup] Purged ${del.count} leftover benchmark DnaRecord(s) from prior runs`);
  return del.count;
}

async function createTestUser() {
  const authRes = await axios.post(`${BASE}/auth/create`, {});
  if (!authRes.data?.success) throw new Error(`auth/create failed: ${JSON.stringify(authRes.data)}`);
  const { accessToken, user } = authRes.data.data;
  return { token: accessToken, shortId: user.shortId };
}

async function uploadField(url, token, fieldName, buffer, filename, extraFields, timeoutMs = 300_000) {
  const form = new FormData();
  form.append(fieldName, buffer, { filename, contentType: 'image/jpeg' });
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) form.append(k, String(v));
  }
  return axios.post(url, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: timeoutMs,
    validateStatus: () => true,
  });
}

/** Protect a base image; returns { token, shortId, dnaRecordId, vaultId }. */
async function protectBaseImage(baseBuf, filename) {
  const { token, shortId } = await createTestUser();

  const genRes = await uploadField(`${BASE}/dna/generate`, token, 'image', baseBuf, filename);
  if (genRes.status >= 400) throw new Error(`dna/generate failed (${genRes.status}): ${JSON.stringify(genRes.data)}`);
  const dnaRecordId = genRes.data.dnaRecordId;

  const storeRes = await uploadField(`${BASE}/vault/store`, token, 'image', baseBuf, filename, { dnaRecordId });
  if (storeRes.status >= 400) throw new Error(`vault/store failed (${storeRes.status}): ${JSON.stringify(storeRes.data)}`);
  const vaultId = storeRes.data.vaultId;

  const backfillRes = await axios.post(`${BASE}/vault/local-dna/backfill`, {}, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });

  return { token, shortId, dnaRecordId, vaultId, backfill: backfillRes.data };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** The remote Supabase pooler connection has been observed to drop transiently
 * under sustained load during a long benchmark run (external infra blip, not
 * an app bug) — a bare HTTP 500 with near-zero latency is the signature. Retry
 * a couple of times with backoff before giving up, so one blip doesn't cascade
 * into failing the rest of a multi-hour run. */
async function investigate(token, probeBuf, filename, attempt = 1) {
  // 420s, not 300s — a clean successful run has been observed taking up to 298s
  // on its own; 300s left almost no margin and produced spurious timeouts.
  const res = await uploadField(`${BASE}/forensics/unified-investigate`, token, 'image', probeBuf, filename, undefined, 420_000);
  if (res.status >= 500 && attempt < 4) {
    console.log(`  [retry] HTTP ${res.status} on attempt ${attempt}, backing off ${attempt * 15}s...`);
    await sleep(attempt * 15_000);
    return investigate(token, probeBuf, filename, attempt + 1);
  }
  if (res.status >= 400) {
    return { ok: false, status: res.status, data: res.data };
  }
  return { ok: true, report: res.data.report };
}

async function cleanup({ token, vaultId, dnaRecordId, shortId }) {
  if (vaultId && token) {
    await axios.delete(`${BASE}/vault/${vaultId}`, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: () => true,
    }).catch(() => {});
  }
  if (dnaRecordId) {
    await prisma.dnaRecord.deleteMany({ where: { id: dnaRecordId } }).catch(() => {});
  }
  // Sweep any auto-registered "[probe] sentinel-bench-*" records from this run's
  // investigate calls, and the test user itself.
  await prisma.dnaRecord.deleteMany({ where: { imageFilename: { contains: MARKER_PREFIX } } }).catch(() => {});
  if (shortId) {
    await prisma.user.deleteMany({ where: { shortId } }).catch(() => {});
  }
}

async function disconnect() {
  await prisma.$disconnect();
}

// ─── Image generation helpers ──────────────────────────────────────────────

function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }

/** High-entropy random static — no periodicity, doesn't accidentally hash
 * close to real photo content or collide via repeated-tile patch matching.
 * See scripts/test-tamper-detection.cjs for why gradients/checkerboards failed. */
async function randomNoiseImage(width, height, quality = 92) {
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return sharp(buf, { raw: { width, height, channels } }).jpeg({ quality }).toBuffer();
}

async function solidRect(width, height, color) {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

/** Load the repo's real base photo, downscaled + given a unique per-call
 * marker dot so repeated benchmark runs never collide with each other or
 * with real account data via near-duplicate pHash detection. */
async function loadBasePhoto(size = 640) {
  const tigerPath = path.join(ROOT, 'tiger.jpeg');
  if (!fs.existsSync(tigerPath)) throw new Error(`Base test photo not found at ${tigerPath}`);
  const marker = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${5 + Math.floor(Math.random() * 3)}" cy="5" r="2" fill="rgb(${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)})"/></svg>`,
  );
  return sharp(tigerPath)
    .resize(size, size, { fit: 'inside' })
    .composite([{ input: marker }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

module.exports = {
  BASE, OUT_DIR, MARKER_PREFIX, prisma,
  purgePriorBenchmarkRecords, createTestUser, uploadField,
  protectBaseImage, investigate, cleanup, disconnect,
  clamp, randomNoiseImage, solidRect, loadBasePhoto,
};
