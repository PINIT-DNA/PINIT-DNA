/**
 * Keeps the AI service's search index in step with the database.
 *
 * The AI service stores its FAISS index on its own local disk. On Render Free and
 * on ECS that disk is ephemeral, and the AI service restarts independently of the
 * backend — so after any AI restart search silently returned nothing. The old
 * safeguard ran once, 20s after the BACKEND booted, over the first 200 records
 * only, and only if the AI service happened to be awake by then.
 *
 * This compares the ids the AI service actually holds with the database and
 * indexes whatever is missing — all of it, in pages — and is safe to call
 * repeatedly (single-flight, and a no-op when nothing is missing).
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { aiService } from './ai-embeddings.service';

const PAGE_SIZE = 200;
const CONCURRENCY = 5;

export type AiIndexSyncResult =
  | { status: 'busy' }
  | { status: 'offline' }
  | { status: 'unknown-index' }
  | { status: 'in-sync'; total: number }
  | { status: 'synced'; total: number; missing: number; indexed: number; failed: number };

let running = false;

/** Same text the reindex endpoint uses: stored OCR text when there is enough, else the filename. */
export function buildIndexText(filename: string, ocrText?: string | null): string {
  if (ocrText && ocrText.length > 50) return `${filename} ${ocrText}`.replace(/\s+/g, ' ').trim();
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-\.]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

export async function syncAiIndex(): Promise<AiIndexSyncResult> {
  if (running) return { status: 'busy' };
  running = true;
  try {
    if (!(await aiService.isOnline())) return { status: 'offline' };

    const indexed = await aiService.getIndexedIds();
    if (!indexed) return { status: 'unknown-index' }; // older AI service or transient error — never assume empty

    const all = await prisma.dnaRecord.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    const missingIds = all.map((r) => r.id).filter((id) => !indexed.has(id));
    if (!missingIds.length) return { status: 'in-sync', total: all.length };

    logger.info('AI index is missing documents — re-indexing', { missing: missingIds.length, total: all.length });

    let ok = 0;
    let failed = 0;
    for (let p = 0; p < missingIds.length; p += PAGE_SIZE) {
      const page = missingIds.slice(p, p + PAGE_SIZE);
      const records = await prisma.dnaRecord.findMany({
        where: { id: { in: page } },
        select: {
          id: true, imageFilename: true, fileType: true,
          ocrRecord: { select: { extractedText: true } },
        },
      });
      for (let i = 0; i < records.length; i += CONCURRENCY) {
        await Promise.all(records.slice(i, i + CONCURRENCY).map(async (r) => {
          try {
            const res = await aiService.indexDocument({
              dnaRecordId: r.id,
              filename: r.imageFilename,
              fileType: r.fileType ?? 'IMAGE',
              text: buildIndexText(r.imageFilename, r.ocrRecord?.extractedText),
            });
            if (res) ok++; else failed++; // null = AI went away mid-run
          } catch {
            failed++;
          }
        }));
      }
    }

    logger.info('AI index sync complete', { indexed: ok, failed, missing: missingIds.length });
    return { status: 'synced', total: all.length, missing: missingIds.length, indexed: ok, failed };
  } catch (err) {
    logger.debug('AI index sync failed (non-fatal)', { error: String(err) });
    return { status: 'offline' };
  } finally {
    running = false;
  }
}

/**
 * Run a sync shortly after boot and then on an interval, so an AI service that
 * restarted (or woke from sleep) later is repaired without a backend restart.
 * Timers are unref'd so they never hold the process open.
 */
export function startAiIndexSync(opts: { initialDelayMs?: number; intervalMs?: number } = {}): void {
  const initialDelayMs = opts.initialDelayMs ?? 20_000;
  const intervalMs = opts.intervalMs ?? 5 * 60_000;
  const run = () => { void syncAiIndex().catch(() => undefined); };
  setTimeout(run, initialDelayMs).unref();
  setInterval(run, intervalMs).unref();
}
