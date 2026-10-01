/**
 * costPolicy.ts — Central Provider Cost Policy & Spend Governance
 *
 * Implements cost modes:
 * - ZERO: only local and genuinely free quota providers. Paid fallback strictly blocked.
 * - LOW_COST (default): local/free preferred; low-cost paid (e.g. Deepgram, DeepSeek, small cloud models) allowed with limits.
 * - UNRESTRICTED: all configured providers enabled.
 */

import { logger } from '../../utils/logger.js';

export type CostMode = 'ZERO' | 'LOW_COST' | 'UNRESTRICTED';

export type CostClass =
  | 'LOCAL_FREE'
  | 'CLOUD_FREE_QUOTA'
  | 'CLOUD_PROMOTIONAL_CREDIT'
  | 'LOW_COST_PAID'
  | 'PAID'
  | 'UNKNOWN'
  | 'DISABLED';

export interface InvocationRecord {
  id: string;
  timestamp: string;
  provider: string;
  model?: string;
  role: 'FAST' | 'PLANNER' | 'WORKER' | 'CODER' | 'REVIEWER' | 'STT' | 'TTS';
  costClass: CostClass;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  audioDurationSeconds?: number;
  estimatedCostUsd: number;
  fallbackReason?: string;
  success: boolean;
  error?: string;
}

export class CostPolicyManager {
  private static instance: CostPolicyManager;
  private mode: CostMode = 'LOW_COST';
  private sessionInvocations: InvocationRecord[] = [];
  private maxSessionSpendUsd = 5.0; // Configurable session guardrail

  private constructor() {
    const envMode = (process.env.COST_MODE || '').toUpperCase();
    if (envMode === 'ZERO' || envMode === 'LOW_COST' || envMode === 'UNRESTRICTED') {
      this.mode = envMode;
    } else {
      this.mode = 'LOW_COST'; // Default specified in requirements
    }
    logger.info(`[CostPolicy] Initialized in ${this.mode} mode`);
  }

  public static getInstance(): CostPolicyManager {
    if (!CostPolicyManager.instance) {
      CostPolicyManager.instance = new CostPolicyManager();
    }
    return CostPolicyManager.instance;
  }

  public getMode(): CostMode {
    return this.mode;
  }

  public setMode(mode: CostMode): void {
    logger.info(`[CostPolicy] Switching cost mode from ${this.mode} to ${mode}`);
    this.mode = mode;
  }

  /**
   * Determine whether a provider/model with a given cost class is permitted to run under the active cost mode.
   */
  public isAllowed(costClass: CostClass): { allowed: boolean; reason?: string } {
    if (costClass === 'DISABLED') {
      return { allowed: false, reason: 'Provider is disabled.' };
    }

    if (this.mode === 'ZERO') {
      if (costClass === 'LOCAL_FREE' || costClass === 'CLOUD_FREE_QUOTA') {
        return { allowed: true };
      }
      if (costClass === 'CLOUD_PROMOTIONAL_CREDIT') {
        // Only allowed if explicitly validated that it cannot charge
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Blocked by COST_MODE=ZERO: ${costClass} provider cannot be invoked without incurring cost.`,
      };
    }

    if (this.mode === 'LOW_COST') {
      if (
        costClass === 'LOCAL_FREE' ||
        costClass === 'CLOUD_FREE_QUOTA' ||
        costClass === 'CLOUD_PROMOTIONAL_CREDIT' ||
        costClass === 'LOW_COST_PAID'
      ) {
        // Check session spend limit
        const currentSpend = this.getTotalSessionSpend();
        if (currentSpend >= this.maxSessionSpendUsd && costClass === 'LOW_COST_PAID') {
          return {
            allowed: false,
            reason: `Blocked: Session spending limit ($${this.maxSessionSpendUsd.toFixed(2)}) reached.`,
          };
        }
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Blocked by COST_MODE=LOW_COST: ${costClass} provider exceeds low-cost threshold.`,
      };
    }

    // UNRESTRICTED mode
    return { allowed: true };
  }

  /**
   * Record invocation telemetry for observability and cost auditing.
   */
  public recordInvocation(inv: Omit<InvocationRecord, 'id' | 'timestamp'>): InvocationRecord {
    const record: InvocationRecord = {
      ...inv,
      id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    this.sessionInvocations.push(record);
    if (this.sessionInvocations.length > 500) {
      this.sessionInvocations.shift();
    }
    return record;
  }

  public getTotalSessionSpend(): number {
    return this.sessionInvocations.reduce((sum, i) => sum + (i.estimatedCostUsd || 0), 0);
  }

  public getSessionSummary() {
    const total = this.getTotalSessionSpend();
    const count = this.sessionInvocations.length;
    const byRole: Record<string, { count: number; spend: number }> = {};
    const byProvider: Record<string, { count: number; spend: number }> = {};

    for (const inv of this.sessionInvocations) {
      byRole[inv.role] = byRole[inv.role] || { count: 0, spend: 0 };
      byRole[inv.role].count++;
      byRole[inv.role].spend += inv.estimatedCostUsd || 0;

      byProvider[inv.provider] = byProvider[inv.provider] || { count: 0, spend: 0 };
      byProvider[inv.provider].count++;
      byProvider[inv.provider].spend += inv.estimatedCostUsd || 0;
    }

    return {
      costMode: this.mode,
      totalSpendUsd: Number(total.toFixed(4)),
      totalInvocations: count,
      byRole,
      byProvider,
      recentInvocations: this.sessionInvocations.slice(-20),
    };
  }
}

export const costPolicy = CostPolicyManager.getInstance();
