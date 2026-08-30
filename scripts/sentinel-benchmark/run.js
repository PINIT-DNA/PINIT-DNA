/**
 * Sentinel benchmark runner — protects one base asset, runs every test in
 * tests.js against the real running dev backend, grades each result, and
 * writes a JSON report + human-readable scorecard.
 *
 * Usage: node scripts/sentinel-benchmark/run.js
 * Requires: npm run dev:all already running (backend :4000, python-ai :8001).
 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const { buildTests, sourceDetected } = require('./tests');
const { grade, confidenceBand } = require('./grade');

const MARKER = `${lib.MARKER_PREFIX}base.jpg`;

async function main() {
  const startedAt = Date.now();
  await lib.purgePriorBenchmarkRecords();

  console.log('=== Protecting base asset ===');
  const baseBuf = await lib.loadBasePhoto(640);
  const sharpMeta = await require('sharp')(baseBuf).metadata();
  const meta = { width: sharpMeta.width, height: sharpMeta.height };

  const asset = await lib.protectBaseImage(baseBuf, MARKER);
  console.log(`[protect] user=${asset.shortId} dnaRecordId=${asset.dnaRecordId} vaultId=${asset.vaultId}`);
  console.log(`[protect] backfill: ${JSON.stringify(asset.backfill)}`);

  const tests = buildTests();
  console.log(`\n=== Running ${tests.length} tests ===\n`);

  const results = [];

  try {
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      const tag = `[${i + 1}/${tests.length}] ${t.id}`;
      const t0 = Date.now();
      try {
        const probeBuf = await t.generate(baseBuf, meta);
        const filename = `${lib.MARKER_PREFIX}${t.id.toLowerCase()}.jpg`;
        const outcome = await lib.investigate(asset.token, probeBuf, filename);

        if (!outcome.ok) {
          results.push({
            id: t.id, category: t.category, label: t.label,
            result: 'ERROR', reason: `HTTP ${outcome.status}: ${JSON.stringify(outcome.data).slice(0, 200)}`,
            signalConfidence: null, targetConfidencePct: t.targetConfidencePct, durationMs: Date.now() - t0,
          });
          console.log(`${tag} ERROR — HTTP ${outcome.status} (${Math.round((Date.now() - t0) / 1000)}s)`);
          continue;
        }

        const report = outcome.report;
        const detected = sourceDetected(report, asset.dnaRecordId);
        const signalConfidence = t.extractSignal(report);
        const g = grade({
          sourceExpected: t.sourceExpected,
          sourceDetected: detected,
          signalConfidence,
          targetConfidencePct: t.targetConfidencePct,
        });

        results.push({
          id: t.id, category: t.category, label: t.label, note: t.note,
          result: g.result, reason: g.reason,
          sourceDetected: detected, signalConfidence, confidenceBand: confidenceBand(signalConfidence),
          targetConfidencePct: t.targetConfidencePct,
          reportState: report.summary?.reportState, primaryVector: report.tamperAnalysis?.primaryVector,
          durationMs: Date.now() - t0,
        });
        console.log(`${tag} ${g.result} — ${t.label} (signal=${signalConfidence ?? 'n/a'}, target=${t.targetConfidencePct}) [${Math.round((Date.now() - t0) / 1000)}s]`);
      } catch (err) {
        results.push({
          id: t.id, category: t.category, label: t.label, result: 'ERROR',
          reason: String(err.message || err), signalConfidence: null,
          targetConfidencePct: t.targetConfidencePct, durationMs: Date.now() - t0,
        });
        console.log(`${tag} ERROR — ${String(err.message || err)}`);
      }

      // Periodic snapshot so progress survives even if the run is killed mid-way.
      writeReports(results, asset, startedAt, true);
    }
  } finally {
    console.log('\n=== Cleanup ===');
    await lib.cleanup(asset);
    console.log('[cleanup] done');
  }

  writeReports(results, asset, startedAt, false);
}

function writeReports(results, asset, startedAt, isPartial) {
  const outDir = lib.OUT_DIR;
  const jsonPath = path.join(outDir, 'results.json');
  const summaryPath = path.join(outDir, 'scorecard.md');

  fs.writeFileSync(jsonPath, JSON.stringify({
    startedAt: new Date(startedAt).toISOString(),
    partial: isPartial,
    baseAsset: { dnaRecordId: asset.dnaRecordId, vaultId: asset.vaultId },
    results,
  }, null, 2));

  const counts = {};
  for (const r of results) counts[r.result] = (counts[r.result] || 0) + 1;

  const byCategory = {};
  for (const r of results) {
    byCategory[r.category] = byCategory[r.category] || [];
    byCategory[r.category].push(r);
  }

  let md = `# Sentinel Benchmark Scorecard\n\n`;
  md += `Run started: ${new Date(startedAt).toISOString()}${isPartial ? ' (IN PROGRESS)' : ' (COMPLETE)'}\n\n`;
  md += `## Totals\n\n`;
  md += `| Result | Count |\n|---|---|\n`;
  for (const [k, v] of Object.entries(counts)) md += `| ${k} | ${v} |\n`;
  md += `\n`;

  for (const [cat, rows] of Object.entries(byCategory)) {
    md += `## ${cat}\n\n`;
    md += `| ID | Test | Result | Signal | Target | Band |\n|---|---|---|---|---|---|\n`;
    for (const r of rows) {
      md += `| ${r.id} | ${r.label} | **${r.result}** | ${r.signalConfidence ?? 'n/a'} | ${r.targetConfidencePct} | ${r.confidenceBand ?? ''} |\n`;
    }
    md += `\n`;
  }

  fs.writeFileSync(summaryPath, md);
  if (!isPartial) {
    console.log(`\n[report] JSON: ${jsonPath}`);
    console.log(`[report] Scorecard: ${summaryPath}`);
  }
}

main()
  .catch((err) => {
    console.error('\n[FATAL]', err.response?.data ?? err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => lib.disconnect());
