/**
 * One-shot backfill: copy Exchange portfolio_profiles into Hub (additive).
 * Does not delete Exchange rows.
 *
 *   npx ts-node --transpile-only scripts/backfill-hub-portfolios.ts
 */
import { portfolioService } from '../src/services/portfolio/portfolio.service';

(async () => {
  const results = await portfolioService.backfillAllFromExchange();
  console.log('[backfill-hub-portfolios]', JSON.stringify(results, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error('[backfill-hub-portfolios]', err);
  process.exit(1);
});
