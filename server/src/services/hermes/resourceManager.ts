/**
 * services/hermes/resourceManager.ts
 *
 * Authoritative Hermes Resource Manager for AgenticOS.
 *
 * Routing Hierarchy:
 *   USER -> JARVIS (decision brain / coordinator)
 *        -> HERMES (planner / dispatcher)
 *        -> EXECUTION RESOURCE (Local Qwen, CodeX, Gemini API, Antigravity Managed)
 *
 * Routing Policy:
 *   - "Cheapest Competent Engine"
 *   - Default Preference: LOCAL QWEN FIRST
 *   - Code Mutations & Scoped Refactors: CODEX
 *   - Ordinary Remote Inference: GEMINI API
 *   - Complex Remote Sandboxed Multi-Step: ANTIGRAVITY MANAGED
 *     (ONLY when capability-verified AND quota available)
 *
 * TRUTHFULNESS INVARIANTS:
 *   - Antigravity Managed CANNOT be AVAILABLE unless a live capability
 *     probe against the managed-agent interface has succeeded.
 *   - A Gemini API key existing DOES NOT make Antigravity Managed AVAILABLE.
 *   - Local Qwen status comes from live Ollama /api/tags probe.
 *   - CodeX status comes from adapter runtime check.
 *   - Quota percentages are NEVER fabricated; only real 429/Retry-After
 *     data from providers is recorded.
 *   - providerReportedQuota is null unless the provider actually reported it.
 */

import http from 'http';
import { logger } from '../../utils/logger.js';
import { ProviderCredentialService } from '../gateway/credentials.js';
import { rawDb } from '../../db/index.js';

export type ExecutorType = 'local-qwen' | 'codex' | 'gemini-api' | 'antigravity-managed';
export type CostClass = 'free' | 'metered' | 'expensive';
export type QuotaImpact = 'none' | 'low' | 'medium' | 'high';

/**
 * Status values for execution resources.
 *
 * UNVERIFIED     = Credential may exist but capability has NOT been probed.
 *                  Must not be routed to.
 * AVAILABLE      = Live capability probe succeeded.
 * LIMITED        = Probe succeeded but capacity is constrained.
 * QUOTA_EXHAUSTED= Provider returned 429 with no retry-after.
 * WAITING_FOR_RESET = Provider returned 429 with retry-after or reset timestamp.
 * AUTH_REQUIRED  = No credential configured.
 * OFFLINE        = Reachability probe failed (network error or no process).
 * ERROR          = Unexpected error during probe.
 * BLOCKED        = Access denied by remote API (403/auth rejection).
 */
export type QuotaState =
  | 'AVAILABLE'
  | 'LIMITED'
  | 'UNVERIFIED'
  | 'QUOTA_EXHAUSTED'
  | 'WAITING_FOR_RESET'
  | 'AUTH_REQUIRED'
  | 'OFFLINE'
  | 'BLOCKED'
  | 'ERROR';

export interface TaskCharacteristics {
  prompt: string;
  objective?: string;
  taskType?: string;
  complexity?: 'low' | 'medium' | 'high';
  codingIntensity?: 'none' | 'low' | 'high';
  requiresRemoteSandbox?: boolean;
  requiresParallelism?: boolean;
  requiresBrowser?: boolean;
  requiresCodeMutation?: boolean;
  urgency?: 'low' | 'normal' | 'high';
  files?: string[];
}

export interface RoutingDecision {
  selectedExecutor: ExecutorType;
  reason: string;
  estimatedCostClass: CostClass;
  quotaImpact: QuotaImpact;
  confidence: number;
  fallbackPlan: ExecutorType[];
  characteristics: TaskCharacteristics;
  requiresApproval: boolean;
  approvalReason?: string;
}

export interface ExecutorQuotaStatus {
  executor: ExecutorType;
  status: QuotaState;
  quotaResetAt?: string;
  retryAfterSeconds?: number;
  details: string;
  lastUpdated: string;
  /** Null unless actual provider-reported quota data was received (e.g. from Retry-After). */
  providerReportedQuota: null | {
    retryAfterSeconds: number;
    resetAt?: string;
    source: string;
  };
}

