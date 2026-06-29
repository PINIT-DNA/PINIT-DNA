/**
 * PINIT-DNA — Graceful Shutdown Handler
 *
 * Registers once per process. Closes the HTTP server before exit so hot-reload
 * (ts-node-dev / nodemon) does not hit EADDRINUSE on the next start.
 */

import http from 'http';
import { logger } from './logger';
import { prisma } from './prisma';
import { vaultScheduler } from '../services/scheduler/vault-scheduler.service';
import { markPythonShuttingDown, stopPythonAI } from './python-ai-process';

const SHUTDOWN_TIMEOUT_MS = 30_000;

let activeServer: http.Server | null = null;
let handlersRegistered = false;
let isShuttingDown = false;

export function setActiveServer(server: http.Server): void {
  activeServer = server;
}

export function registerGracefulShutdown(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const shutdown = async (signal: string, options?: { reemitUsr2?: boolean }) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal} — starting graceful shutdown`, { timeoutMs: SHUTDOWN_TIMEOUT_MS });
    markPythonShuttingDown();

    const shutdownTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      if (activeServer) {
        await new Promise<void>((resolve, reject) => {
          activeServer!.close((err) => (err ? reject(err) : resolve()));
        });
        activeServer = null;
        logger.info('HTTP server closed — port released');
      }

      vaultScheduler.stop();
      stopPythonAI();

      await prisma.$disconnect();
      logger.info('Database connection closed');

      clearTimeout(shutdownTimer);
      logger.info('Graceful shutdown complete');

      if (options?.reemitUsr2) {
        process.kill(process.pid, 'SIGUSR2');
        return;
      }
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: String(err) });
      clearTimeout(shutdownTimer);
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  // nodemon restart signal — close server first, then allow nodemon to respawn
  process.once('SIGUSR2', () => { void shutdown('SIGUSR2', { reemitUsr2: true }); });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
}
