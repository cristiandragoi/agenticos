import { logger } from '../../utils/logger.js';
import { llmChat, type LlmChatResult } from '../../services/llmGateway.js';
import {
  type RepairIncident,
  type AstraDiagnosis,
  type TestResult,
  type TestReport,
  type ModelIdentityRecord,
  VerifierUnavailableError,
} from './types.js';
import { randomUUID } from 'node:crypto';

export interface VerificationResult {
  verdict: 'approve' | 'reject' | 'more_testing';
  evidence: string;
  modelIdentity: ModelIdentityRecord;
}

export class RepairVerifier {
  public requestedProvider?: string;
  public requestedModel?: string;
  public agentId: string = 'argus';

  constructor(options?: { provider?: string; model?: string; agentId?: string }) {
    this.requestedProvider = options?.provider;
    this.requestedModel = options?.model;
    if (options?.agentId) {
      this.agentId = options?.agentId;
    }
  }

  /** Configure requested provider, model, or agentId for verification */
  setConfig(options: { provider?: string; model?: string; agentId?: string }): void {
    if (options.provider !== undefined) this.requestedProvider = options.provider;
    if (options.model !== undefined) this.requestedModel = options.model;
    if (options.agentId !== undefined) this.agentId = options.agentId;
  }

  /** Independently verify a repair attempt using Argus with fail-closed model verification */
  async verify(
    incident: RepairIncident,
    diagnosis: AstraDiagnosis,
    diff: string,
    testReport: TestReport,
    options?: { provider?: string; model?: string }
  ): Promise<VerificationResult> {
    logger.info(`[SelfHeal:RepairVerifier] Verifying repair for incident ${incident.incidentId}...`);

    const provider = options?.provider ?? this.requestedProvider;
    const model = options?.model ?? this.requestedModel;
    const targetAgentId = this.agentId;
    const requestId = randomUUID();

    const verificationPrompt = this.buildVerificationPrompt(incident, diagnosis, diff, testReport);
    const VERIFIER_SYSTEM_PROMPT =
      'You are Argus, a strict verification AI. Analyze the proposed patch, diagnostic root cause, and test report. Respond in valid JSON with: verdict ("approve" | "reject" | "more_testing") and evidence (string detailing findings).';

    let result: LlmChatResult;
    try {
      result = await llmChat({
        prompt: verificationPrompt,
        systemPrompt: VERIFIER_SYSTEM_PROMPT,
        agentId: targetAgentId,
        provider,
        model,
        requestId,
        routingMode: provider ? 'forced' : 'preferred',
        disableFallback: Boolean(provider),
        maxTokens: 2048,
      });
    } catch (err: any) {
      throw new VerifierUnavailableError(`Argus verifier call failed: ${err?.message}`);
    }

    const actualProvider = result.provider ?? '';
    const actualModel = result.model ?? 'unknown';
    const effectiveRequestedProvider = provider ?? targetAgentId;
    const effectiveRequestedModel = model ?? targetAgentId;

    const hasProvider = Boolean(actualProvider && actualProvider.trim().length > 0 && actualProvider !== 'offline');
    const hasReply = Boolean(result.reply && result.reply.trim().length > 0);

    const verified = hasProvider && hasReply &&
      (provider ? actualProvider === provider : true) &&
      (model ? actualModel === model : true);

    const modelIdentity: ModelIdentityRecord = {
      requestedProvider: effectiveRequestedProvider,
      requestedModel: effectiveRequestedModel,
      actualProvider,
      actualModel,
      requestId,
      fallbackUsed: (provider ? actualProvider !== provider : false) || (model ? actualModel !== model : false),
      fallbackAuthorized: false,
      verified,
    };

    // If result.provider is empty or result.reply is empty → throw VerifierUnavailableError
    if (!result.provider || result.provider.trim().length === 0 || result.provider === 'offline') {
      throw new VerifierUnavailableError('Verifier provider is empty or offline');
    }

    if (!result.reply || result.reply.trim().length === 0) {
      throw new VerifierUnavailableError('Verifier returned empty response');
    }

    if (!verified) {
      throw new VerifierUnavailableError(
        `Verifier model verification failed: requested ${effectiveRequestedProvider}/${effectiveRequestedModel}, received ${actualProvider}/${actualModel}`
      );
    }

    let parsed: { verdict?: string; evidence?: string } = {};
    try {
      let jsonStr = result.reply.trim();
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = { verdict: 'reject', evidence: `Failed to parse verifier output: ${result.reply}` };
    }

    const rawVerdict = parsed.verdict;
    const verdict: 'approve' | 'reject' | 'more_testing' =
      rawVerdict === 'approve' || rawVerdict === 'reject' || rawVerdict === 'more_testing'
        ? rawVerdict
        : 'reject';

    return {
      verdict,
      evidence: parsed.evidence || 'No evidence provided',
      modelIdentity,
    };
  }

  /** Build verification prompt for Argus */
  private buildVerificationPrompt(
    incident: RepairIncident,
    diagnosis: AstraDiagnosis,
    diff: string,
    testReport: TestReport
  ): string {
    const testLines = testReport?.results && Array.isArray(testReport.results)
      ? testReport.results.map(t => `- ${t.name}: ${t.passed ? 'PASS' : 'FAIL'} (exitCode=${t.exitCode}, duration=${t.durationMs}ms)\n  stdout: ${(t.stdout || '').slice(0, 300)}\n  stderr: ${(t.stderr || '').slice(0, 300)}`).join('\n')
      : 'No individual test results';

    const baselineInfo = testReport?.baseline
      ? `Baseline Comparison:\n- Verdict: ${testReport.baseline.verdict}\n- Baseline Errors: ${testReport.baseline.baselineErrors?.join(', ') || 'none'}\n- Post-Patch Errors: ${testReport.baseline.postPatchErrors?.join(', ') || 'none'}\n- New Errors: ${testReport.baseline.newErrors?.join(', ') || 'none'}\n- Fixed Errors: ${testReport.baseline.fixedErrors?.join(', ') || 'none'}`
      : `Overall Verdict: ${testReport?.overallVerdict ?? 'unknown'}`;

    return `
Verify the following repair attempt. Return ONLY valid JSON with fields:
- "verdict": "approve" | "reject" | "more_testing"
- "evidence": string explaining the rationale

INCIDENT:
- ID: ${incident.incidentId}
- Component: ${incident.component}
- Failure Domain: ${incident.failureDomain}
- Symptom: ${incident.symptom}

DIAGNOSIS:
- Root Cause: ${diagnosis.rootCause}
- Selected Root Cause: ${diagnosis.selectedRootCause}
- Confidence: ${diagnosis.confidence}
- Risk Level: ${diagnosis.riskLevel}
- Affected Files: ${(diagnosis.affectedFiles || []).join(', ')}

TEST REPORT:
- Overall Verdict: ${testReport?.overallVerdict ?? 'unknown'}
${baselineInfo}

Individual Results:
${testLines}

PROPOSED DIFF:
\`\`\`diff
${diff.slice(0, 8000)}
\`\`\`

QUESTIONS TO EVALUATE:
1. Does the diff directly address the selected root cause?
2. Are any unrelated files or lines modified?
3. Could this change cause a regression in existing functionality?
4. Does this violate architectural boundaries or coding standards?
`.trim();
  }
}

export const repairVerifier = new RepairVerifier();