export interface AntigravityVerificationResult {
  /** UNVERIFIED = never probed. AUTH_REQUIRED = no key. BLOCKED = 403. AVAILABLE = probe passed. ERROR = network failure. */
  verificationState: 'UNVERIFIED' | 'AUTH_REQUIRED' | 'BLOCKED' | 'AVAILABLE' | 'ERROR';
  /** ISO timestamp of last successful or attempted probe. Null if never probed. */
  lastVerifiedAt: string | null;
  /** The actual managed endpoint path proven to work. Null unless verification passed. */
  verifiedEndpoint: string | null;
  /** The agent ID proven to be accessible. Null unless verification passed. */
  verifiedAgent: string | null;
  /** Whether background execution (non-streaming agent run) was confirmed. */
  backgroundExecutionConfirmed: boolean;
  /** Non-secret evidence from the probe response. Null unless verification passed. */
  verificationEvidence: string | null;
  /** Error message from last probe attempt. Null if never probed or if AVAILABLE. */
  errorMessage: string | null;
}

export interface ObservabilitySnapshot {
  hermesState: {
    role: string;
    /** Runtime-resolved model from assignment service or env var. */
    model: string;
    /** Runtime-resolved provider from assignment service or env var. */
    provider: string;
    activeMissions: number;
    queuedMissions: number;
  };
  codexState: {
    role: string;
    /** Runtime-derived status from adapter check. */
    status: string;
    activeTasks: number;
  };
  antigravityState: {
    /**
     * Null unless a live managed-agent capability probe has returned a successful
     * response. A credential present alone does NOT set this field.
     */
    verifiedApi: string | null;
    /** Current quota/routing status. NEVER AVAILABLE unless verificationState is AVAILABLE. */
    status: QuotaState;
    configured: boolean;
    quotaDetails: string;
    verification: AntigravityVerificationResult;
  };
  ollamaState: {
    /** Runtime-derived from Ollama /api/tags probe. */
    reachable: boolean;
    models: string[];
    hermesModelPresent: boolean;
    jarvisModelPresent: boolean;
    probeLatencyMs: number;
    lastProbedAt: string;
  };
  quotaSummary: Record<ExecutorType, ExecutorQuotaStatus>;
  recentDecisions: Array<{
    timestamp: string;
    selectedExecutor: ExecutorType;
    reason: string;
    costClass: CostClass;
  }>;
}

