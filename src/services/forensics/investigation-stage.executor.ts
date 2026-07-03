/**
 * Fault-tolerant stage execution for Unified Investigation.
 * No stage may throw an uncaught exception to the caller.
 */
import { logger } from '../../lib/logger';
import { withTimeoutSoft } from '../../lib/safe-runner';
import type {
  InvestigationStageResult,
  StageExecutorOptions,
} from '../../types/investigation-stage.types';

function nowMs(): number {
  return Date.now();
}

/**
 * Execute a single investigation stage inside try/catch + optional timeout.
 */
export async function executeStage<T>(
  stage: string,
  fn: () => Promise<T>,
  options?: StageExecutorOptions,
): Promise<InvestigationStageResult<T>> {
  const started = nowMs();
  const timeoutMs = options?.timeoutMs ?? 30_000;

  try {
    const data = timeoutMs > 0
      ? await withTimeoutSoft(fn, timeoutMs, stage)
      : await fn();

    if (data === null && timeoutMs > 0) {
      const result: InvestigationStageResult<T> = {
        stage,
        success: false,
        durationMs: nowMs() - started,
        data: null,
        error: `Stage timed out after ${timeoutMs}ms`,
      };
      logger.warn('[InvestigationStage] Timeout', { stage, durationMs: result.durationMs });
      options?.onComplete?.(result);
      return result;
    }

    const result: InvestigationStageResult<T> = {
      stage,
      success: true,
      durationMs: nowMs() - started,
      data: data as T,
      error: null,
    };
    options?.onComplete?.(result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: InvestigationStageResult<T> = {
      stage,
      success: false,
      durationMs: nowMs() - started,
      data: null,
      error: message,
    };
    logger.error('[InvestigationStage] Failed', { stage, error: message, durationMs: result.durationMs });
    options?.onComplete?.(result);
    return result;
  }
}

/**
 * Run independent stages in parallel — each isolated; failures do not reject the batch.
 */
export async function executeStagesParallel<T extends Record<string, unknown>>(
  stages: Array<{
    name: keyof T & string;
    fn: () => Promise<unknown>;
    timeoutMs?: number;
  }>,
  options?: { onEachComplete?: (result: InvestigationStageResult) => void },
): Promise<{ results: Record<string, InvestigationStageResult>; durationMs: number }> {
  const started = nowMs();
  const settled = await Promise.all(
    stages.map((s) =>
      executeStage(s.name, s.fn, {
        timeoutMs: s.timeoutMs,
        onComplete: options?.onEachComplete,
      }),
    ),
  );

  const results: Record<string, InvestigationStageResult> = {};
  for (const r of settled) {
    results[r.stage] = r;
  }

  return { results, durationMs: nowMs() - started };
}

/** Synchronous stage wrapper (e.g. tamper analysis) */
export function executeStageSync<T>(
  stage: string,
  fn: () => T,
  options?: Pick<StageExecutorOptions, 'onComplete'>,
): InvestigationStageResult<T> {
  const started = nowMs();
  try {
    const data = fn();
    const result: InvestigationStageResult<T> = {
      stage,
      success: true,
      durationMs: nowMs() - started,
      data,
      error: null,
    };
    options?.onComplete?.(result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: InvestigationStageResult<T> = {
      stage,
      success: false,
      durationMs: nowMs() - started,
      data: null,
      error: message,
    };
    logger.error('[InvestigationStage] Sync failed', { stage, error: message });
    options?.onComplete?.(result);
    return result;
  }
}
