import { rawDb } from '../../db/index.js';
import { BackgroundTaskRecord } from './types.js';
import { engineeringWorkerRegistry } from '../../domains/controlPlane/EngineeringWorkerRegistry.js';

export interface CompletionContract {
  requiresDiagnosis?: boolean;
  requiresCodeChange?: boolean | 'conditional';
  requiresTests?: boolean;
  requiresBuild?: boolean | 'conditional';
  requiresDeployment?: boolean | 'conditional';
  requiresOriginalGoalRetry?: boolean;
  requiresArgusVerification?: boolean;
  requiredFilesInspected?: string[];
  requiredCommandsExecuted?: string[];
}

export interface ExecutionEvidence {
  taskId: string;
  goalId?: string | null;
  filesInspected: string[];
  filesChanged: string[];
  commandsExecuted: string[];
  testsRun: number;
  testsPassed: boolean;
  testState: 'idle' | 'running' | 'passed' | 'failed';
  buildState: 'idle' | 'running' | 'passed' | 'failed';
  deploymentPassed: boolean;
  originalGoalRetried: boolean;
  originalGoalRunId?: string | null;
  argusVerified: boolean;
  argusVerificationRecord?: any | null;
}

export interface ClaimValidationResult {
  valid: boolean;
  violations: string[];
}

export interface ContractEvaluationResult {
  passed: boolean;
  missingEvidence: string[];
  violations: string[];
}

/**
 * Resolves the explicit or inferred CompletionContract for a task.
 * Engineering repairs require diagnosis, tests, goal retry, and Argus verification.
 */
export function resolveCompletionContract(task: BackgroundTaskRecord, goal?: any | null): CompletionContract {
  const metadata = (task.metadata || {}) as Record<string, any>;
  if (metadata.completionContract && typeof metadata.completionContract === 'object') {
    return metadata.completionContract as CompletionContract;
  }

  const reqLower = `${task.title} ${task.objective} ${task.originalRequest}`.toLowerCase();
  
  // Read-only inspection / query task
  const isReadOnly = /inspect|read|check|status|examine|query/i.test(reqLower) && !/repair|fix|heal/i.test(reqLower);
  if (isReadOnly) {
    return {
      requiresDiagnosis: true,
      requiresCodeChange: false,
      requiresTests: false,
      requiresBuild: false,
      requiresDeployment: false,
      requiresOriginalGoalRetry: false,
      requiresArgusVerification: false,
    };
  }

  const isEngineeringRepair =
    task.route === 'codex' ||
    task.worker === 'codex' ||
    task.worker === 'antigravity' ||
    task.worker === 'hermes' ||
    Boolean(metadata.preserveOriginalGoalRun) ||
    Boolean(metadata.requiresLiveValidation) ||
    /repair|fix|selfheal|healing|continuation|reopen/i.test(reqLower);

  const hasOriginatingGoal =
    Boolean(metadata.preserveOriginalGoalRun) ||
    Boolean(metadata.originatingGoalId) ||
    /goal-[a-z0-9-]+|turn-[a-z0-9-]+|selfheal-\d+/i.test(reqLower);

  if (isEngineeringRepair) {
    return {
      requiresDiagnosis: true,
      requiresCodeChange: 'conditional',
      requiresTests: true,
      requiresBuild: 'conditional',
      requiresDeployment: 'conditional',
      requiresOriginalGoalRetry: hasOriginatingGoal,
      requiresArgusVerification: true,
    };
  }

  return {
    requiresDiagnosis: false,
    requiresCodeChange: 'conditional',
    requiresTests: false,
    requiresBuild: false,
    requiresDeployment: false,
    requiresOriginalGoalRetry: false,
    requiresArgusVerification: false,
  };
}

/**
 * Validates worker narrative claims against machine recorded evidence.
 * Protected claims: "Argus", "verified", "repaired", "fixed", "tested", "built", "deployed", "retried".
 */
