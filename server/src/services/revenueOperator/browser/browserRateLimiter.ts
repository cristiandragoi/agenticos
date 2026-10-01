/**
 * browserRateLimiter.ts — Provider-account-scoped rate counters and cooldown management.
 *
 * Concurrency-safe sliding window rate limiter shared across all workers operating
 * on the same provider account.
 *
 * Deterministic only: load pacing and policy limits. Zero detection-evasion / jitter logic.
 */

export interface RateLimitCheckOptions {
  hourlyLimit?: number;
  dailyLimit?: number;
  minuteLimit?: number;
  actionLimit?: number; // max per hour for a specific action type
}

export interface RateLimitCheckResult {
  allowed: boolean;
  reasonCode?: string;
  reason?: string;
  retryAfterMs?: number;
}

interface AccountBucket {
  minuteTimestamps: number[];
  hourTimestamps: number[];
  dayTimestamps: number[];
  actionTimestamps: Map<string, number[]>;
  cooldownUntil: number | null;
  cooldownReason: string | null;
}

export class BrowserRateLimiter {
  private buckets = new Map<string, AccountBucket>();

  private getBucket(providerAccountId: string): AccountBucket {
    let bucket = this.buckets.get(providerAccountId);
    if (!bucket) {
      bucket = {
        minuteTimestamps: [],
        hourTimestamps: [],
        dayTimestamps: [],
        actionTimestamps: new Map(),
        cooldownUntil: null,
        cooldownReason: null,
      };
      this.buckets.set(providerAccountId, bucket);
    }
    return bucket;
  }

  private pruneTimestamps(timestamps: number[], windowMs: number, now: number): number[] {
    const cutoff = now - windowMs;
    // Keep only timestamps strictly greater than cutoff
    return timestamps.filter((t) => t > cutoff);
  }

