/**
 * Item 4.6 — the read half of real-world-scale layer-score monitoring.
 *
 * L2 (Structural) and L4 (Semantic) were audited and found to genuinely
 * work as documented, but only against synthetic test images (see
 * tests/layers/layer2-structural-robustness.test.ts and
 * layer4-semantic-robustness.test.ts). This can't be "finished" by code —
 * it's watching real numbers over time. This script is what to run
 * periodically to actually watch them: it reads layer_score_observations
 * (written by src/services/forensics/layer-score-monitoring.service.ts on
 * every real investigation since 2026-09-23) and reports the real
 * distribution, with L2/L4 called out specifically since they're the ones
 * this item is about.
 *
 * Usage: npx ts-node -T scripts/report-layer-score-monitoring.ts [--days N]
 * Default window: 30 days.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

const LAYER_NAMES: Record<number, string> = {
  1: 'Cryptographic', 2: 'Structural', 3: 'Perceptual', 4: 'Semantic',
  5: 'Metadata', 6: 'Signature',
};

function parseDays(): number {
  const i = process.argv.indexOf('--days');
  if (i >= 0 && process.argv[i + 1]) return parseInt(process.argv[i + 1]!, 10) || 30;
  return 30;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

async function main() {
  const days = parseDays();
  const since = new Date(Date.now() - days * 86400_000);

  const rows = await prisma.layerScoreObservation.findMany({
    where: { createdAt: { gte: since }, layer: { in: [1, 2, 3, 4, 5, 6] } },
    select: { layer: true, similarityScore: true, matched: true, skipped: true, createdAt: true },
  });

  console.log(`=== Layer score monitoring — last ${days} day(s), ${rows.length} real observation(s) ===\n`);

  if (!rows.length) {
    console.log('No observations yet in this window. This table only fills as real investigations run');
    console.log('(from 2026-09-23 onward) — if the app has been idle or this is a fresh environment,');
    console.log('there is genuinely nothing to report yet, not a bug in this script.');
    await prisma.$disconnect();
    return;
  }

  for (const layer of [1, 2, 3, 4, 5, 6]) {
    const layerRows = rows.filter((r) => r.layer === layer && !r.skipped);
    const name = LAYER_NAMES[layer];
    const flag = layer === 2 || layer === 4 ? '  <-- item 4.6' : '';
    if (!layerRows.length) {
      console.log(`L${layer} ${name}: no non-skipped observations in this window${flag}`);
      continue;
    }
    const scores = layerRows.map((r) => r.similarityScore).sort((a, b) => a - b);
    const matchedCount = layerRows.filter((r) => r.matched).length;
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const p10 = percentile(scores, 0.10);
    const p50 = percentile(scores, 0.50);
    const p90 = percentile(scores, 0.90);

    // Borderline: scored high enough to be "close" but didn't clearly match,
    // or matched but not by a wide margin -- the cases actually worth an
    // engineer's eye, since a threshold that never sees near-boundary cases
    // isn't being tested by production traffic at all.
    const borderline = layerRows.filter((r) => r.similarityScore >= 0.60 && r.similarityScore <= 0.92).length;

    console.log(`L${layer} ${name}${flag}`);
    console.log(`  n=${layerRows.length}, matched=${matchedCount} (${Math.round((matchedCount / layerRows.length) * 100)}%)`);
    console.log(`  score p10=${p10.toFixed(3)} p50=${p50.toFixed(3)} avg=${avg.toFixed(3)} p90=${p90.toFixed(3)}`);
    console.log(`  borderline (0.60-0.92): ${borderline} (${Math.round((borderline / layerRows.length) * 100)}%) -- review these if this % is climbing over time`);
    console.log('');
  }

  const skippedByLayer = new Map<number, number>();
  for (const r of rows) {
    if (r.skipped) skippedByLayer.set(r.layer, (skippedByLayer.get(r.layer) ?? 0) + 1);
  }
  if (skippedByLayer.size) {
    console.log('Skipped counts (registry layers, expected to be non-zero for L7-15 — see item 4.4):');
    for (const [layer, count] of [...skippedByLayer.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`  L${layer}: ${count} skipped`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('report-layer-score-monitoring failed:', err);
  process.exit(1);
});