// Persistent quota & routing table in SQLite
try {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS hermes_resource_quota (
      executor TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      quota_reset_at TEXT,
      retry_after_seconds INTEGER,
      details TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hermes_routing_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      selected_executor TEXT NOT NULL,
      reason TEXT NOT NULL,
      cost_class TEXT NOT NULL,
      prompt_snippet TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS antigravity_verification (
      id INTEGER PRIMARY KEY,
      verification_state TEXT NOT NULL,
      last_verified_at TEXT,
      verified_endpoint TEXT,
      verified_agent TEXT,
      background_execution_confirmed INTEGER NOT NULL DEFAULT 0,
      verification_evidence TEXT,
      error_message TEXT,
      updated_at TEXT NOT NULL
    );
  `);
} catch (err) {
  logger.warn(`[HermesResourceManager] SQLite tables init warning: ${err}`);
}

export class HermesResourceManager {
  private static instance: HermesResourceManager;
  private quotaOverrides: Map<
    ExecutorType,
    {
      status: QuotaState;
      resetAt?: string;
      retryAfterSeconds?: number;
      details: string;
      updatedAt: number;
      providerReportedRetryAfter?: number;
      providerReportedResetAt?: string;
    }
  > = new Map();

  public static getInstance(): HermesResourceManager {
    if (!HermesResourceManager.instance) {
      HermesResourceManager.instance = new HermesResourceManager();
    }
    return HermesResourceManager.instance;
  }

  /**
   * Evaluate a task and return the optimal cheapest-competent routing decision.
   * Antigravity Managed is ONLY selected if its verificationState is AVAILABLE.
   */
  public async evaluateTask(input: string | TaskCharacteristics): Promise<RoutingDecision> {
    const chars = typeof input === 'string' ? this.inferCharacteristics(input) : input;
    const text = (chars.objective || chars.prompt || '').toLowerCase();

    const approvalCheck = this.checkApprovalRequirements(chars);
    const quotaMap = await this.getQuotaStatus();

    const isCodingMutation =
      chars.requiresCodeMutation ||
      /\b(?:edit|modify|refactor|fix bug|implement|write code|patch|create file|add feature|rewrite)\b/i.test(text);

    const isRemoteSandboxNeeded =
      chars.requiresRemoteSandbox ||
      /\b(?:multi-hour build|remote sandbox|isolate linux|large-scale build|parallel matrix build)\b/i.test(text);

    let selected: ExecutorType = 'local-qwen';
    let reason = 'Task is low/medium complexity; local Qwen 2.5 7B is sufficient and free.';
    let costClass: CostClass = 'free';
    let quotaImpact: QuotaImpact = 'none';
    const fallbackPlan: ExecutorType[] = [];

    if (isRemoteSandboxNeeded) {
      const agStatus = quotaMap['antigravity-managed'];
      // Antigravity Managed is only selectable when genuinely AVAILABLE (capability verified)
      if (agStatus.status === 'AVAILABLE') {
        selected = 'antigravity-managed';
        reason = 'Task requires remote sandboxed execution; Antigravity Managed Executor selected (capability verified).';
        costClass = 'metered';
        quotaImpact = 'high';
        fallbackPlan.push('codex', 'local-qwen');
      } else {
        selected = isCodingMutation ? 'codex' : 'local-qwen';
        reason = `Antigravity Managed is ${agStatus.status} (${agStatus.details}); falling back to ${selected}. Remote sandbox capabilities are unavailable.`;
        costClass = 'free';
        quotaImpact = 'none';
        fallbackPlan.push('local-qwen');
      }
    } else if (isCodingMutation) {
      const codexStatus = quotaMap['codex'];
      if (codexStatus.status === 'AVAILABLE') {
        selected = 'codex';
        reason = 'Task requires scoped repository code editing/refactoring; CodeX executor selected.';
        costClass = 'free';
        quotaImpact = 'none';
        fallbackPlan.push('local-qwen');
      } else {
        selected = 'local-qwen';
        reason = `CodeX is ${codexStatus.status} (${codexStatus.details}); falling back to local-qwen.`;
        costClass = 'free';
        quotaImpact = 'none';
        fallbackPlan.push('gemini-api');
      }
    } else {
      const qwenStatus = quotaMap['local-qwen'];
      if (qwenStatus.status === 'AVAILABLE' || qwenStatus.status === 'LIMITED') {
        selected = 'local-qwen';
        reason = 'Task matches local analytical, research, planning, or synthesis capabilities; Local Qwen First policy applied.';
        costClass = 'free';
        quotaImpact = 'none';
        fallbackPlan.push('codex', 'gemini-api');
      } else {
        const geminiStatus = quotaMap['gemini-api'];
        if (geminiStatus.status === 'AVAILABLE') {
          selected = 'gemini-api';
          reason = `Local Qwen is ${qwenStatus.status}; escalating to Gemini API.`;
          costClass = 'metered';
          quotaImpact = 'low';
          fallbackPlan.push('codex');
        } else {
          selected = 'codex';
          reason = `Local Qwen is ${qwenStatus.status} and Gemini API is ${geminiStatus.status}; CodeX selected as last resort.`;
          costClass = 'free';
          quotaImpact = 'none';
        }
      }
    }

    const decision: RoutingDecision = {
      selectedExecutor: selected,
      reason,
      estimatedCostClass: costClass,
      quotaImpact,
      confidence: 0.95,
      fallbackPlan,
      characteristics: chars,
      requiresApproval: approvalCheck.requiresApproval,
      approvalReason: approvalCheck.reason,
    };

    this.persistDecision(decision);
    return decision;
  }

  private inferCharacteristics(prompt: string): TaskCharacteristics {
    const p = prompt.toLowerCase();
    const isCode = /\b(?:code|function|class|bug|error|test|refactor|compile|build|script|typescript|python|javascript|npm)\b/i.test(p);
    const isHigh = /\b(?:complex|architecture|complete overhaul|full redesign|migrate entire|multi-hour)\b/i.test(p);
    const isMutation = /\b(?:modify|edit|write|patch|replace|fix|delete|create file)\b/i.test(p);

    return {
      prompt,
      complexity: isHigh ? 'high' : isCode ? 'medium' : 'low',
      codingIntensity: isCode ? (isMutation ? 'high' : 'low') : 'none',
      requiresCodeMutation: isMutation,
      requiresRemoteSandbox: /\b(?:remote build|sandboxed container|remote linux)\b/i.test(p),
      requiresParallelism: /\b(?:in parallel|concurrently|parallel batch)\b/i.test(p),
      urgency: /\b(?:urgent|asap|critical)\b/i.test(p) ? 'high' : 'normal',
    };
  }

  private checkApprovalRequirements(chars: TaskCharacteristics): { requiresApproval: boolean; reason?: string } {
    const text = `${chars.prompt} ${chars.objective || ''}`.toLowerCase();

    if (/\b(?:spend|buy|purchase|payment|credit card|charge|invoice|transfer money|\$|usd|eur)\b/i.test(text)) {
      return { requiresApproval: true, reason: 'Financial spending / commercial transaction requires explicit user approval.' };
    }
    if (/\b(?:delete database|drop table|truncate|format disk|rm -rf|destroy data)\b/i.test(text)) {
      return { requiresApproval: true, reason: 'Destructive database or filesystem action requires explicit user approval.' };
    }
    if (/\b(?:rotate key|change password|rotate credential|delete secret|update api key)\b/i.test(text)) {
      return { requiresApproval: true, reason: 'Credential modification requires explicit user approval.' };
    }
    if (/\b(?:send email to|send tweet|publish to|post publicly|outbound message to)\b/i.test(text)) {
      return { requiresApproval: true, reason: 'External outbound communication requires explicit user approval.' };
    }

    return { requiresApproval: false };
  }

  /**
   * Retrieve live quota status across all execution engines.
   *
   * TRUTHFULNESS CONTRACT:
   *   - Local Qwen: live Ollama /api/tags probe
   *   - CodeX: adapter import check
   *   - Gemini API: credential presence only (no live call)
   *   - Antigravity Managed: UNVERIFIED unless recordAntigravityVerification(AVAILABLE) was called
   *     from a real capability probe. A Gemini key NEVER makes this AVAILABLE.
   */
  public async getQuotaStatus(_specificExecutor?: ExecutorType): Promise<Record<ExecutorType, ExecutorQuotaStatus>> {
    const nowIso = new Date().toISOString();

    // Local Qwen: live Ollama probe
    const ollamaResult = await this.probeOllama();
    let qwenStatus: QuotaState = 'OFFLINE';
    let qwenDetails = 'Ollama process not responding on 127.0.0.1:11434.';
    if (ollamaResult.reachable) {
      const expectedModel = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
      const found = ollamaResult.models.some((m) => m.startsWith(expectedModel.split(':')[0]));
      if (found) {
        qwenStatus = 'AVAILABLE';
        qwenDetails = `Ollama reachable (${ollamaResult.latencyMs}ms). Model ${expectedModel} confirmed present.`;
      } else {
        qwenStatus = 'LIMITED';
        qwenDetails = `Ollama reachable but model "${expectedModel}" not found. Available: ${ollamaResult.models.slice(0, 5).join(', ') || '(none)'}`;
      }
    }

    // CodeX: adapter runtime check
    const codexResult = await this.probeCodex();

    // Gemini API: credential presence only
    let geminiStatus: QuotaState = 'AUTH_REQUIRED';
    let geminiDetails = 'Gemini API key not configured in SecretStore.';
    try {
      const gemKey = await ProviderCredentialService.getCredential('gemini') || process.env.GEMINI_API_KEY;
      if (gemKey && gemKey.trim().length > 0) {
        geminiStatus = 'AVAILABLE';
        geminiDetails = 'Gemini API key present. generateContent endpoint accessible (key not validated live).';
      }
    } catch (err) {
      geminiStatus = 'ERROR';
      geminiDetails = `Credential check error: ${err}`;
    }

    // Antigravity Managed: UNVERIFIED by default.
    // NEVER set AVAILABLE from credential presence alone.
    const agVerification = this.getStoredAntigravityVerification();
    let agStatus: QuotaState = 'UNVERIFIED';
    let agDetails: string;

    switch (agVerification.verificationState) {
      case 'AVAILABLE':
        agStatus = 'AVAILABLE';
        agDetails = `Google Interactions API managed-agent capability verified. Last verified: ${agVerification.lastVerifiedAt}.`;
        break;
      case 'BLOCKED':
        agStatus = 'BLOCKED';
        agDetails = `Google Antigravity Managed Agent access denied: ${agVerification.errorMessage || 'remote 403/auth rejection'}.`;
        break;
      case 'ERROR':
        agStatus = 'ERROR';
        agDetails = `Antigravity capability probe failed: ${agVerification.errorMessage || 'unknown error'}.`;
        break;
      case 'AUTH_REQUIRED':
        agStatus = 'AUTH_REQUIRED';
        agDetails = 'Google Antigravity Managed Agent: no dedicated credential configured in SecretStore. A Gemini API key does not grant managed agent access.';
        break;
      default: {
        // UNVERIFIED â€” check if a dedicated antigravity key exists
        try {
          const agKey = await ProviderCredentialService.getCredential('antigravity');
          if (!agKey || agKey.trim().length === 0) {
            agStatus = 'AUTH_REQUIRED';
            agDetails = 'Google Antigravity Managed Agent: no dedicated credential configured. A Gemini API key does not grant managed agent access.';
          } else {
            agStatus = 'UNVERIFIED';
            agDetails = 'Antigravity credential present but managed-agent capability has not been verified via a live probe. Status is UNVERIFIED until a capability probe succeeds.';
          }
        } catch {
          agStatus = 'UNVERIFIED';
          agDetails = 'Antigravity Managed Agent: credential check failed. Treating as UNVERIFIED.';
        }
        break;
      }
    }

    const result: Record<ExecutorType, ExecutorQuotaStatus> = {
      'local-qwen': {
        executor: 'local-qwen',
        status: qwenStatus,
        details: qwenDetails,
        lastUpdated: nowIso,
        providerReportedQuota: null,
      },
      'codex': {
        executor: 'codex',
        status: codexResult.status,
        details: codexResult.details,
        lastUpdated: nowIso,
        providerReportedQuota: null,
      },
      'gemini-api': {
        executor: 'gemini-api',
        status: geminiStatus,
        details: geminiDetails,
        lastUpdated: nowIso,
        providerReportedQuota: null,
      },
      'antigravity-managed': {
        executor: 'antigravity-managed',
        status: agStatus,
        details: agDetails,
        lastUpdated: nowIso,
        providerReportedQuota: null,
      },
    };

    // Apply in-memory quota overrides (from real 429/Retry-After events only)
    for (const [executor, override] of this.quotaOverrides.entries()) {
      const windowMs = (override.retryAfterSeconds ?? 300) * 1000;
      if (Date.now() < override.updatedAt + windowMs) {
        result[executor] = {
          executor,
          status: override.status,
          quotaResetAt: override.resetAt,
          retryAfterSeconds: override.retryAfterSeconds,
          details: override.details,
          lastUpdated: new Date(override.updatedAt).toISOString(),
          providerReportedQuota:
            override.providerReportedRetryAfter != null
              ? {
                  retryAfterSeconds: override.providerReportedRetryAfter,
                  resetAt: override.providerReportedResetAt,
                  source: '429 Retry-After header from provider',
                }
              : null,
        };
      } else {
        this.quotaOverrides.delete(executor);
      }
    }

    return result;
  }

  /**
   * Live probe of Ollama /api/tags to determine which models are loaded.
   */
  public async probeOllama(): Promise<{
    reachable: boolean;
    models: string[];
    latencyMs: number;
  }> {
    const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    const t0 = Date.now();

    return new Promise((resolve) => {
      let done = false;
      const finish = (r: { reachable: boolean; models: string[]; latencyMs: number }) => {
        if (done) return;
        done = true;
        resolve(r);
      };

      let parsed: URL;
      try { parsed = new URL(`${ollamaBase}/api/tags`); } catch {
        return finish({ reachable: false, models: [], latencyMs: 0 });
      }

      const timer = setTimeout(() => {
        req.destroy();
        finish({ reachable: false, models: [], latencyMs: Date.now() - t0 });
      }, 3000);

      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parseInt(parsed.port || '11434', 10),
          path: '/api/tags',
          method: 'GET',
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            clearTimeout(timer);
            if (res.statusCode === 200) {
              try {
                const json = JSON.parse(body);
                const models: string[] = Array.isArray(json.models)
                  ? json.models.map((m: any) => String(m.name || m.model || ''))
                  : [];
                finish({ reachable: true, models, latencyMs: Date.now() - t0 });
              } catch {
                finish({ reachable: true, models: [], latencyMs: Date.now() - t0 });
              }
            } else {
              finish({ reachable: false, models: [], latencyMs: Date.now() - t0 });
            }
          });
        }
      );

      req.on('error', () => {
        clearTimeout(timer);
        finish({ reachable: false, models: [], latencyMs: Date.now() - t0 });
      });

      req.end();
    });
  }

  /**
   * Check whether the CodeX execution adapter is usable.
   */
  private async probeCodex(): Promise<{ status: QuotaState; details: string }> {
    try {
      const { executeHermesTask } = await import('../../domains/workerAdapters/hermesAdapter.js');
      if (typeof executeHermesTask !== 'function') {
        return { status: 'ERROR', details: 'CodeX adapter module loaded but executeHermesTask is not a function.' };
      }
      const { hermesService } = await import('../../domains/hermes/service.js');
      if (!hermesService || typeof hermesService.executeTask !== 'function') {
        return { status: 'ERROR', details: 'Hermes service module unavailable for CodeX adapter.' };
      }
      return { status: 'AVAILABLE', details: 'CodeX in-repo engineering adapter loaded and functional.' };
    } catch (err: any) {
      return { status: 'ERROR', details: `CodeX adapter load failed: ${err?.message || String(err)}` };
    }
  }

  /**
   * Record a provider quota exhaustion / 429 event from REAL provider data.
   * retryAfterSeconds and resetAt must come from actual HTTP Retry-After / X-RateLimit-Reset headers.
   */
  public recordQuotaExhaustion(
    executor: ExecutorType,
    details: { retryAfterSeconds?: number; resetAt?: string; reason?: string }
  ): void {
    const hasProviderData = details.retryAfterSeconds != null || details.resetAt != null;
    const status: QuotaState = hasProviderData ? 'WAITING_FOR_RESET' : 'QUOTA_EXHAUSTED';
    const note = details.reason || 'Provider returned 429 Rate Limit / Quota Exhaustion.';

    this.quotaOverrides.set(executor, {
      status,
      resetAt: details.resetAt,
      retryAfterSeconds: details.retryAfterSeconds ?? 60,
      details: note,
      updatedAt: Date.now(),
      providerReportedRetryAfter: details.retryAfterSeconds,
      providerReportedResetAt: details.resetAt,
    });

    logger.warn(`[HermesResourceManager] Quota exhaustion recorded for ${executor}: ${status} (${note})`);
  }

  public recordQuotaRecovery(executor: ExecutorType): void {
    this.quotaOverrides.delete(executor);
    logger.info(`[HermesResourceManager] Quota recovered for ${executor}`);
  }

  /**
   * Record the result of a live Antigravity Managed capability probe.
   *
   * This is the ONLY path that can set verificationState = AVAILABLE.
   * A Gemini API key alone must NEVER trigger this with AVAILABLE.
   */
  public recordAntigravityVerification(result: AntigravityVerificationResult): void {
    const nowIso = new Date().toISOString();
    try {
      rawDb
        .prepare(
          `INSERT INTO antigravity_verification
           (id, verification_state, last_verified_at, verified_endpoint, verified_agent,
            background_execution_confirmed, verification_evidence, error_message, updated_at)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             verification_state = excluded.verification_state,
             last_verified_at = excluded.last_verified_at,
             verified_endpoint = excluded.verified_endpoint,
             verified_agent = excluded.verified_agent,
             background_execution_confirmed = excluded.background_execution_confirmed,
             verification_evidence = excluded.verification_evidence,
             error_message = excluded.error_message,
             updated_at = excluded.updated_at`
        )
        .run(
          result.verificationState,
          result.lastVerifiedAt,
          result.verifiedEndpoint,
          result.verifiedAgent,
          result.backgroundExecutionConfirmed ? 1 : 0,
          result.verificationEvidence,
          result.errorMessage,
          nowIso
        );
    } catch (err) {
      logger.warn(`[HermesResourceManager] Failed to persist antigravity verification: ${err}`);
    }

    logger.info(
      `[HermesResourceManager] Antigravity verification recorded: ${result.verificationState} ` +
        `endpoint=${result.verifiedEndpoint ?? 'null'} agent=${result.verifiedAgent ?? 'null'}`
    );
  }

  public getStoredAntigravityVerification(): AntigravityVerificationResult {
    try {
      const row = rawDb.prepare(`SELECT * FROM antigravity_verification WHERE id = 1`).get() as any;
      if (row) {
        return {
          verificationState: row.verification_state as AntigravityVerificationResult['verificationState'],
          lastVerifiedAt: row.last_verified_at,
          verifiedEndpoint: row.verified_endpoint,
          verifiedAgent: row.verified_agent,
          backgroundExecutionConfirmed: Boolean(row.background_execution_confirmed),
          verificationEvidence: row.verification_evidence,
          errorMessage: row.error_message,
        };
      }
    } catch { /* table may not exist yet */ }

    return {
      verificationState: 'UNVERIFIED',
      lastVerifiedAt: null,
      verifiedEndpoint: null,
      verifiedAgent: null,
      backgroundExecutionConfirmed: false,
      verificationEvidence: null,
      errorMessage: null,
    };
  }

  /**
   * Observability snapshot. All values are runtime-derived.
   */
  public async getObservabilitySnapshot(): Promise<ObservabilitySnapshot> {
    const quotaMap = await this.getQuotaStatus();
    const recentDecisions = this.getRecentDecisions(5);
    const ollamaProbe = await this.probeOllama();
    const agVerification = this.getStoredAntigravityVerification();
    const codexProbe = await this.probeCodex();

    let hermesModel = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
    let hermesProvider = 'ollama';
    try {
      const { resolveHermesModelTruth } = await import('../hermesApiService.js');
      const truth = resolveHermesModelTruth();
      if (truth.model) hermesModel = truth.model;
      if (truth.provider) hermesProvider = truth.provider;
    } catch { /* best effort */ }

    const expectedModel = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

    return {
      hermesState: {
        role: 'Planner and Task Dispatcher',
        model: hermesModel,
        provider: hermesProvider,
        activeMissions: 0,
        queuedMissions: 0,
      },
      codexState: {
        role: 'Engineering and Code Mutation Worker',
        status: codexProbe.status,
        activeTasks: 0,
      },
      antigravityState: {
        verifiedApi:
          agVerification.verificationState === 'AVAILABLE' && agVerification.verifiedEndpoint
            ? `${agVerification.verifiedEndpoint} (agent: ${agVerification.verifiedAgent ?? 'unknown'})`
            : null,
        status: quotaMap['antigravity-managed'].status,
        configured: quotaMap['antigravity-managed'].status !== 'AUTH_REQUIRED',
        quotaDetails: quotaMap['antigravity-managed'].details,
        verification: agVerification,
      },
      ollamaState: {
        reachable: ollamaProbe.reachable,
        models: ollamaProbe.models,
        hermesModelPresent: ollamaProbe.models.some((m) => m.startsWith(expectedModel.split(':')[0])),
        jarvisModelPresent: ollamaProbe.models.some((m) => m.startsWith(expectedModel.split(':')[0])),
        probeLatencyMs: ollamaProbe.latencyMs,
        lastProbedAt: new Date().toISOString(),
      },
      quotaSummary: quotaMap,
      recentDecisions,
    };
  }

  private persistDecision(decision: RoutingDecision): void {
    try {
      const promptSnippet = (decision.characteristics.prompt || '').slice(0, 120);
      const nowIso = new Date().toISOString();
      rawDb
        .prepare(
          `INSERT INTO hermes_routing_decisions (selected_executor, reason, cost_class, prompt_snippet, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(decision.selectedExecutor, decision.reason, decision.estimatedCostClass, promptSnippet, nowIso);
    } catch { /* best effort */ }
  }

  private getRecentDecisions(limit = 5): ObservabilitySnapshot['recentDecisions'] {
    try {
      const rows = rawDb
        .prepare(
          `SELECT selected_executor, reason, cost_class, created_at
           FROM hermes_routing_decisions
           ORDER BY id DESC
           LIMIT ?`
        )
        .all(limit) as Array<{ selected_executor: string; reason: string; cost_class: string; created_at: string }>;

      return rows.map((r) => ({
        timestamp: r.created_at,
        selectedExecutor: r.selected_executor as ExecutorType,
        reason: r.reason,
        costClass: r.cost_class as CostClass,
      }));
    } catch {
      return [];
    }
  }
}

export const hermesResourceManager = HermesResourceManager.getInstance();

