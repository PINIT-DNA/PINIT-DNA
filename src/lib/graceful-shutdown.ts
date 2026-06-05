/**
 * PINIT-DNA — Graceful Shutdown Handler (Phase 6)
 *
 * Handles SIGTERM and SIGINT signals:
 *   1. Stop accepting new connections
 *   2. Complete in-flight requests (30s timeout)
 *   3. Stop scheduled tasks
 *   4. Close DB connection
 *   5. Exit cleanly
 */

import http from 'http';
import { logger } from './logger';
import { prisma } from './prisma';
import { vaultScheduler } from '../services/scheduler/vault-scheduler.service';
import { stopPythonAI } from './python-ai-process';

const SHUTDOWN_TIMEOUT_MS = 30_000;

export function registerGracefulShutdown(server: http.Server): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal} — starting graceful shutdown`, { timeoutMs: SHUTDOWN_TIMEOUT_MS });

    const shutdownTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      // 1. Stop accepting new connections
      await new Promise<void>((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
      });
      logger.info('HTTP server closed — no new connections accepted');

      // 2. Stop scheduled tasks
      vaultScheduler.stop();
      logger.info('Scheduled tasks stopped');

      // 3. Stop Python AI child process
      stopPythonAI();

      // 3. Close DB connection
      await prisma.$disconnect();
      logger.info('Database connection closed');

      clearTimeout(shutdownTimer);
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: String(err) });
      clearTimeout(shutdownTimer);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
}
