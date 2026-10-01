/**
 * baseProvider.ts — Universal contract for Browser Revenue Providers.
 *
 * Defines the standard IBrowserRevenueProvider interface.
 * Isolates all provider-specific DOM logic, task discovery, and reward verification
 * away from the generic BrowserWorkerAgent.
 */

import type { ProviderAccountPolicy, ProposedBrowserAction } from '../types.js';

export interface NormalizedDiscoveredTask {
  externalTaskId: string;
  taskType: string;
  targetUrl: string;
  actionPayload?: Record<string, unknown>;
  expectedReward: number;
  currency: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface PreconditionResult {
  passed: boolean;
  reason?: string;
  requiresLogin?: boolean;
}

export interface PlannedAction {
  actionType: string; // RoutineActionType: 'NAVIGATE' | 'CLICK' | 'FORM_FILL' | 'READ_DOM' | 'SCROLL' | 'WAIT' | 'VERIFY_STATE'
  targetUrl: string;
  selector?: string;
  elementRole?: string;
  elementName?: string;
  elementText?: string;
  formDestination?: string;
  inputName?: string;
  inputType?: string;
  inputValue?: string;
  monetaryAmount?: number;
  currency?: string;
  navigationDestination?: string;
  waitForSelector?: string;
  waitDurationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  actionType: string;
  error?: string;
  durationMs: number;
  resultingUrl?: string;
  screenshotPath?: string;
}

export interface VerificationResult {
  verified: boolean;
  rewardEarned: number;
  currency: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface RewardVerificationResult {
  verified: boolean;
  amount: number;
  currency: string;
  confirmedBalance?: number;
  proofEvidence?: string;
  idempotencyToken?: string;
}

export interface AnomalyReport {
  detected: boolean;
  anomalyType?: 'CAPTCHA' | 'KYC' | 'SESSION_EXPIRED' | 'UNEXPECTED_DOM' | 'RATE_LIMITED' | 'IP_BLOCKED';
  description?: string;
  evidence?: Record<string, unknown>;
}

export interface IBrowserRevenueProvider {
  /** Canonical provider identifier (e.g. 'synthetic', 'paidlikes') */
  readonly providerId: string;

  /** Base entrypoint URL for this provider */
  readonly startingUrl: string;

  /** Validate if the currently loaded page session is authenticated and valid */
  validateSession(page: any, account: any): Promise<boolean>;

  /** Discover available tasks from the provider's task board / page */
  discoverTasks(page: any, account: any): Promise<NormalizedDiscoveredTask[]>;

  /** Normalize a raw task representation into the canonical structure */
  normalizeTask(rawTask: any, account: any): NormalizedDiscoveredTask;

  /** Validate preconditions before task execution (e.g. login state, account readiness) */
  validatePreconditions(task: any, page: any, account: any): Promise<PreconditionResult>;

  /** Plan the deterministic browser actions required to fulfill a task */
  planActions(task: any, page: any, account: any): Promise<PlannedAction[]>;

  /** Execute a single planned browser action */
  executeAction(action: PlannedAction, page: any, account: any): Promise<ActionResult>;

  /** Verify that the executed action met task completion criteria on page */
  verifyOutcome(task: any, page: any, account: any): Promise<VerificationResult>;

  /** Verify reward with provider (e.g. balance check or confirmed reward credit) */
  verifyReward(task: any, page: any, account: any): Promise<RewardVerificationResult>;

  /** Retrieve the strict policy configuration for this provider / account */
  getPolicy(account: any): ProviderAccountPolicy;

  /** Detect any unexpected anomalies (CAPTCHA, KYC, logout, bot challenge) */
  detectAnomalies(page: any, account: any): Promise<AnomalyReport>;
}
