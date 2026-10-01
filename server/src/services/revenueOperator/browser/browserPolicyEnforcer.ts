/**
 * browserPolicyEnforcer.ts — Central policy authorization engine for browser actions.
 *
 * Implements the 12-point policy evaluation pipeline for autonomous browser actions.
 *
 * Decisions:
 * - ALLOW: Action authorized; executes autonomously without human interruption.
 * - GATE: High-risk action paused; dispatches to revenueHumanGates mechanism.
 * - DENY: Action prohibited; blocked immediately with deterministic reasonCode.
 */

import { randomUUID } from 'crypto';
import type {
  ProposedBrowserAction,
  PolicyDecisionResult,
  ProviderAccountPolicy,
  DomainPolicyRule,
  CircuitBreakerState,
  ActionRiskCategory,
} from './types.js';
import { classifyBrowserAction } from './browserActionClassifier.js';
import { browserRateLimiter } from './browserRateLimiter.js';
import { browserPolicyRegistry } from './browserPolicyRegistry.js';

export interface PolicyEnforcerOptions {
  db?: any; // BetterSqlite3 database instance (optional for unit tests or standalone usage)
  policy?: ProviderAccountPolicy; // Explicit policy override
  circuitBreakerState?: CircuitBreakerState; // Explicit circuit breaker state
  isGlobalKillSwitchActive?: () => boolean; // Global kill switch probe
  recordRateLimitOnAllow?: boolean; // Automatically increment rate limits on ALLOW (default: true)
}

/**
 * Safely parse the hostname from a URL string.
 */
