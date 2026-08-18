/**
 * verificationService.ts
 *
 * First-class verifier execution.
 *
 * Policy:
 *  - Verifier uses a different provider family from the worker when available.
 *  - Records both worker and verifier provider/model for transparency.
 *  - Structured verdict: PASS | FAIL | NEEDS_REVISION | NOT_PROVEN
 *  - Revision loop: max 3 revisions per verification cycle.
 *  - NEVER fakes readiness — returns NOT_PROVEN if verifier is unavailable.
 */

import { randomUUID } from 'crypto';
import { rawDb } from '../../db/index.js';
import { llmChat } from '../llmGateway.js';
import { logger } from '../../utils/logger.js';
import { redactSecrets } from '../gateway/secretStore.js';
import type { VerificationVerdict } from './schema.js';
import type { ExecutionRunRecord, ExecutionResultRecord } from './executionRunService.js';

// ── Types ─────────────────────────────────────────────────────────────────

export interface VerificationRecord {
  id: string;
  taskId: string;
  targetRunId: string;
  verifierRunId: string | null;
  verifierProvider: string | null;
  verifierModel: string | null;
  workerProvider: string | null;
  workerModel: string | null;
  sameProvider: boolean;
  verdict: VerificationVerdict;
  issues: string[];
  evidence: string[];
  recommendation: string | null;
  revisionCount: number;
  maxRevisions: number;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationInput {
  taskId: string;
  targetRunId: string;
  projectId: string;
  goalId: string;
  objective: string;
  acceptanceCriteria: string | null;
  workerResult: ExecutionResultRecord;
  workerRun: ExecutionRunRecord;
}

export interface VerificationOutput {
  verdict: VerificationVerdict;
  issues: string[];
  evidence: string[];
  recommendation: string;
}

// ── Model diversity selection ──────────────────────────────────────────────

/**
 * Choose a verifier provider/model that is DIFFERENT from the worker's provider.
 * Returns the best available alternative, or null if only one provider is available.
 */
function selectVerifierModel(workerProvider: string | null): {
  provider: string | null;
  model: string | null;
  independent: boolean;
} {
  // Provider family groups — verifier must be from a different group than worker
  const providerFamilies: Record<string, string[]> = {
    deepseek: ['deepseek', 'prov-deepseek'],
    openai: ['openai', 'openrouter'],
    anthropic: ['anthropic', 'claude'],
    google: ['google', 'gemini', 'vertex'],
    ollama: ['ollama', 'omniRoute'],
    qwen: ['qwen', 'qwq'],
  };

  function getFamily(provider: string | null): string | null {
    if (!provider) return null;
    const p = provider.toLowerCase();
    for (const [family, aliases] of Object.entries(providerFamilies)) {
      if (aliases.some(a => p.includes(a))) return family;
    }
    return provider;
  }

  const workerFamily = getFamily(workerProvider);

  // Preference order: try to pick from a different family
  const preferenceOrder = ['openai', 'anthropic', 'google', 'deepseek', 'ollama', 'qwen'];
  for (const family of preferenceOrder) {
    if (family !== workerFamily) {
      // Return preference — actual availability checked at call time
      const preferred = providerFamilies[family]?.[0] ?? family;
      return { provider: preferred, model: null, independent: true };
    }
  }

  // Fallback: same provider, flag it
  return { provider: workerProvider, model: null, independent: false };
}

// ── Verifier prompt ────────────────────────────────────────────────────────

function buildVerifierPrompt(input: VerificationInput): string {
  const { objective, acceptanceCriteria, workerResult, workerRun } = input;

  let formattedResult = '';
  if (workerResult.summary) {
    formattedResult += `Summary: ${workerResult.summary}\n\n`;
  }

  if (workerResult.structuredOutput) {
    const sOut = workerResult.structuredOutput;
    if (typeof sOut === 'object' && sOut !== null) {
      if (sOut.title) formattedResult += `Page Title: ${sOut.title}\n`;
      if (sOut.finalUrl || sOut.url) formattedResult += `URL: ${sOut.finalUrl || sOut.url}\n`;
      if (sOut.text || sOut.content) formattedResult += `Extracted Content/Text:\n${sOut.text || sOut.content}\n\n`;
      if (sOut.changedFiles && Array.isArray(sOut.changedFiles)) {
        formattedResult += `Changed Files: ${sOut.changedFiles.join(', ')}\n`;
      }
      if (sOut.fileContent) {
        formattedResult += `File Content:\n${sOut.fileContent}\n\n`;
      }
      formattedResult += `Structured Details:\n${JSON.stringify(sOut, null, 2).slice(0, 30000)}`;
    } else {
      formattedResult += `Structured Output:\n${String(sOut).slice(0, 30000)}`;
    }
  }

  const artifactDetails = workerResult.artifactRefs?.length
    ? workerResult.artifactRefs.join(', ')
    : 'None';

  return `You are an independent verification agent. Your task is to verify whether the following work result meets the stated objective and acceptance criteria.

OBJECTIVE:
${objective}

ACCEPTANCE CRITERIA:
${acceptanceCriteria ?? 'No explicit acceptance criteria specified. Use reasonable professional judgment based on the objective.'}

WORKER TYPE:
${workerRun.workerType} (Provider: ${workerRun.provider || 'default'}, Model: ${workerRun.model || 'default'})

WORKER EVIDENCE & OUTPUT:
${redactSecrets(formattedResult.trim()) || 'No output recorded'}

ARTIFACTS REFERENCED:
${redactSecrets(artifactDetails)}

Your job is to assess:
1. Does the evidence demonstrate that the objective was accomplished?
2. Does the result satisfy the acceptance criteria?
3. Are there any blocking issues, discrepancies, or missing requirements?

Respond with ONLY valid JSON in this exact format:
{
  "verdict": "PASS" | "FAIL" | "NEEDS_REVISION" | "NOT_PROVEN",
  "issues": ["<issue 1>", "<issue 2>"],
  "evidence": ["<evidence 1>", "<evidence 2>"],
  "recommendation": "<brief recommendation>"
}

Verdict definitions:
- PASS: Objective fully met with clear evidence, no blocking issues.
- FAIL: Objective not met, wrong outcome, or blocking failure.
- NEEDS_REVISION: Partially met, fixable issues exist within retry budget.
- NOT_PROVEN: Insufficient evidence available to confirm or deny success.

Do not add any text outside the JSON.`;
}

// ── Parse verifier response ────────────────────────────────────────────────

function parseVerifierResponse(raw: string): VerificationOutput | null {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    const verdicts: VerificationVerdict[] = ['PASS', 'FAIL', 'NEEDS_REVISION', 'NOT_PROVEN'];
    if (!verdicts.includes(parsed.verdict)) return null;
    return {
      verdict: parsed.verdict,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      recommendation: typeof parsed.recommendation === 'string' ? parsed.recommendation : '',
    };
  } catch {
    return null;
  }
}

