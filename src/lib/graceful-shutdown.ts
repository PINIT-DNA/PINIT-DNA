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

// Keep this below whatever the platform's own hard-kill timeout is (ECS task
// `stopTimeout` defaults to 30s too) so the app's own clean-exit path wins
// before the platform force-SIGKILLs. Override with SHUTDOWN_TIMEOUT_MS.
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] ?? '', 10) || 30_000;

// Behind an ALB, ECS sends SIGTERM to the container at roughly the same time
// it asks the ALB to deregister the target. Waiting this long before closing
// the HTTP server lets already-in-flight ALB-routed requests keep being
// accepted just long enough for the ALB to stop sending new ones. Defaults to
// 0 (no behavior change on the current, non-ALB deployment target); set
// SHUTDOWN_DRAIN_MS to 5000-10000 once running behind an ALB, and keep the
// target group's deregistration delay <= (ECS stopTimeout - this value).
const SHUTDOWN_DRAIN_MS = parseInt(process.env['SHUTDOWN_DRAIN_MS'] ?? '', 10) || 0;

let activeServer: http.Server | null = null;
let handlersRegistered = false;
let isShuttingDown = false;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      if (SHUTDOWN_DRAIN_MS > 0) {
        logger.info(`Draining for ${SHUTDOWN_DRAIN_MS}ms before closing the HTTP server`);
        await delay(SHUTDOWN_DRAIN_MS);
      }

      if (activeServer) {
        await new Promise<void>((resolve, reject) => {
          activeServer!.close((err) => (err ? reject(err) : resolve()));
        });
        activeServer = null;
        logger.info('HTTP server closed — port released');
      }

      vaultScheduler.stop();
      try {
        const { crawlerEngineService } = await import('../services/crawler/engine');
        crawlerEngineService.stop();
      } catch { /* engine optional */ }
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
