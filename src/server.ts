/**
 * PINIT-DNA — HTTP server bootstrap (single listen per process)
 *
 * Use this entry for dev (ts-node-dev) and production (node dist/server.js).
 * app.ts exports the Express app only — no app.listen() there.
 */

import http from 'http';
import path from 'path';
import type { Express } from 'express';
import { app } from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { vaultScheduler } from './services/scheduler/vault-scheduler.service';
import { startPythonAI } from './lib/python-ai-process';
import { registerGracefulShutdown, setActiveServer } from './lib/graceful-shutdown';

let httpServer: http.Server | null = null;
let bootstrapped = false;

function listenWithRetry(expressApp: Express, port: number, maxAttempts = 10): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryListen = () => {
      attempt++;
      const server = expressApp.listen(port);

      server.once('listening', () => resolve(server));

      server.once('error', (err: NodeJS.ErrnoException) => {
        server.close();

        if (err.code === 'EADDRINUSE' && attempt < maxAttempts) {
          if (attempt === 1 && config.env !== 'production') {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require(path.join(__dirname, '..', 'scripts', 'free-dev-ports.cjs'));
            } catch {
              /* non-fatal */
            }
          }
          logger.warn(`Port ${port} in use — waiting for previous instance to release (${attempt}/${maxAttempts})`);
          setTimeout(tryListen, 750);
          return;
        }

        reject(err);
      });
    };

    tryListen();
  });
}

async function onServerReady(): Promise<void> {
  vaultScheduler.start();

  if (config.env !== 'production') {
    logger.info('Starting Python AI sidecar (OCR · embeddings · vision · documents)…', {
      aiPort: process.env['AI_SERVICE_PORT'] ?? '8001',
    });
    startPythonAI();
  }

  setTimeout(async () => {
    const { tikaService } = await import('./services/tika/tika.service');
    const available = await tikaService.isAvailable();
    if (available) {
      logger.info('Apache Tika is available — enhanced metadata extraction active');
    } else {
      logger.info('Apache Tika not running — start with: docker run -d -p 9998:9998 apache/tika');
    }
  }, 3000);

  setTimeout(async () => {
    try {
      const { prisma: db } = await import('./lib/prisma');
      const { aiService } = await import('./services/ai/ai-embeddings.service');

      const online = await aiService.isOnline();
      if (!online) return;

      const records = await db.dnaRecord.findMany({
        select: {
          id: true,
          imageFilename: true,
          fileType: true,
          ocrRecord: { select: { extractedText: true } },
        },
      });

      let indexed = 0;
      const BATCH = 10;
      for (let i = 0; i < records.length; i += BATCH) {
        await Promise.all(records.slice(i, i + BATCH).map(async (r) => {
          try {
            const ocrText = r.ocrRecord?.extractedText;
            const text = ocrText && ocrText.length > 50
              ? `${r.imageFilename} ${ocrText}`
              : r.imageFilename.replace(/\.[^.]+$/, '').replace(/[_\-\.]/g, ' ').trim();

            await aiService.indexDocument({
              dnaRecordId: r.id,
              filename: r.imageFilename,
              fileType: r.fileType ?? 'IMAGE',
              text,
            });
            indexed++;
          } catch {
            /* non-fatal */
          }
        }));
      }
      logger.info(`Auto-reindex complete: ${indexed}/${records.length} documents indexed silently`);
    } catch (err) {
      logger.debug('Auto-reindex failed (non-fatal)', { error: String(err) });
    }
  }, 20_000);

  if (process.env['NODE_ENV'] === 'production' && process.env['RENDER_EXTERNAL_URL']) {
    const keepAliveUrl = `${process.env['RENDER_EXTERNAL_URL']}/api/v1/health`;
    setInterval(() => {
      import('https').then(({ default: https }) =>
        https.get(keepAliveUrl, () => {}).on('error', () => {}),
      );
    }, 14 * 60 * 1000);
    logger.info('Keep-alive ping enabled', { url: keepAliveUrl });
  }
}

export async function startHttpServer(): Promise<http.Server> {
  if (httpServer?.listening) {
    logger.warn('HTTP server already listening — ignoring duplicate start');
    return httpServer;
  }

  registerGracefulShutdown();

  httpServer = await listenWithRetry(app, config.port);

  setActiveServer(httpServer);

  if (!bootstrapped) {
    bootstrapped = true;
    logger.info('PINIT-DNA API running', {
      port: config.port,
      env: config.env,
      prefix: config.apiPrefix,
      engineVersion: config.dna.engineVersion,
    });
    console.log('');
    console.log('  ┌─────────────────────────────────────────────┐');
    console.log('  │  PINIT-DNA Backend READY                      │');
    console.log('  ├─────────────────────────────────────────────┤');
    console.log(`  │  Node.js API     →  http://localhost:${config.port}       │`);
    console.log(`  │  Python AI       →  http://localhost:${process.env['AI_SERVICE_PORT'] ?? '8001'} (auto-start) │`);
    console.log('  ├─────────────────────────────────────────────┤');
    console.log('  │  Frontend (Terminal 2):                     │');
    console.log('  │    cd client && npm run dev  →  :3000        │');
    console.log('  └─────────────────────────────────────────────┘');
    console.log('');
    void onServerReady();
  }

  return httpServer;
}

if (require.main === module) {
  startHttpServer().catch((err) => {
    logger.error('Failed to start HTTP server', { error: String(err) });
    process.exit(1);
  });
}