export function extractHostname(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Validate a target hostname against a configured domain rule.
 * Strict hostname check: avoids unsafe substring matching.
 */
export function isDomainAllowed(targetHostname: string, rule: string | DomainPolicyRule): boolean {
  const rawPattern = typeof rule === 'string' ? rule.toLowerCase() : rule.domain.toLowerCase();
  const allowSubdomains =
    typeof rule === 'string'
      ? rawPattern.startsWith('*.')
      : Boolean(rule.allowSubdomains || rawPattern.startsWith('*.'));

  const cleanPattern = rawPattern.replace(/^\*\./, '');

  // Exact hostname match
  if (targetHostname === cleanPattern) {
    return true;
  }

  // Subdomain match (e.g. api.paidlikes.de matching *.paidlikes.de)
  if (allowSubdomains) {
    if (targetHostname.endsWith('.' + cleanPattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether a target hostname matches any allowed domain rule.
 */
export function isHostnameInAllowedList(
  targetHostname: string,
  rules: (string | DomainPolicyRule)[]
): boolean {
  if (!rules || rules.length === 0) return false;
  return rules.some((rule) => isDomainAllowed(targetHostname, rule));
}

/**
 * Map an ActionRiskCategory to a canonical revenueHumanGates gateType.
 */
export function mapCategoryToGateType(category?: ActionRiskCategory): string {
  switch (category) {
    case 'CAPTCHA':
      return 'CAPTCHA';
    case 'KYC':
      return 'KYC';
    case 'PAYMENT':
    case 'PURCHASE':
    case 'PAYOUT':
      return 'PAYMENT_APPROVAL';
    case 'LEGAL_ACCEPTANCE':
      return 'LEGAL_REVIEW';
    case 'ACCOUNT_SECURITY':
    case 'CREDENTIAL':
    case 'EXTERNAL_REDIRECT':
    default:
      return 'PLATFORM_RESTRICTION';
  }
}

export class BrowserPolicyEnforcer {
  /**
   * Evaluate a proposed browser action against all 12 policy requirements.
   */
  async evaluateAction(
    action: ProposedBrowserAction,
    options: PolicyEnforcerOptions = {}
  ): Promise<PolicyDecisionResult> {
    const now = new Date().toISOString();
    const targetHostname = extractHostname(action.targetUrl) || 'invalid-domain';

    const baseResult = {
      workerId: action.workerId,
      providerAccountId: action.providerAccountId,
      providerId: action.providerId,
      actionType: action.actionType,
      targetDomain: targetHostname,
      timestamp: now,
    };

    // 1. Resolve Policy
    const policy =
      options.policy ||
      browserPolicyRegistry.getPolicy(action.providerId, action.providerAccountId) ||
      browserPolicyRegistry.getOrCreateDefaultPolicy(action.providerId, action.providerAccountId);

    // ── Check 1: Provider / Account Enabled ──────────────────────────────────
    if (policy.enabled === false) {
      return this.finalizeDecision(
        {
          ...baseResult,
          decision: 'DENY',
          reasonCode: 'ACCOUNT_DISABLED',
          reason: 'Provider account is disabled by policy',
        },
        action,
        policy,
        options
      );
    }

    // ── Check 2: Circuit Breaker Not OPEN ────────────────────────────────────
    const cbState = options.circuitBreakerState;
    if (cbState && cbState.tripped) {
      return this.finalizeDecision(
        {
          ...baseResult,
          decision: 'DENY',
          reasonCode: 'CIRCUIT_BREAKER_OPEN',
          reason: `Circuit breaker is OPEN for account: ${cbState.reason || 'Failure threshold reached'}`,
        },
        action,
        policy,
        options
      );
    }

    // ── Check 3: Global Kill Switch Not Active ──────────────────────────────
    if (options.isGlobalKillSwitchActive && options.isGlobalKillSwitchActive()) {
      return this.finalizeDecision(
        {
          ...baseResult,
          decision: 'DENY',
          reasonCode: 'GLOBAL_KILL_SWITCH_ACTIVE',
          reason: 'Global supervisor kill switch is active; all browser actions halted',
        },
        action,
        policy,
        options
      );
    }

    // ── Check 4: Allowed Target Domain (Strict Hostname Matching) ────────────
    if (!targetHostname || targetHostname === 'invalid-domain') {
      return this.finalizeDecision(
        {
          ...baseResult,
          decision: 'DENY',
          reasonCode: 'INVALID_TARGET_URL',
          reason: `Target URL '${action.targetUrl}' is invalid or missing hostname`,
        },
        action,
        policy,
        options
      );
    }

    const domainAllowed = isHostnameInAllowedList(targetHostname, policy.allowedDomains);
    if (!domainAllowed) {
      return this.finalizeDecision(
        {
          ...baseResult,
          decision: 'DENY',
          reasonCode: 'UNKNOWN_DOMAIN',
          reason: `Target hostname '${targetHostname}' is not in policy allowedDomains`,
        },
        action,
        policy,
        options
      );
    }

    // ── Check 5: Action Type Explicitly Allowed ──────────────────────────────
    const allowedActionTypes = policy.allowedActionTypes || [];
    const isActionTypeAllowed = allowedActionTypes.includes(action.actionType as any);
    if (!isActionTypeAllowed) {
      return this.finalizeDecision(
        {
          ...baseResult,
          decision: 'DENY',
          reasonCode: 'UNAUTHORIZED_ACTION_TYPE',
          reason: `Action type '${action.actionType}' is not permitted by policy`,
        },
        action,
        policy,
        options
      );
    }

    // ── Check 6: Per-Action Restrictions ─────────────────────────────────────
    if (policy.actionRules && policy.actionRules[action.actionType]) {
      const rule = policy.actionRules[action.actionType];
      if (rule.allowed === false) {
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: 'DENY',
            reasonCode: 'ACTION_RESTRICTED',
            reason: `Action '${action.actionType}' is specifically disabled by policy rule`,
          },
          action,
          policy,
          options
        );
      }
    }

    // ── Check 7 & 8: Rate Limiting (Hourly & Daily Limits) ───────────────────
    const actionRule = policy.actionRules?.[action.actionType];
    const rateCheck = browserRateLimiter.checkLimit(
      action.providerAccountId,
      {
        hourlyLimit: policy.hourlyActionLimit,
        dailyLimit: policy.dailyActionLimit,
        minuteLimit: policy.minuteActionLimit,
        actionLimit: actionRule?.maxPerHour,
      },
      action.actionType
    );

    if (!rateCheck.allowed) {
      return this.finalizeDecision(
        {
          ...baseResult,
          decision: 'DENY',
          reasonCode: rateCheck.reasonCode || 'RATE_LIMIT_EXCEEDED',
          reason: rateCheck.reason || 'Rate limit threshold reached',
          metadata: { retryAfterMs: rateCheck.retryAfterMs },
        },
        action,
        policy,
        options
      );
    }

    // ── Check 9: Spending Amount vs. spendingLimit ───────────────────────────
    const spendingLimit = policy.spendingLimit ?? 0;
    if (action.monetaryAmount !== undefined && action.monetaryAmount > 0) {
      if (spendingLimit === 0) {
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: 'DENY',
            reasonCode: 'SPENDING_LIMIT_ZERO_BLOCKED',
            reason: `Monetary spending (${action.monetaryAmount} ${action.currency || 'EUR'}) blocked: policy spendingLimit is 0`,
          },
          action,
          policy,
          options
        );
      }
      if (action.monetaryAmount > spendingLimit) {
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: 'DENY',
            reasonCode: 'SPENDING_LIMIT_EXCEEDED',
            reason: `Action spending (${action.monetaryAmount} ${action.currency || 'EUR'}) exceeds spendingLimit (${spendingLimit})`,
          },
          action,
          policy,
          options
        );
      }
    }

    // ── Check 10: Sensitive / Security Action Classification ────────────────
    const classification = classifyBrowserAction(action, policy);

    switch (classification.category) {
      case 'PURCHASE':
      case 'PAYMENT':
        if (spendingLimit === 0) {
          return this.finalizeDecision(
            {
              ...baseResult,
              decision: 'DENY',
              reasonCode: 'SPENDING_LIMIT_ZERO_PAYMENT_BLOCKED',
              reason: `Purchase or payment flow blocked: spendingLimit is 0`,
              actionCategory: classification.category,
            },
            action,
            policy,
            options
          );
        }
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: 'GATE',
            reasonCode: 'PAYMENT_APPROVAL_REQUIRED',
            reason: classification.reason,
            actionCategory: classification.category,
          },
          action,
          policy,
          options
        );

      case 'PAYOUT':
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: 'GATE',
            reasonCode: 'PAYOUT_APPROVAL_REQUIRED',
            reason: classification.reason,
            actionCategory: 'PAYOUT',
          },
          action,
          policy,
          options
        );

      case 'ACCOUNT_SECURITY':
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: 'GATE',
            reasonCode: 'ACCOUNT_SECURITY_APPROVAL_REQUIRED',
            reason: classification.reason,
            actionCategory: 'ACCOUNT_SECURITY',
          },
          action,
          policy,
          options
        );

      case 'CREDENTIAL':
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: 'GATE',
            reasonCode: 'CREDENTIAL_SUBMISSION_GATED',
            reason: classification.reason,
            actionCategory: 'CREDENTIAL',
          },
          action,
          policy,
          options
        );

      case 'CAPTCHA':
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: 'GATE',
            reasonCode: 'CAPTCHA_SOLVE_GATED',
            reason: classification.reason,
            actionCategory: 'CAPTCHA',
          },
          action,
          policy,
          options
        );

      case 'KYC':
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: 'GATE',
            reasonCode: 'KYC_VERIFICATION_GATED',
            reason: classification.reason,
            actionCategory: 'KYC',
          },
          action,
          policy,
          options
        );

      case 'LEGAL_ACCEPTANCE':
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: 'GATE',
            reasonCode: 'LEGAL_ACCEPTANCE_GATED',
            reason: classification.reason,
            actionCategory: 'LEGAL_ACCEPTANCE',
          },
          action,
          policy,
          options
        );

      case 'EXTERNAL_REDIRECT':
        // Check if external redirect destination is explicitly in allowedRedirectDomains
        if (action.navigationDestination) {
          const destHostname = extractHostname(action.navigationDestination);
          const isAllowedRedirect =
            destHostname &&
            policy.allowedRedirectDomains &&
            isHostnameInAllowedList(destHostname, policy.allowedRedirectDomains);

          if (!isAllowedRedirect) {
            return this.finalizeDecision(
              {
                ...baseResult,
                decision: 'GATE',
                reasonCode: 'UNAUTHORIZED_EXTERNAL_REDIRECT',
                reason: `External redirect to '${destHostname || 'unknown'}' requires human review`,
                actionCategory: 'EXTERNAL_REDIRECT',
              },
              action,
              policy,
              options
            );
          }
        }
        break;

      case 'ROUTINE':
      default:
        // Routine actions proceed to State Verification
        break;
    }

    // ── Check 11: External Redirect (Secondary destination validation) ───────
    if (action.navigationDestination) {
      const destHostname = extractHostname(action.navigationDestination);
      if (destHostname && destHostname !== targetHostname) {
        const isTargetAllowed = isHostnameInAllowedList(destHostname, policy.allowedDomains);
        const isRedirectAllowed =
          policy.allowedRedirectDomains &&
          isHostnameInAllowedList(destHostname, policy.allowedRedirectDomains);

        if (!isTargetAllowed && !isRedirectAllowed) {
          return this.finalizeDecision(
            {
              ...baseResult,
              decision: 'GATE',
              reasonCode: 'UNAUTHORIZED_EXTERNAL_REDIRECT',
              reason: `Navigation target '${destHostname}' is outside authorized domains`,
              actionCategory: 'EXTERNAL_REDIRECT',
            },
            action,
            policy,
            options
          );
        }
      }
    }

    // ── Check 12: Current Browser State Expected / Known ─────────────────────
    if (action.currentState?.stateName && policy.knownStates && policy.knownStates.length > 0) {
      if (!policy.knownStates.includes(action.currentState.stateName)) {
        const unexpectedBehavior = policy.unexpectedStateBehavior || 'GATE';
        return this.finalizeDecision(
          {
            ...baseResult,
            decision: unexpectedBehavior,
            reasonCode: 'UNEXPECTED_BROWSER_STATE',
            reason: `Browser page state '${action.currentState.stateName}' is unexpected or unrecognized`,
          },
          action,
          policy,
          options
        );
      }
    }

    // ── All Checks Passed: ALLOW ─────────────────────────────────────────────
    return this.finalizeDecision(
      {
        ...baseResult,
        decision: 'ALLOW',
        reasonCode: 'POLICY_AUTHORIZED',
        reason: 'Action authorized by policy; routine execution permitted without human gate',
        actionCategory: classification.category,
      },
      action,
      policy,
      options
    );
  }

  /**
   * Finalize the decision, update rate limiter, dispatch human gates, and record audit trace.
   */
  private finalizeDecision(
    decision: PolicyDecisionResult,
    action: ProposedBrowserAction,
    policy: ProviderAccountPolicy,
    options: PolicyEnforcerOptions
  ): PolicyDecisionResult {
    // 1. Rate Limiting Increment on ALLOW
    if (decision.decision === 'ALLOW') {
      const shouldRecord = options.recordRateLimitOnAllow !== false;
      if (shouldRecord) {
        browserRateLimiter.recordAction(action.providerAccountId, action.actionType);
      }
    }

    // 2. Human Gate Dispatch on GATE
    if (decision.decision === 'GATE' && options.db) {
      this.dispatchHumanGate(decision, action, options.db);
    }

    // 3. Audit Trace Recording
    if (options.db) {
      this.recordAuditTrace(decision, action, policy, options.db);
    }

    return decision;
  }

  /**
   * Insert a human gate record into revenue_human_gates and mark worker paused.
   */
  private dispatchHumanGate(
    decision: PolicyDecisionResult,
    action: ProposedBrowserAction,
    db: any
  ): void {
    try {
      const now = new Date().toISOString();
      const gateId = `gate-browser-${randomUUID()}`;
      const gateType = mapCategoryToGateType(decision.actionCategory);

      // Insert human gate record
      db.prepare(`
        INSERT INTO revenue_human_gates (
          id, experiment_id, gate_type, status, description, branch_paused,
          metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        gateId,
        (action.metadata?.experimentId as string) || null,
        gateType,
        'open',
        decision.reason,
        1,
        JSON.stringify({
          providerId: action.providerId,
          providerAccountId: action.providerAccountId,
          workerId: action.workerId,
          taskId: action.taskId || null,
          actionType: action.actionType,
          actionCategory: decision.actionCategory,
          targetUrl: action.targetUrl,
          targetDomain: decision.targetDomain,
          screenshotRef: (action.metadata?.screenshotRef as string) || null,
        }),
        now,
        now
      );

      // Pause worker independently without affecting other workers
      if (action.workerId) {
        db.prepare(`
          UPDATE revenue_browser_workers
          SET status = 'PAUSED_FOR_GATE', updated_at = ?
          WHERE id = ?
        `).run(now, action.workerId);
      }
    } catch (err: any) {
      // Non-fatal logging for gate insertion errors in testing
      console.warn(`[BrowserPolicyEnforcer] Failed to dispatch human gate: ${err.message}`);
    }
  }

  /**
   * Persist audit trace to revenue_browser_traces.
   * Persists all DENY and GATE decisions, plus state-changing ALLOW actions.
   */
  private recordAuditTrace(
    decision: PolicyDecisionResult,
    action: ProposedBrowserAction,
    policy: ProviderAccountPolicy,
    db: any
  ): void {
    try {
      const stateChangingActions = ['CLICK', 'FORM_FILL', 'NAVIGATE'];
      const isStateChanging = stateChangingActions.includes(action.actionType.toUpperCase());
      const shouldAudit =
        decision.decision !== 'ALLOW' || isStateChanging || policy.tracingMode === true;

      if (!shouldAudit) {
        return;
      }

      const now = new Date().toISOString();
      const traceId = `btrace-${randomUUID()}`;

      db.prepare(`
        INSERT INTO revenue_browser_traces (
          id, task_id, worker_id, provider_account_id, action_type, url,
          status, policy_decision, screenshot_path, execution_duration_ms,
          error, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        traceId,
        action.taskId || null,
        action.workerId,
        action.providerAccountId,
        action.actionType,
        action.targetUrl,
        decision.decision === 'ALLOW' ? 'executed' : decision.decision === 'GATE' ? 'gated' : 'rejected_policy',
        JSON.stringify(decision),
        (action.metadata?.screenshotRef as string) || null,
        0,
        decision.decision === 'DENY' ? decision.reason : null,
        now
      );
    } catch (err: any) {
      console.warn(`[BrowserPolicyEnforcer] Failed to record audit trace: ${err.message}`);
    }
  }
}

export const browserPolicyEnforcer = new BrowserPolicyEnforcer();
