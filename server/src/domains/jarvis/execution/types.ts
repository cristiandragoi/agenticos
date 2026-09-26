/**
 * types.ts — Common contracts and interfaces for the Universal Execution Controller.
 */

import type { ExecutionEvidencePack } from './evidenceTypes.js';

export * from './evidenceTypes.js';

export type CapabilityRisk = 'read' | 'local_write' | 'external_write' | 'destructive';

export type ConversationMode =
  | 'CONVERSATION'
  | 'COMMAND'
  | 'DICTATION'
  | 'ACTIVE_TOOL_EXECUTION';

export interface VoiceTurnTrace {
  voiceEventId: string;
  turnId: string;
  rawStt: string;
  normalizedStt: string;
  conversationMode: ConversationMode;
  parsedIntent: string;
  executionId: string;
  activeTool: string;
  browserInputAuthorized: boolean;
  targetElement: string | null;
  textToType: string | null;
  reasonForTyping: string | null;
  completionState: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'IN_PROGRESS';
}

export interface TurnContext {
  conversationId: string;
  turnId?: string;
  voiceEventId?: string;
  workspacePath?: string;
  activeEntityId?: string;
  activeEntityType?: string;
  activeEntityName?: string;
  activeProjectId?: string;
  activeProjectName?: string;
  lastAssistantTurn?: string;
  lastUserTurn?: string;
  rawStt?: string;
  confidence?: number;
  browserInputAuthorized?: boolean;
  conversationMode?: ConversationMode;
  voiceTurnTrace?: VoiceTurnTrace;
  inputChannel?: string;
  onProgress?: (event: any) => void;
  navigationVerifier?: (req: {
    navigationId: string;
    route: string;
    entityId: string;
    entityType: string;
    entityName: string;
  }) => Promise<{ verified: boolean; actualRoute?: string; visibleEntityId?: string; error?: string }>;
}

export interface CapabilityMatch {
  matched: boolean;
  confidence: number; // 0..1
  intent: string;
  parameters: Record<string, unknown>;
  reason?: string;
}

export interface CandidateScore {
  executorId: string;
  matched: boolean;
  confidence: number; // 0..1
  reason: string;
  plan?: ActionPlan;
}

export interface ActionPlanStep {
  stepId: string;
  capabilityId: string;
  executorId: string;
  action: string;
  parameters: Record<string, unknown>;
  description: string;
}

export interface ActionPlan {
  goalId: string;
  goalDescription: string;
  steps: ActionPlanStep[];
  estimatedRisk: CapabilityRisk;
  requiresApproval: boolean;
  confidence: number;
  primaryExecutor?: string;
  candidates?: CandidateScore[];
  clarificationRequired?: boolean;
}

export interface ExecutionResult {
  stepId?: string;
  success: boolean;
  data?: unknown;
  error?: string;
  evidence?: Record<string, unknown>;
  output?: string;
}

export interface VerificationResult {
  verified: boolean;
  realityCheck: string;
  actualState?: Record<string, unknown>;
  error?: string;
}

export interface JarvisCapability {
  id: string;
  displayName: string;
  description: string;
  intents: string[];
  risk: CapabilityRisk;

  canHandle(goal: string, context: TurnContext): Promise<CapabilityMatch>;
  plan(goal: string, match: CapabilityMatch, context: TurnContext): Promise<ActionPlan>;
  execute(plan: ActionPlan, context: TurnContext): Promise<ExecutionResult>;
  verify(result: ExecutionResult, context: TurnContext): Promise<VerificationResult>;
}

export interface TurnExecutionResult {
  handled: boolean;
  goalId: string;
  goalDescription: string;
  route: string;
  plan: ActionPlan;
  execution: ExecutionResult;
  verification: VerificationResult;
  spokenText: string;
  silent?: boolean;
  uiRoute?: string;
  entityId?: string;
  entityName?: string;
  entityType?: string;
  presentedBlockers?: any[];
  timings: Record<string, number>;
  selfHealAttempted?: boolean;
  browserInputAuthorized?: boolean;
  conversationMode?: ConversationMode;
  voiceTurnTrace?: VoiceTurnTrace;
  /** Set when this turn asked a question that the NEXT turn may answer. */
  pendingClarification?: {
    kind: string;
    targetName?: string;
    targetType?: string;
    intendedAction?: string;
    attempt: number;
    askedAt: number;
    options?: string[];
    /** F5: yes/no vs multi-choice vs open-ended — decides how "Yes." resolves. */
    clarificationType?: 'yes_no' | 'choice' | 'open_ended';
  };
  /** Set when a previously pending clarification was resolved or superseded. */
  clearPendingClarification?: boolean;

  // ── CONTINUATION STATE (F1) ─────────────────────────────────────────
  /** The referent this turn resolved, retained even when the action failed (F2). */
  lastResolvedEntityId?: string;
  lastResolvedEntityName?: string;
  lastResolvedEntityType?: string;
  /** Canonical action performed/attempted: open | operate | read | search. */
  lastResolvedAction?: string;
  lastExecutionResult?: {
    success: boolean;
    verified: boolean;
    route?: string;
    entityId?: string;
    entityName?: string;
    at: number;
  };
  /** Why the last action failed — executor detail, never invented. */
  lastFailureReason?: string;
  lastFailureAt?: number;
  lastVerificationState?: 'verified' | 'unverified' | 'failed' | 'unknown';

  // ── GOAL COMPLETENESS VERIFICATION ─────────────────────────────────
  requestedGoals?: string[];
  executedGoals?: string[];
  satisfiedGoals?: string[];
  failedGoals?: string[];
  repairProposal?: any;
  stage?: string;
  evidencePack?: ExecutionEvidencePack;
}
