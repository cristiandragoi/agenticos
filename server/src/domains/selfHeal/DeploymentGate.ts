import { createHash } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import {
  type ApprovalRecord,
  DeploymentDeniedError,
  type AstraDiagnosis,
  type RepairIncident,
  type RepairAttempt,
  type TestResult,
  type TestReport,
} from './types.js';

/** Compute SHA-256 hex hash of the diff string */
export function computePatchHash(diff: string): string {
  return createHash('sha256').update(diff, 'utf8').digest('hex');
}

export class DeploymentGate {
  private approvals: Map<string, ApprovalRecord> = new Map();

  /** Store approval record in map keyed by `${incidentId}:${repairAttemptId}` */
  recordApproval(record: ApprovalRecord): void {
    const key = `${record.incidentId}:${record.repairAttemptId}`;
    this.approvals.set(key, record);
    logger.info(`[SelfHeal:DeploymentGate] Recorded approval for ${key} (patchHash: ${record.patchHash})`);
  }

  /** Assert that a patch has been cryptographically approved and matching the current patch hash */
  assertApproved(incidentId: string, repairAttemptId: string, currentPatchHash: string): ApprovalRecord {
    const key = `${incidentId}:${repairAttemptId}`;
    const record = this.approvals.get(key);

    if (!record) {
      throw new DeploymentDeniedError(
        `No approval record found for incident ${incidentId} and repair attempt ${repairAttemptId}`
      );
    }

    if (record.patchHash !== currentPatchHash) {
      throw new DeploymentDeniedError(
        `Patch hash mismatch for incident ${incidentId}: recorded ${record.patchHash}, current ${currentPatchHash}`
      );
    }

    return record;
  }

  /** Retrieve an approval record by incident and attempt IDs */
  getApproval(incidentId: string, repairAttemptId: string): ApprovalRecord | undefined {
    return this.approvals.get(`${incidentId}:${repairAttemptId}`);
  }

  /** Check if repair requires human approval — always returns true in Phase 1 */
  requiresHumanApproval(
    _diagnosis?: AstraDiagnosis,
    _testResults?: TestResult[] | TestReport,
    _argusVerdict?: string
  ): boolean {
    return true;
  }

  /** Format the approval request details for human review */
  formatApprovalRequest(
    incident: RepairIncident,
    diagnosis: AstraDiagnosis,
    attempt: RepairAttempt,
    testResultsOrReport: TestResult[] | TestReport,
    argusVerdict: string
  ): string {
    const results: TestResult[] = Array.isArray(testResultsOrReport)
      ? testResultsOrReport
      : testResultsOrReport?.results ?? [];

    const testSummary = results.length > 0
      ? results.map(t => `- ${t.name}: ${t.passed ? 'PASS' : 'FAIL'}`).join('\n')
      : 'No test results available';

    const diffLines = (attempt.fullDiff || '').split('\n');
    const diffSummary = diffLines.slice(0, 50).join('\n') + (diffLines.length > 50 ? '\n... (truncated)' : '');

    return `
### Repair Approval Request

**Incident ID**: ${incident.incidentId}
**Component**: ${incident.component}
**Symptom**: ${incident.symptom}

**Root Cause**: ${diagnosis.rootCause}
**Confidence**: ${(diagnosis.confidence * 100).toFixed(0)}%
**Risk Level**: ${diagnosis.riskLevel}

**Files Changed**:
${attempt.filesChanged.map(f => `- ${f}`).join('\n')}

**Test Results**:
${testSummary}

**Argus Verdict**: ${argusVerdict}

**Diff Summary (First 50 lines)**:
\`\`\`diff
${diffSummary}
\`\`\`
    `.trim();
  }
}

export const deploymentGate = new DeploymentGate();