  /**
   * Check whether a proposed action passes rate limits for the provider account.
   */
  checkLimit(
    providerAccountId: string,
    limits: RateLimitCheckOptions,
    actionType?: string,
    now: number = Date.now()
  ): RateLimitCheckResult {
    const bucket = this.getBucket(providerAccountId);

    // 1. Check Active Cooldown
    if (bucket.cooldownUntil && bucket.cooldownUntil > now) {
      const remainingMs = bucket.cooldownUntil - now;
      return {
        allowed: false,
        reasonCode: 'ACCOUNT_IN_COOLDOWN',
        reason: `Account is in cooldown until ${new Date(bucket.cooldownUntil).toISOString()}: ${bucket.cooldownReason || 'Rate limit triggered'}`,
        retryAfterMs: remainingMs,
      };
    } else if (bucket.cooldownUntil && bucket.cooldownUntil <= now) {
      // Cooldown expired
      bucket.cooldownUntil = null;
      bucket.cooldownReason = null;
    }

    // 2. Prune and check Minute Limit (if configured)
    if (limits.minuteLimit !== undefined && limits.minuteLimit > 0) {
      bucket.minuteTimestamps = this.pruneTimestamps(bucket.minuteTimestamps, 60 * 1000, now);
      if (bucket.minuteTimestamps.length >= limits.minuteLimit) {
        const oldest = bucket.minuteTimestamps[0];
        const retryAfterMs = Math.max(0, oldest + 60 * 1000 - now);
        return {
          allowed: false,
          reasonCode: 'RATE_LIMIT_MINUTE_EXCEEDED',
          reason: `Minute action limit reached (${bucket.minuteTimestamps.length}/${limits.minuteLimit})`,
          retryAfterMs,
        };
      }
    }

    // 3. Prune and check Hourly Limit
    if (limits.hourlyLimit !== undefined && limits.hourlyLimit > 0) {
      bucket.hourTimestamps = this.pruneTimestamps(bucket.hourTimestamps, 60 * 60 * 1000, now);
      if (bucket.hourTimestamps.length >= limits.hourlyLimit) {
        const oldest = bucket.hourTimestamps[0];
        const retryAfterMs = Math.max(0, oldest + 60 * 60 * 1000 - now);
        return {
          allowed: false,
          reasonCode: 'RATE_LIMIT_HOURLY_EXCEEDED',
          reason: `Hourly action limit reached (${bucket.hourTimestamps.length}/${limits.hourlyLimit})`,
          retryAfterMs,
        };
      }
    }

    // 4. Prune and check Daily Limit
    if (limits.dailyLimit !== undefined && limits.dailyLimit > 0) {
      bucket.dayTimestamps = this.pruneTimestamps(bucket.dayTimestamps, 24 * 60 * 60 * 1000, now);
      if (bucket.dayTimestamps.length >= limits.dailyLimit) {
        const oldest = bucket.dayTimestamps[0];
        const retryAfterMs = Math.max(0, oldest + 24 * 60 * 60 * 1000 - now);
        return {
          allowed: false,
          reasonCode: 'RATE_LIMIT_DAILY_EXCEEDED',
          reason: `Daily action limit reached (${bucket.dayTimestamps.length}/${limits.dailyLimit})`,
          retryAfterMs,
        };
      }
    }

    // 5. Check Action-Type-Specific Hourly Limit
    if (actionType && limits.actionLimit !== undefined && limits.actionLimit > 0) {
      const actionList = bucket.actionTimestamps.get(actionType) || [];
      const pruned = this.pruneTimestamps(actionList, 60 * 60 * 1000, now);
      bucket.actionTimestamps.set(actionType, pruned);

      if (pruned.length >= limits.actionLimit) {
        const oldest = pruned[0];
        const retryAfterMs = Math.max(0, oldest + 60 * 60 * 1000 - now);
        return {
          allowed: false,
          reasonCode: 'ACTION_RATE_LIMIT_EXCEEDED',
          reason: `Hourly limit for action '${actionType}' reached (${pruned.length}/${limits.actionLimit})`,
          retryAfterMs,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Atomically record an executed action for the provider account.
   */
  recordAction(providerAccountId: string, actionType?: string, now: number = Date.now()): void {
    const bucket = this.getBucket(providerAccountId);

    bucket.minuteTimestamps.push(now);
    bucket.hourTimestamps.push(now);
    bucket.dayTimestamps.push(now);

    if (actionType) {
      const list = bucket.actionTimestamps.get(actionType) || [];
      list.push(now);
      bucket.actionTimestamps.set(actionType, list);
    }
  }

  /**
   * Apply an explicit cooldown to the provider account.
   */
  setCooldown(providerAccountId: string, durationMs: number, reason: string, now: number = Date.now()): void {
    const bucket = this.getBucket(providerAccountId);
    bucket.cooldownUntil = now + durationMs;
    bucket.cooldownReason = reason;
  }

  /**
   * Check cooldown status for the account.
   */
  getCooldown(providerAccountId: string, now: number = Date.now()): { active: boolean; cooldownUntil?: string; reason?: string } {
    const bucket = this.getBucket(providerAccountId);
    if (bucket.cooldownUntil && bucket.cooldownUntil > now) {
      return {
        active: true,
        cooldownUntil: new Date(bucket.cooldownUntil).toISOString(),
        reason: bucket.cooldownReason || undefined,
      };
    }
    return { active: false };
  }

  /**
   * Get current counts for telemetry/testing.
   */
  getCounts(providerAccountId: string, now: number = Date.now()): { minute: number; hour: number; day: number } {
    const bucket = this.getBucket(providerAccountId);
    bucket.minuteTimestamps = this.pruneTimestamps(bucket.minuteTimestamps, 60 * 1000, now);
    bucket.hourTimestamps = this.pruneTimestamps(bucket.hourTimestamps, 60 * 60 * 1000, now);
    bucket.dayTimestamps = this.pruneTimestamps(bucket.dayTimestamps, 24 * 60 * 60 * 1000, now);

    return {
      minute: bucket.minuteTimestamps.length,
      hour: bucket.hourTimestamps.length,
      day: bucket.dayTimestamps.length,
    };
  }

  /**
   * Reset limits for an account or all accounts.
   */
  reset(providerAccountId?: string): void {
    if (providerAccountId) {
      this.buckets.delete(providerAccountId);
    } else {
      this.buckets.clear();
    }
  }
}

export const browserRateLimiter = new BrowserRateLimiter();
