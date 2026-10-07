/**
 * taskGraph/types.ts — Canonical Task Graph & Node Contracts for AgenticOS
 *
 * Implements Section D:
 * Minimum node contract, dependencies, execution state, policies, and observable task graphs.
 */

import type { ArtifactRef } from '../artifacts/types.js';

export type TaskNodeStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'VERIFIED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'SKIPPED';

export interface TaskRetryPolicy {
  readonly maxRetries: number;
  readonly backoffMs: number;
}

export interface TaskVerificationPolicy {
  readonly required: boolean;
  readonly verifier?: string;
  readonly expectArtifactType?: ArtifactRef['type'];
}

export interface TaskNode {
  workerId?: string;
  executionPolicy?: { reference: string; version: number; approvalState: 'NOT_REQUIRED' | 'REQUIRED_NOT_VERIFIED' };
  readonly id: string;
  readonly capability: string;
  readonly operation: string;
  readonly inputs: Record<string, any>;
  outputs: Record<string, any>;
  readonly dependsOn: readonly string[];
  status: TaskNodeStatus;
  retryPolicy?: TaskRetryPolicy;
  verificationPolicy?: TaskVerificationPolicy;
  error?: string;
  retryCount?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskGraph {
  readonly graphId: string;
  readonly goalId: string;
  readonly userGoal: string;
  readonly nodes: Map<string, TaskNode>;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  createdAt: number;
  updatedAt: number;
  finalArtifactId?: string;
  resultSummary?: string;
}

export interface TaskProgressEvent {
  readonly graphId: string;
  readonly goalId: string;
  readonly nodeId?: string;
  readonly phase: 'PLANNING' | 'NODE_STARTED' | 'NODE_COMPLETED' | 'MILESTONE' | 'FAILED' | 'COMPLETED';
  readonly userFacingMessage: string;
  readonly technicalDetail?: Record<string, unknown>;
  readonly timestamp: number;
}
