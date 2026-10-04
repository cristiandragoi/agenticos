/**
 * LatencyTracker.ts — Turn-Level Latency Instrumentation & Performance Budgets
 *
 * PHASE 5 CONTROL-PLANE COMPONENT
 *
 * Instruments every turn with exact stage timings:
 * - STT_FINAL_MS
 * - INTENT_COMPILE_MS
 * - CONTEXT_RESOLUTION_MS
 * - TARGET_RESOLUTION_MS
 * - CAPABILITY_SELECTION_MS
 * - CAPABILITY_EXECUTION_MS
 * - VERIFICATION_MS
 * - LLM_RESPONSE_MS
 * - TTS_START_MS
 * - TOTAL_RESPONSE_MS
 *
 * Records:
 * - acquisitionMethod
 * - fallbackCount
 * - visionUsed
 * - llmUsed
 * - targetVerified
 *
 * Performance Budgets (Direct / Deterministic):
 * - Intent compilation: < 50 ms
 * - Context lookup: < 20 ms
 * - Known app/window target resolution: < 500 ms
 * - Structured content extraction: < 1000 ms
 * - Simple OPEN_APPLICATION: < 1500 ms
 * - Simple verified READ_CONTENT using UIA/DOM: < 2500 ms
 */

import { logger } from '../../utils/logger.js';

export interface TurnLatencyMetrics {
  readonly turnId: string;
  readonly correlationId: string;
  sttFinalMs: number;
  intentCompileMs: number;
  contextResolutionMs: number;
  targetResolutionMs: number;
  capabilitySelectionMs: number;
  capabilityExecutionMs: number;
  verificationMs: number;
  llmResponseMs: number;
  ttsStartMs: number;
  totalResponseMs: number;

  // Acquisition and Model Usage Details
  acquisitionMethod: string;
  fallbackCount: number;
  visionUsed: boolean;
  llmUsed: boolean;
  targetVerified: boolean;

  // Metadata
  completedAt?: number;
  exceededBudgets: string[];
}

export class LatencyTracker {
  private static instance: LatencyTracker;
  private readonly records: Map<string, TurnLatencyMetrics> = new Map();
  private readonly activeTimers: Map<string, Map<string, number>> = new Map();

  // Performance Budgets (ms)
  public static readonly BUDGETS = {
    INTENT_COMPILE_MS: 50,
    CONTEXT_RESOLUTION_MS: 20,
    TARGET_RESOLUTION_MS: 500,
    STRUCTURED_EXTRACTION_MS: 1000,
    OPEN_APPLICATION_MS: 1500,
    VERIFIED_READ_CONTENT_MS: 2500,
  } as const;

  private constructor() {}

  public static getInstance(): LatencyTracker {
    if (!LatencyTracker.instance) {
      LatencyTracker.instance = new LatencyTracker();
    }
    return LatencyTracker.instance;
  }

  public initTurn(turnId: string, correlationId: string = `corr-${Date.now()}`): TurnLatencyMetrics {
    const initial: TurnLatencyMetrics = {
      turnId,
      correlationId,
      sttFinalMs: 0,
      intentCompileMs: 0,
      contextResolutionMs: 0,
      targetResolutionMs: 0,
      capabilitySelectionMs: 0,
      capabilityExecutionMs: 0,
      verificationMs: 0,
      llmResponseMs: 0,
      ttsStartMs: 0,
      totalResponseMs: 0,
      acquisitionMethod: 'none',
      fallbackCount: 0,
      visionUsed: false,
      llmUsed: false,
      targetVerified: false,
      exceededBudgets: [],
    };
    this.records.set(turnId, initial);
    this.activeTimers.set(turnId, new Map());
    return initial;
  }

  public startStage(turnId: string, stageName: string): void {
    let timers = this.activeTimers.get(turnId);
    if (!timers) {
      timers = new Map();
      this.activeTimers.set(turnId, timers);
    }
    timers.set(stageName, performance.now());
  }

  public endStage(turnId: string, stageName: string): number {
    const timers = this.activeTimers.get(turnId);
    const start = timers?.get(stageName);
    if (start === undefined) return 0;
    const duration = Math.round(performance.now() - start);
    timers?.delete(stageName);

    const record = this.records.get(turnId);
    if (record) {
      switch (stageName) {
        case 'STT_FINAL_MS':
          record.sttFinalMs = duration;
          break;
        case 'INTENT_COMPILE_MS':
          record.intentCompileMs = duration;
          if (duration > LatencyTracker.BUDGETS.INTENT_COMPILE_MS) {
            record.exceededBudgets.push(`INTENT_COMPILE_MS (${duration}ms > ${LatencyTracker.BUDGETS.INTENT_COMPILE_MS}ms)`);
          }
          break;
        case 'CONTEXT_RESOLUTION_MS':
          record.contextResolutionMs = duration;
          if (duration > LatencyTracker.BUDGETS.CONTEXT_RESOLUTION_MS) {
            record.exceededBudgets.push(`CONTEXT_RESOLUTION_MS (${duration}ms > ${LatencyTracker.BUDGETS.CONTEXT_RESOLUTION_MS}ms)`);
          }
          break;
        case 'TARGET_RESOLUTION_MS':
          record.targetResolutionMs = duration;
          if (duration > LatencyTracker.BUDGETS.TARGET_RESOLUTION_MS) {
            record.exceededBudgets.push(`TARGET_RESOLUTION_MS (${duration}ms > ${LatencyTracker.BUDGETS.TARGET_RESOLUTION_MS}ms)`);
          }
          break;
        case 'CAPABILITY_SELECTION_MS':
          record.capabilitySelectionMs = duration;
          break;
        case 'CAPABILITY_EXECUTION_MS':
          record.capabilityExecutionMs = duration;
          break;
        case 'VERIFICATION_MS':
          record.verificationMs = duration;
          break;
        case 'LLM_RESPONSE_MS':
          record.llmResponseMs = duration;
          break;
        case 'TTS_START_MS':
          record.ttsStartMs = duration;
          break;
        case 'TOTAL_RESPONSE_MS':
          record.totalResponseMs = duration;
          break;
      }
    }

    return duration;
  }

