/**
 * Fault-tolerant investigation stage results.
 * Every pipeline stage returns this shape — never throws.
 */
export interface InvestigationStageResult<T = unknown> {
  stage: string;
  success: boolean;
  durationMs: number;
  data: T | null;
  error: string | null;
}

export interface StageExecutorOptions {
  timeoutMs?: number;
  /** Emit SSE / log when stage completes */
  onComplete?: (result: InvestigationStageResult) => void;
}
