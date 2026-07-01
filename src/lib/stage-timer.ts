/**
 * Stage execution timer — logs per-stage durations for bottleneck analysis.
 */
import { logger } from './logger';

export interface StageTiming {
  stage: string;
  durationMs: number;
  detail?: string;
}

export class StageTimer {
  private readonly startedAt = Date.now();
  private readonly timings: StageTiming[] = [];
  private stageStarts = new Map<string, number>();

  start(stage: string): void {
    this.stageStarts.set(stage, Date.now());
  }

  end(stage: string, detail?: string): number {
    const started = this.stageStarts.get(stage) ?? this.startedAt;
    const durationMs = Date.now() - started;
    this.timings.push({ stage, durationMs, detail });
    this.stageStarts.delete(stage);
    return durationMs;
  }

  mark(stage: string, detail?: string): number {
    return this.end(stage, detail);
  }

  getTimings(): StageTiming[] {
    return [...this.timings];
  }

  totalMs(): number {
    return Date.now() - this.startedAt;
  }

  logSummary(prefix: string): void {
    const total = this.totalMs();
    logger.info(`[${prefix}] Stage timings`, {
      totalMs: total,
      stages: this.timings.map((t) => ({ stage: t.stage, ms: t.durationMs, detail: t.detail })),
    });
  }
}

export function createStageTimer(): StageTimer {
  return new StageTimer();
}