export function validateWorkerClaims(resultText: string, evidence: ExecutionEvidence): ClaimValidationResult {
  const violations: string[] = [];
  if (!resultText) {
    return { valid: true, violations: [] };
  }

  // 1. Argus Verification claims
  if (/argus.*(?:verifi|confirm|passed|check)|confirmed against the original goal/i.test(resultText)) {
    if (!evidence.argusVerified || !evidence.argusVerificationRecord) {
      violations.push('Worker claimed Argus verification, but no passing record exists in argus_verifications.');
    }
  }

  // 2. Repair / Fixed claims
  if (/(?:repair|fix)\s+(?:complete|done|validated|finished)|successfully\s+(?:repaired|fixed)|resolved\s+and\s+validated/i.test(resultText)) {
    if (evidence.filesChanged.length === 0 && !evidence.testsPassed) {
      violations.push('Worker claimed repair is complete, but 0 files were changed and no tests passed.');
    }
  }

  // 3. Test claims
  if (/tests?\s+(?:passed|succeeded|validated|green)/i.test(resultText)) {
    if (evidence.testsRun === 0 || !evidence.testsPassed) {
      violations.push('Worker claimed tests passed, but no automated test execution was recorded in evidence.');
    }
  }

  // 4. Original goal retry claims
  if (/(?:original\s+goal|goalrun|camera)\s+(?:retried|healed|recovered|executed)/i.test(resultText)) {
    if (!evidence.originalGoalRetried) {
      violations.push('Worker claimed original GoalRun was retried, but no corresponding execution record was found.');
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Evaluates whether the machine evidence satisfies the CompletionContract.
 */
export function evaluateCompletionContract(
  contract: CompletionContract,
  evidence: ExecutionEvidence,
  claimValidation: ClaimValidationResult
): ContractEvaluationResult {
  const missingEvidence: string[] = [];

  if (contract.requiresDiagnosis) {
    if (evidence.filesInspected.length === 0 && evidence.commandsExecuted.length === 0) {
      missingEvidence.push('Diagnosis evidence missing: No files or logs inspected.');
    }
  }

  if (contract.requiresCodeChange === true) {
    if (evidence.filesChanged.length === 0) {
      missingEvidence.push('Code changes required, but filesChanged is empty.');
    }
  }

  if (contract.requiresTests === true) {
    if (evidence.testsRun === 0 || !evidence.testsPassed) {
      missingEvidence.push('Test execution required, but no passed tests recorded.');
    }
  }

  if (contract.requiresBuild === true) {
    if (evidence.buildState !== 'passed') {
      missingEvidence.push('Build execution required, but buildState is not passed.');
    }
  }

  if (contract.requiresOriginalGoalRetry === true) {
    if (!evidence.originalGoalRetried) {
      missingEvidence.push('Original GoalRun retry required, but original goal was not re-executed.');
    }
  }

  if (contract.requiresArgusVerification === true) {
    if (!evidence.argusVerified || !evidence.argusVerificationRecord) {
      missingEvidence.push('Argus independent verification record required, but no passing record found.');
    }
  }

  const passed = missingEvidence.length === 0 && claimValidation.valid;
  return {
    passed,
    missingEvidence,
    violations: claimValidation.violations,
  };
}

/**
 * Gathers all machine execution evidence for a task and linked goal from SQLite and filesystem.
 */
export function gatherTaskExecutionEvidence(
  task: BackgroundTaskRecord,
  linkedGoalId?: string | null,
  customDb?: any
): ExecutionEvidence {
  const db = customDb || rawDb;
  const goalId = linkedGoalId || task.linkedRunId;
  const filesInspected = new Set<string>();
  const commandsExecuted: string[] = [];

  if (goalId && db) {
    try {
      const events = db.prepare("SELECT tool, file_path, command, payload FROM goal_events WHERE goal_id = ?").all(goalId) as any[];
      for (const ev of events) {
        if (ev.file_path) filesInspected.add(ev.file_path);
        if (ev.command) commandsExecuted.push(ev.command);
        if (ev.payload) {
          try {
            const p = JSON.parse(ev.payload);
            if (p.path) filesInspected.add(p.path);
            if (p.cmd) commandsExecuted.push(p.cmd);
          } catch {}
        }
      }
    } catch {}
  }

  const metadata = (task.metadata || {}) as Record<string, any>;

  if (Array.isArray(metadata.filesInspected)) {
    for (const f of metadata.filesInspected) filesInspected.add(f);
  }
  if (Array.isArray(metadata.commandsExecuted)) {
    for (const c of metadata.commandsExecuted) commandsExecuted.push(c);
  }

  // Incorporate real-time worker execution telemetry from EngineeringWorkerRegistry
  try {
    const workerEvents = engineeringWorkerRegistry.getWorkerEvents(undefined, 500).filter(e => e.taskId === task.taskId);
    for (const ev of workerEvents) {
      if (ev.file) filesInspected.add(ev.file);
      if (ev.command) commandsExecuted.push(ev.command);
    }
  } catch {}

  const filesChanged = Array.isArray(task.filesChanged) && task.filesChanged.length > 0
    ? [...task.filesChanged]
    : Array.isArray(metadata.filesChanged)
      ? [...metadata.filesChanged]
      : [];

  let argusVerified = Boolean(metadata.argusVerified);
  let argusVerificationRecord: any = metadata.argusVerificationRecord || null;
  if (!argusVerified && db) {
    try {
      const row = db.prepare(
        `SELECT * FROM argus_verifications 
         WHERE (goal_id = ? OR goal_id = ? OR contract_id = ?) 
           AND (status IN ('verified_complete', 'VERIFIED') OR verdict LIKE '%"passed":true%') 
         ORDER BY created_at DESC LIMIT 1`
      ).get(goalId || '', metadata.originatingGoalId || '', task.taskId);
      if (row) {
        argusVerified = true;
        argusVerificationRecord = row;
      }
    } catch {}
  }

  const testsRun = task.testState === 'passed' ? Math.max(1, Number(metadata.testsRun || 0)) : Number(metadata.testsRun || 0);
  const testsPassed = task.testState === 'passed' || Boolean(metadata.testsPassed);

  const originalGoalRetried = Boolean(metadata.originalGoalRetried || metadata.cameraEvidence || metadata.originatingGoalRetriedAt);

  return {
    taskId: task.taskId,
    goalId,
    filesInspected: Array.from(filesInspected),
    filesChanged,
    commandsExecuted,
    testsRun,
    testsPassed,
    testState: task.testState,
    buildState: task.buildState,
    deploymentPassed: task.buildState === 'passed',
    originalGoalRetried,
    originalGoalRunId: metadata.originatingGoalId || null,
    argusVerified,
    argusVerificationRecord,
  };
}

export interface ContinuationPlan {
  taskId: string;
  goalId?: string | null;
  requiresWorkerDispatch: boolean;
  assignedWorker: string;
  missingWork: Array<{
    step: 'worker_repair' | 'testing' | 'building' | 'deploying' | 'retrying_original_goal' | 'argus_verifying';
    reason: string;
    executableAction: string;
  }>;
  workerFeedback: string;
}

/**
 * Converts missing completion contract evidence into an executable Continuation Plan.
 * Invariant: Validation rejection is not a dead end; it drives the next execution steps.
 */
export function createContinuationPlan(
  task: BackgroundTaskRecord,
  contract: CompletionContract,
  evidence: ExecutionEvidence,
  claimValidation: ClaimValidationResult
): ContinuationPlan {
  const missingWork: ContinuationPlan['missingWork'] = [];
  const workerRejections: string[] = [];

  for (const v of claimValidation.violations) {
    workerRejections.push(v);
  }

  // 1. Engineering repair / code changes
  const needsCodeChange =
    (contract.requiresCodeChange === true && evidence.filesChanged.length === 0) ||
    (contract.requiresCodeChange === 'conditional' && evidence.filesChanged.length === 0 && !evidence.testsPassed);

  if (needsCodeChange) {
    missingWork.push({
      step: 'worker_repair',
      reason: 'No source files were changed or repaired during the worker session.',
      executableAction: 'Re-dispatch engineering worker to implement source changes.',
    });
    workerRejections.push('no source repair was performed');
  }

  // 2. Automated tests
  if (contract.requiresTests && (!evidence.testsPassed || evidence.testsRun === 0)) {
    missingWork.push({
      step: 'testing',
      reason: 'Automated tests were not executed or did not pass.',
      executableAction: 'Execute automated regression test suite.',
    });
    workerRejections.push('no tests ran');
  }

  // 3. Build / deployment
  if (contract.requiresBuild && evidence.buildState !== 'passed') {
    missingWork.push({
      step: 'building',
      reason: 'Workspace build has not passed.',
      executableAction: 'Execute build command.',
    });
    workerRejections.push('build has not completed');
  }

  // 4. Original GoalRun retry
  if (contract.requiresOriginalGoalRetry && !evidence.originalGoalRetried) {
    missingWork.push({
      step: 'retrying_original_goal',
      reason: 'The originating GoalRun has not been re-executed against real runtime.',
      executableAction: 'Reload original GoalRun context and execute through installed runtime.',
    });
    workerRejections.push('no original camera GoalRun retry occurred');
  }

  // 5. Argus verification
  if (contract.requiresArgusVerification && (!evidence.argusVerified || !evidence.argusVerificationRecord)) {
    missingWork.push({
      step: 'argus_verifying',
      reason: 'Argus independent verification record is missing.',
      executableAction: 'Execute Argus verifier to certify physical/machine post-conditions.',
    });
    workerRejections.push('no Argus verification occurred');
  }

  const workerFeedback = [
    'Previous result rejected because:',
    ...workerRejections.map(r => `  - ${r}`),
    'Codex must continue working until it has actually fulfilled its engineering responsibilities.',
    'It may not simply rephrase its previous conclusion.'
  ].join('\n');

  return {
    taskId: task.taskId,
    goalId: task.linkedRunId,
    requiresWorkerDispatch: needsCodeChange,
    assignedWorker: task.worker || 'codex',
    missingWork,
    workerFeedback,
  };
}