  public recordDirectMetric(turnId: string, metric: Partial<TurnLatencyMetrics>): void {
    const existing = this.records.get(turnId) || this.initTurn(turnId);
    Object.assign(existing, metric);
  }

  public finalizeTurn(turnId: string, totalMs?: number): TurnLatencyMetrics {
    const record = this.records.get(turnId) || this.initTurn(turnId);
    if (totalMs !== undefined) {
      record.totalResponseMs = totalMs;
      record.totalResponseMs = Math.max(
        1,
        record.intentCompileMs +
        record.contextResolutionMs +
        record.targetResolutionMs +
        record.capabilitySelectionMs +
        record.capabilityExecutionMs +
        record.verificationMs +
        record.llmResponseMs
      );
    }
    record.totalResponseMs = Math.max(1, record.totalResponseMs);
    record.completedAt = Date.now();

    logger.info('[LatencyTracker] Turn completed with metrics:', {
      turnId,
      totalResponseMs: record.totalResponseMs,
      acquisitionMethod: record.acquisitionMethod,
      visionUsed: record.visionUsed,
      llmUsed: record.llmUsed,
      targetVerified: record.targetVerified,
      exceededBudgets: record.exceededBudgets,
    });

    return record;
  }

  public getTurnMetrics(turnId: string): TurnLatencyMetrics | undefined {
    return this.records.get(turnId);
  }

  public getAllMetrics(): TurnLatencyMetrics[] {
    return Array.from(this.records.values());
  }

  public calculateStats(): {
    count: number;
    averageByStage: Record<string, number>;
    medianTotal: number;
    p95Total: number;
    visionFallbackCount: number;
    llmCallCount: number;
  } {
    const all = Array.from(this.records.values()).filter(r => r.completedAt !== undefined);
    if (all.length === 0) {
      return {
        count: 0,
        averageByStage: {
          STT_FINAL_MS: 0,
          INTENT_COMPILE_MS: 0,
          CONTEXT_RESOLUTION_MS: 0,
          TARGET_RESOLUTION_MS: 0,
          CAPABILITY_SELECTION_MS: 0,
          CAPABILITY_EXECUTION_MS: 0,
          VERIFICATION_MS: 0,
          LLM_RESPONSE_MS: 0,
          TTS_START_MS: 0,
          TOTAL_RESPONSE_MS: 0,
        },
        medianTotal: 0,
        p95Total: 0,
        visionFallbackCount: 0,
        llmCallCount: 0,
      };
    }

    const totals = all.map(r => r.totalResponseMs).sort((a, b) => a - b);
    const median = totals[Math.floor(totals.length / 2)] || 0;
    const p95Idx = Math.min(totals.length - 1, Math.floor(totals.length * 0.95));
    const p95 = totals[p95Idx] || 0;

    const sum = (fn: (r: TurnLatencyMetrics) => number) =>
      Math.round(all.reduce((acc, r) => acc + fn(r), 0) / all.length);

    return {
      count: all.length,
      averageByStage: {
        STT_FINAL_MS: sum(r => r.sttFinalMs),
        INTENT_COMPILE_MS: sum(r => r.intentCompileMs),
        CONTEXT_RESOLUTION_MS: sum(r => r.contextResolutionMs),
        TARGET_RESOLUTION_MS: sum(r => r.targetResolutionMs),
        CAPABILITY_SELECTION_MS: sum(r => r.capabilitySelectionMs),
        CAPABILITY_EXECUTION_MS: sum(r => r.capabilityExecutionMs),
        VERIFICATION_MS: sum(r => r.verificationMs),
        LLM_RESPONSE_MS: sum(r => r.llmResponseMs),
        TTS_START_MS: sum(r => r.ttsStartMs),
        TOTAL_RESPONSE_MS: sum(r => r.totalResponseMs),
      },
      medianTotal: median,
      p95Total: p95,
      visionFallbackCount: all.filter(r => r.visionUsed).length,
      llmCallCount: all.filter(r => r.llmUsed).length,
    };
  }

  public reset(): void {
    this.records.clear();
    this.activeTimers.clear();
  }
}

export const latencyTracker = LatencyTracker.getInstance();
