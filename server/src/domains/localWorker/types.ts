/**
 * domains/localWorker/types.ts
 *
 * Types for the AgenticOS Local Worker subsystem.
 */

export type LocalWorkerTaskStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'blocked'
  | 'review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkerStepStatus =
  | 'pending'
  | 'running'
  | 'verified'
  | 'failed'
  | 'skipped';

export type WorkerRiskLevel = 'read' | 'write' | 'high_impact';

export interface WorkerVerification {
  verified: boolean;
  realityCheck: string;
  evidenceSource?: string;
  details?: unknown;
}

export interface WorkerEvidence {
  id: string;
  stepId: string;
  tool: string;
  arguments?: unknown;
  startedAt: string;
  completedAt: string;
  exitState: 'success' | 'failure';
  verification: WorkerVerification;
  evidenceSource: string;
  outputSnippet?: string;
  rawOutput?: unknown;
  error?: string;
}

export interface WorkerResult {
  success: boolean;
  summary: string;
  output?: unknown;
  error?: string;
  evidenceSummary: string;
  artifacts?: Array<{ type: string; path?: string; data?: unknown }>;
  finalEvidence?: WorkerEvidence[];
}

export interface WorkerStep {
  id: string;
  description: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  status: WorkerStepStatus;
  attempts: number;
  verification?: WorkerVerification;
  riskLevel?: WorkerRiskLevel;
  requiresApproval?: boolean;
  approved?: boolean;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  output?: unknown;
}

export interface LocalWorkerConfig {
  maxStepRetries?: number;
  maxReplans?: number;
  maxRuntimeMs?: number;
  maxActions?: number;
  autoApprove?: boolean;
}

export interface LocalWorkerTask {
  id: string;
  goal: string;
  origin?: 'jarvis' | 'hermes' | 'api' | string;
  conversationId?: string;
  status: LocalWorkerTaskStatus;
  plan: WorkerStep[];
  currentStep: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  evidence: WorkerEvidence[];
  result?: WorkerResult;
  config?: LocalWorkerConfig;
  error?: string;
  pendingApproval?: {
    stepId: string;
    description: string;
    tool: string;
    arguments?: unknown;
    riskReason: string;
  };
}

export interface ToolExecutionResponse {
  success: boolean;
  output: unknown;
  rawOutput?: unknown;
  evidenceSource: string;
  verification: WorkerVerification;
  error?: string;
}
