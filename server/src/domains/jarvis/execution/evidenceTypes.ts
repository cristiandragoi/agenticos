/**
 * evidenceTypes.ts — Verified Execution and Evidence Contract
 * Core Principle: EXECUTED != VERIFIED.
 * Jarvis must never claim external side effects or completion unless
 * physical post-conditions are observed and recorded in an ExecutionEvidencePack.
 */

export type ExecutionLifecycleState =
  | 'requested'
  | 'routed'
  | 'dispatched'
  | 'executed'
  | 'evidence'
  | 'verified'
  | 'failed'
  | 'responded';

export type EvidenceSource =
  | 'browser_cdp'
  | 'browser_dom'
  | 'desktop_win32'
  | 'desktop_process'
  | 'filesystem_fs'
  | 'terminal_shell'
  | 'hermes_worker'
  | 'unknown';

export interface BaseExecutionEvidence {
  source: EvidenceSource;
  observedAt: number; // timestamp
  verified: boolean;
  realityCheck: string;
  rawDetails?: Record<string, unknown>;
  error?: string;
}

export interface BrowserExecutionEvidence extends BaseExecutionEvidence {
  source: 'browser_cdp' | 'browser_dom';
  targetUrl?: string;
  actualUrl?: string;
  title?: string;
  domElementFound?: boolean;
  httpStatus?: number;
  visibility?: 'visible' | 'hidden' | 'occluded' | 'unknown';
  navigationId?: string;
}

export interface DesktopExecutionEvidence extends BaseExecutionEvidence {
  source: 'desktop_win32' | 'desktop_process';
  processName?: string;
  pid?: number;
  windowHandle?: string | number;
  windowTitle?: string;
  isForeground?: boolean;
  isVisible?: boolean;
}

export interface FilesystemExecutionEvidence extends BaseExecutionEvidence {
  source: 'filesystem_fs';
  targetPath: string;
  resolvedPath?: string;
  exists: boolean;
  isDirectory?: boolean;
  byteSize?: number;
  modifiedAt?: number;
  checksumOrHeader?: string;
}

export interface TerminalExecutionEvidence extends BaseExecutionEvidence {
  source: 'terminal_shell';
  command: string;
  exitCode?: number | null;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  processRunning?: boolean;
}

export interface WorkerDelegationEvidence extends BaseExecutionEvidence {
  source: 'hermes_worker';
  taskId: string;
  taskStatus: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  progressPercent?: number;
  outputArtifacts?: string[];
  workerId?: string;
}

export type SpecificExecutionEvidence =
  | BrowserExecutionEvidence
  | DesktopExecutionEvidence
  | FilesystemExecutionEvidence
  | TerminalExecutionEvidence
  | WorkerDelegationEvidence
  | BaseExecutionEvidence;

export interface ExecutionEvidencePack {
  evidenceId: string;
  lifecycleState: ExecutionLifecycleState;
  intent: string;
  goalId?: string;
  targetDescription: string;
  timestamp: number;
  executed: boolean;
  verified: boolean;
  evidence: SpecificExecutionEvidence[];
  realityCheck: string;
  verdict: 'verified_success' | 'verified_failure' | 'executed_unverified' | 'unexecuted_failed';
  prohibitedClaimsDetected?: string[];
}

/**
 * Helper to build an ExecutionEvidencePack from execution and verification results.
 */
export function buildEvidencePack(params: {
  intent: string;
  goalId?: string;
  targetDescription: string;
  executed: boolean;
  verified: boolean;
  realityCheck: string;
  evidenceItems?: SpecificExecutionEvidence[];
  error?: string;
}): ExecutionEvidencePack {
  const verdict = params.verified
    ? (params.executed ? 'verified_success' : 'verified_failure')
    : (params.executed ? 'executed_unverified' : 'unexecuted_failed');

  const lifecycleState: ExecutionLifecycleState = params.verified
    ? 'verified'
    : (params.executed ? 'executed' : 'failed');

  return {
    evidenceId: `ev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    lifecycleState,
    intent: params.intent,
    goalId: params.goalId,
    targetDescription: params.targetDescription,
    timestamp: Date.now(),
    executed: params.executed,
    verified: params.verified,
    evidence: params.evidenceItems || [],
    realityCheck: params.realityCheck,
    verdict
  };
}
