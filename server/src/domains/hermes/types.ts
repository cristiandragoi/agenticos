/**
 * domains/hermes/types.ts
 *
 * Types and contracts for Hermes Closed-Loop Autonomous Engineering Orchestrator.
 */

export interface EngineeringStep {
  id: string;
  description: string;
  type: 'inspect' | 'edit' | 'test' | 'build' | 'deploy' | 'delegate';
  status: 'pending' | 'running' | 'passed' | 'failed';
  targetFiles?: string[];
  command?: string;
  worker?: string;
  evidence?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}

export interface VerificationRecord {
  type: 'build' | 'test' | 'runtime' | 'static' | 'deployment';
  command?: string;
  exitCode: number;
  passed: boolean;
  outputSummary: string;
  timestamp: string;
  evidence?: Record<string, unknown>;
}

export interface RepairAttempt {
  cycle: number;
  failureObserved: string;
  hypothesis: string;
  actionTaken: string;
  verificationPassed: boolean;
  timestamp: string;
}

export interface DelegatedTaskRecord {
  taskId: string;
  subtaskObjective: string;
  worker: string;
  status: 'running' | 'completed' | 'failed';
  result?: unknown;
  verifiedByHermes: boolean;
  timestamp: string;
}

export interface EscalationRecord {
  reason:
    | 'missing_credential'
    | 'payment_auth'
    | 'destructive_approval'
    | 'external_account'
    | 'physical_hardware'
    | 'genuine_ambiguity'
    | 'exhausted_approaches';
  description: string;
  technicalEvidence: string[];
  suggestedAction?: string;
  timestamp: string;
}

export interface MissionState {
  missionId: string;
  goal: string;
  acceptanceCriteria: string[];
  workspaceRoot: string;
  status:
    | 'observing'
    | 'planning'
    | 'executing'
    | 'verifying'
    | 'evaluating'
    | 'repairing'
    | 'deploying'
    | 'completed'
    | 'failed'
    | 'escalated'
    | 'stopped';
  completedSteps: EngineeringStep[];
  activeSteps: EngineeringStep[];
  currentBlockers: string[];
  verificationEvidence: VerificationRecord[];
  repairAttempts: RepairAttempt[];
  delegatedTasks: DelegatedTaskRecord[];
  workerResults: Record<string, unknown>;
  deploymentState: {
    required: boolean;
    synced: boolean;
    paths: string[];
    lastSyncedAt?: string;
  };
  escalation?: EscalationRecord;
  startTime: number;
  lastUpdatedAt: number;
}

import type { HermesMissionProgressEvent } from './progressEvents.js';

export interface MissionExecutionOptions {
  workspaceRoot?: string;
  conversationId?: string;
  projectId?: string;
  goalId?: string;
  taskId?: string;
  requestId?: string;
  maxRepairCycles?: number;
  allowParallelDelegation?: boolean;
  abortSignal?: AbortSignal;
  onProgress?: (event: HermesMissionProgressEvent) => void;
}

export interface MissionFinalReport {
  success: boolean;
  missionId: string;
  goal: string;
  whatChanged: string;
  filesChanged: string[];
  testsAndBuilds: string;
  deployment: string;
  liveVerification: string;
  remainingLimitations: string;
  evidence: {
    stepsCompleted: number;
    repairsAttempted: number;
    verificationsRun: number;
    durationMs: number;
  };
  escalation?: EscalationRecord;
}
