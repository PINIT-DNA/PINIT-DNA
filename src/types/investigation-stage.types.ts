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
  /**
   * Phase 4.5 — if work finishes within this grace window after timeoutMs,
   * keep the result (never discard completed evidence).
   */
  retainGraceMs?: number;
  /** Emit SSE / log when stage completes */
  onComplete?: (result: InvestigationStageResult) => void;
}