// ── DB helpers ─────────────────────────────────────────────────────────────

function rowToVerification(row: any): VerificationRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    targetRunId: row.target_run_id,
    verifierRunId: row.verifier_run_id ?? null,
    verifierProvider: row.verifier_provider ?? null,
    verifierModel: row.verifier_model ?? null,
    workerProvider: row.worker_provider ?? null,
    workerModel: row.worker_model ?? null,
    sameProvider: !!row.same_provider,
    verdict: (row.verdict ?? 'NOT_PROVEN') as VerificationVerdict,
    issues: (() => { try { return JSON.parse(row.issues ?? '[]'); } catch { return []; } })(),
    evidence: (() => { try { return JSON.parse(row.evidence ?? '[]'); } catch { return []; } })(),
    recommendation: row.recommendation ?? null,
    revisionCount: row.revision_count ?? 0,
    maxRevisions: row.max_revisions ?? 3,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Service ────────────────────────────────────────────────────────────────

export const verificationService = {

  async verify(input: VerificationInput): Promise<VerificationRecord> {
    const id = `ver-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    // Determine verifier model selection
    const workerProvider = input.workerRun.provider;
    const verifierSelection = selectVerifierModel(workerProvider);

    logger.info(`[Verifier] Starting verification ${id} for run ${input.targetRunId}`);
    logger.info(`[Verifier] Worker provider: ${workerProvider} | Verifier provider: ${verifierSelection.provider} | Independent: ${verifierSelection.independent}`);

    // Create pending verification record
    rawDb.prepare(`
      INSERT INTO verifications
        (id, task_id, target_run_id, verifier_provider, verifier_model, worker_provider, worker_model,
         same_provider, verdict, issues, evidence, revision_count, max_revisions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NOT_PROVEN', '[]', '[]', 0, 3, ?, ?)
    `).run(
      id,
      input.taskId,
      input.targetRunId,
      verifierSelection.provider ?? null,
      verifierSelection.model ?? null,
      workerProvider ?? null,
      input.workerRun.model ?? null,
      verifierSelection.independent ? 0 : 1,
      now, now,
    );

    // Execute verification via LLM
    let output: VerificationOutput | null = null;
    let verifierProviderActual: string | null = null;
    let verifierModelActual: string | null = null;

    try {
      const prompt = buildVerifierPrompt(input);
      const result = await llmChat({
        prompt,
        systemPrompt: 'You are an independent verification agent. Always respond with valid JSON only.',
        provider: verifierSelection.provider ?? undefined,
        maxTokens: 1024,
      });

      verifierProviderActual = result.provider ?? verifierSelection.provider;
      verifierModelActual = result.model ?? verifierSelection.model;

      output = parseVerifierResponse(result.reply);
      if (!output) {
        logger.warn(`[Verifier] Could not parse verifier response: ${result.reply?.slice(0, 200)}`);
        output = {
          verdict: 'NOT_PROVEN',
          issues: ['Could not parse verifier response'],
          evidence: [],
          recommendation: 'Manual review required',
        };
      }
    } catch (err: any) {
      logger.error(`[Verifier] LLM call failed:`, err.message);
      output = {
        verdict: 'NOT_PROVEN',
        issues: [`Verifier LLM unavailable: ${err.message}`],
        evidence: [],
        recommendation: 'Retry when LLM provider is available',
      };
    }

    // Persist result
    const updatedNow = new Date().toISOString();
    rawDb.prepare(`
      UPDATE verifications
      SET verdict = ?, issues = ?, evidence = ?, recommendation = ?,
          verifier_provider = ?, verifier_model = ?,
          same_provider = ?, updated_at = ?
      WHERE id = ?
    `).run(
      output.verdict,
      JSON.stringify(output.issues),
      JSON.stringify(output.evidence),
      output.recommendation,
      verifierProviderActual ?? null,
      verifierModelActual ?? null,
      verifierProviderActual === workerProvider ? 1 : 0,
      updatedNow,
      id,
    );

    // ── Enforce Verification Lifecycle Semantics on Task ──
    const { projectTaskService } = await import('./projectTaskService.js');
    const { executionRunService } = await import('./executionRunService.js');

    if (output.verdict === 'PASS') {
      projectTaskService.updateTask(input.taskId, { status: 'completed', completedAt: updatedNow });
    } else if (output.verdict === 'FAIL') {
      projectTaskService.updateTask(input.taskId, { status: 'failed_verification' });
    } else if (output.verdict === 'NEEDS_REVISION') {
      projectTaskService.updateTask(input.taskId, { status: 'needs_revision' });
    } else {
      projectTaskService.updateTask(input.taskId, { status: 'needs_review' });
    }

    executionRunService.emitEvent({
      projectId: input.projectId,
      goalId: input.goalId,
      taskId: input.taskId,
      runId: input.targetRunId,
      worker: 'verifier',
      eventType: 'TASK_VERIFICATION_COMPLETED',
      payload: {
        verificationId: id,
        verdict: output.verdict,
        issues: output.issues,
        verifierProvider: verifierProviderActual,
        workerProvider,
        sameProvider: verifierProviderActual === workerProvider,
      },
    });

    logger.info(`[Verifier] Verification ${id} complete: ${output.verdict} for task ${input.taskId}`);
    return this.getVerification(id)!;
  },

  getVerification(id: string): VerificationRecord | null {
    const row = rawDb.prepare('SELECT * FROM verifications WHERE id = ?').get(id);
    return row ? rowToVerification(row) : null;
  },

  listVerificationsForTask(taskId: string): VerificationRecord[] {
    return rawDb.prepare(
      'SELECT * FROM verifications WHERE task_id = ? ORDER BY created_at DESC'
    ).all(taskId).map(rowToVerification);
  },

  getVerificationForRun(runId: string): VerificationRecord | null {
    const row = rawDb.prepare(
      'SELECT * FROM verifications WHERE target_run_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(runId);
    return row ? rowToVerification(row) : null;
  },
};
