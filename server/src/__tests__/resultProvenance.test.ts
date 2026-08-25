/**
 * Phase 2 — Result Relationships & Provenance Graph tests.
 *
 * Verifies that:
 *  - New results carry an explicit resultType (analysis/verification).
 *  - A verification result records verificationOfResultId = analysis result id.
 *  - Verification verdicts are keyed by finding id (not title text).
 *  - The graph resolver resolves references from persisted typed state
 *    (analysis → verification traversal, finding-id verdict lookup, legacy
 *    fallback, ambiguity clarification) and is immune to conversation text.
 *
 * DB: isolated per-file via AGENT_TEAMS_DB_PATH + vi.resetModules() (matches
 * the project's isolated-test convention).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let tmpDir: string;
let db: any;
let schema: any;
let goalStore: any;
let executionRunService: any;
let conversationService: any;
let codexAdapter: any;
let provenance: any;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resultprovenance-'));
  process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
  vi.resetModules();

  db = (await import('../db/index.js')).db;
  schema = await import('../db/schema.js');
  const projSchema = await import('../services/projectExecution/schema.js');
  projSchema.initProjectExecutionSchema();

  goalStore = (await import('../services/goalStore.js')).goalStore;
  executionRunService = (await import('../services/projectExecution/executionRunService.js')).executionRunService;
  conversationService = (await import('../domains/conversations/service.js')).conversationService;
  codexAdapter = await import('../domains/workerAdapters/codexAdapter.js');
  provenance = await import('../services/projectExecution/resultProvenance.js');
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const ANALYSIS_FINAL_ANSWER = `Read-only CodeX analysis. No files modified.

=== FINDING 1: Permissive CORS configuration ===
server/src/index.ts (line 205)
Production impact: any website can make cross-origin requests.
Priority: P0
Confidence: High

=== FINDING 2: Auth bypassed for a broad route set ===
server/src/index.ts (lines 215-220)
Production impact: routes unauthenticated in production.
Priority: P1
Confidence: High

=== FINDING 3: Unbounded in-memory conversations ===
server/src/index.ts (lines 300-310)
Production impact: data lost on restart.
Priority: P1
Confidence: High
`;

const VERIFICATION_FINAL_ANSWER = `Read-only verification complete. No files modified.

Finding ID: finding-1
Decision: VERIFIED
Files Inspected: server/src/index.ts
Concrete Evidence: app.use(cors({ origin: '*' })) at line 205.
Technical Assessment: The CORS configuration is permissive as reported.
Production Impact & Priority: P0

Finding ID: finding-2
Decision: PARTIALLY VERIFIED
Files Inspected: server/src/index.ts
Concrete Evidence: middleware skip confirmed for a subset of paths.
Technical Assessment: The bypass is narrower than claimed.
Production Impact & Priority: P1

Finding ID: finding-3
Decision: NOT VERIFIED
Files Inspected: server/src/index.ts
Concrete Evidence: no unbounded array found in current source.
Technical Assessment: The claim is not supported by current source.
Production Impact & Priority: P2
`;

const TYPED_FINDINGS = [
  { id: 'finding-1', title: 'Permissive CORS', evidence: [{ file: 'server/src/index.ts', lineStart: 205 }], priority: 'P0' },
  { id: 'finding-2', title: 'Auth bypass', evidence: [{ file: 'server/src/index.ts', lineStart: 215 }], priority: 'P1' },
  { id: 'finding-3', title: 'Unbounded memory', evidence: [{ file: 'server/src/index.ts' }], priority: 'P1' },
];

const TYPED_VERDICTS = [
  { findingId: 'finding-1', verdict: 'VERIFIED', evidence: ['cors call present'], explanation: 'confirmed', priority: 'P0' },
  { findingId: 'finding-2', verdict: 'PARTIALLY_VERIFIED', evidence: ['middleware skip confirmed'], explanation: 'narrower', priority: 'P1' },
  { findingId: 'finding-3', verdict: 'NOT_VERIFIED', evidence: [], explanation: 'absent', priority: 'P2' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function seedConversation(convId: string) {
  db.insert(schema.conversations).values({
    id: convId,
    title: 'Provenance Test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).onConflictDoNothing().run();
}

function seedGoal(goalId: string, runSummary?: any) {
  goalStore.create({
    id: goalId,
    originalGoal: 'analyze the repository',
    status: 'completed',
    retryCount: 0,
    providerFallbackCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as any);
  if (runSummary) {
    goalStore.update(goalId, { status: 'completed', runSummary } as any);
  }
}

/** Directly seed a run + result with a fully-controlled structured_output. */
function seedResult(convId: string, structuredOutput: Record<string, unknown>) {
  const run = executionRunService.createRun({
    taskId: `task-${randomUUID().slice(0, 6)}`,
    projectId: 'proj-test',
    goalId: `pgoal-${randomUUID().slice(0, 6)}`,
    workerType: 'codex',
    agentInstanceId: `goal-${randomUUID().slice(0, 8)}`,
    conversationId: convId,
    metadata: { resultType: structuredOutput.resultType },
  });
  const result = executionRunService.createResult({
    runId: run.id,
    taskId: run.taskId,
    status: 'completed',
    summary: 'seeded result',
    structuredOutput,
  });
  return { run, result };
}

function seedAnalysis(convId: string, findings: any[] = TYPED_FINDINGS) {
  return seedResult(convId, {
    resultType: 'analysis',
    findings,
    findingsSource: 'legacy_text_fallback',
    findingsCount: findings.length,
  });
}

function seedVerification(convId: string, analysisResultId: string, verdicts: any[] = TYPED_VERDICTS) {
  return seedResult(convId, {
    resultType: 'verification',
    verificationOfResultId: analysisResultId,
    sourceResultId: analysisResultId,
    verdicts,
    findings: [],
    findingsSource: 'legacy_text_fallback',
    findingsCount: 0,
  });
}

// ── Unit: verdict parsing & provenance fields ──────────────────────────────

describe('parseVerdictsFromText (finding-id keyed verdicts)', () => {
  it('extracts per-finding verdicts keyed by finding id (not title)', () => {
    const verdicts = provenance.parseVerdictsFromText(VERIFICATION_FINAL_ANSWER);
    expect(verdicts).toHaveLength(3);
    expect(verdicts[0].findingId).toBe('finding-1');
    expect(verdicts[0].verdict).toBe('VERIFIED');
    expect(verdicts[1].findingId).toBe('finding-2');
    expect(verdicts[1].verdict).toBe('PARTIALLY_VERIFIED');
    expect(verdicts[2].findingId).toBe('finding-3');
    expect(verdicts[2].verdict).toBe('NOT_VERIFIED');
  });

  it('returns [] for empty/non-verdict text', () => {
    expect(provenance.parseVerdictsFromText('')).toEqual([]);
    expect(provenance.parseVerdictsFromText('a prose report with no finding ids')).toEqual([]);
  });
});

describe('buildProvenanceFields', () => {
  it('emits only present fields', () => {
    const fields = provenance.buildProvenanceFields({
      resultType: 'verification',
      verificationOfResultId: 'exr-a',
      sourceResultId: 'exr-a',
    });
    expect(fields.resultType).toBe('verification');
    expect(fields.verificationOfResultId).toBe('exr-a');
    expect(fields.sourceResultId).toBe('exr-a');
    expect(fields.parentResultId).toBeUndefined();
    expect(fields.verdicts).toBeUndefined();
  });
});

// ── Persistence: resultType + relationship + verdicts via reconcile ────────

describe('reconcileGoalToResult persists resultType & relationships (cases A/B/C)', () => {
  it('persists resultType = analysis on a new analysis result', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedGoal(goalId);
    executionRunService.createRun({
      taskId: `task-${randomUUID().slice(0, 6)}`,
      projectId: 'proj-test',
      goalId: `pgoal-${randomUUID().slice(0, 6)}`,
      workerType: 'codex',
      agentInstanceId: goalId,
      conversationId: convId,
      metadata: { resultType: 'analysis' },
    });

    const rec = await codexAdapter.reconcileGoalToResult(goalId, ANALYSIS_FINAL_ANSWER);
    expect(rec.resultType).toBe('analysis');
    const result = executionRunService.getResult(rec.resultId!);
    expect((result.structuredOutput as any).resultType).toBe('analysis');
    expect(Array.isArray((result.structuredOutput as any).findings)).toBe(true);
    expect((result.structuredOutput as any).findings.length).toBe(3);
  });

  it('persists resultType = verification + verificationOfResultId = analysis result id, with finding-id verdicts', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;

    // Analysis
    const analysisGoalId = `goal-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedGoal(analysisGoalId);
    executionRunService.createRun({
      taskId: `task-${randomUUID().slice(0, 6)}`, projectId: 'proj-test', goalId: `pgoal-${randomUUID().slice(0, 6)}`,
      workerType: 'codex', agentInstanceId: analysisGoalId, conversationId: convId,
      metadata: { resultType: 'analysis' },
    });
    const analysisRec = await codexAdapter.reconcileGoalToResult(analysisGoalId, ANALYSIS_FINAL_ANSWER);

    // Verification
    const verifyGoalId = `goal-${randomUUID().slice(0, 8)}`;
    seedGoal(verifyGoalId);
    executionRunService.createRun({
      taskId: `task-${randomUUID().slice(0, 6)}`, projectId: 'proj-test', goalId: `pgoal-${randomUUID().slice(0, 6)}`,
      workerType: 'codex', agentInstanceId: verifyGoalId, conversationId: convId,
      metadata: {
        resultType: 'verification',
        verificationOfResultId: analysisRec.resultId!,
        sourceResultId: analysisRec.resultId!,
      },
    });
    const verifyRec = await codexAdapter.reconcileGoalToResult(verifyGoalId, VERIFICATION_FINAL_ANSWER);

    expect(verifyRec.resultType).toBe('verification');
    expect(verifyRec.verificationOfResultId).toBe(analysisRec.resultId);

    const vResult = executionRunService.getResult(verifyRec.resultId!);
    const sOut = vResult.structuredOutput as any;
    expect(sOut.resultType).toBe('verification');
    expect(sOut.verificationOfResultId).toBe(analysisRec.resultId);
    expect(Array.isArray(sOut.verdicts)).toBe(true);
    expect(sOut.verdicts.length).toBe(3);
    expect(sOut.verdicts[1].findingId).toBe('finding-2');
    expect(sOut.verdicts[1].verdict).toBe('PARTIALLY_VERIFIED');
  });
});

// ── Resolver: reference behaviors (cases E–I, K–N) ─────────────────────────

describe('resolveResultReference — graph-first resolution', () => {
  it('E: "Explain the second problem" resolves the analysis result + finding-2 (not the verification)', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const analysis = seedAnalysis(convId);
    seedVerification(convId, analysis.result.id);

    const ref = provenance.resolveResultReference({
      conversationId: convId, worker: 'codex', userPrompt: 'Explain the second problem CodeX found.',
    });
    expect(ref.result!.id).toBe(analysis.result.id);
    expect(ref.resultType).toBe('analysis');
    expect(ref.findingId).toBe('finding-2');
    expect(ref.finding!.title).toMatch(/Auth/i);
    expect(ref.resolutionSource).toBe('graph');
    expect(ref.relationshipPath).toEqual([analysis.result.id]);
  });

  it('F: "Explain CodeX\'s verification" resolves the verification result', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const analysis = seedAnalysis(convId);
    const verification = seedVerification(convId, analysis.result.id);

    const ref = provenance.resolveResultReference({
      conversationId: convId, worker: 'codex', userPrompt: "Explain CodeX's verification.",
    });
    expect(ref.result!.id).toBe(verification.result.id);
    expect(ref.resultType).toBe('verification');
    expect(ref.resolutionSource).toBe('graph');
  });

  it('G: "What was the verdict on the second problem?" traverses analysis → verification and resolves finding-2 verdict', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const analysis = seedAnalysis(convId);
    const verification = seedVerification(convId, analysis.result.id);

    const ref = provenance.resolveResultReference({
      conversationId: convId, worker: 'codex', userPrompt: "What was CodeX's verdict on the second problem?",
    });
    expect(ref.relationshipPath).toEqual([analysis.result.id, verification.result.id]);
    expect(ref.findingId).toBe('finding-2');
    expect(ref.verdict).not.toBeNull();
    expect(ref.verdict!.findingId).toBe('finding-2');
    expect(ref.verdict!.verdict).toBe('PARTIALLY_VERIFIED');
    expect(ref.resultType).toBe('verification');
    expect(ref.resolutionSource).toBe('graph');
  });

  it('resolves a deictic "that problem" verdict via findingIndexHint (context hint, not text)', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const analysis = seedAnalysis(convId);
    const verification = seedVerification(convId, analysis.result.id);

    const ref = provenance.resolveResultReference({
      conversationId: convId,
      worker: 'codex',
      userPrompt: "What was CodeX's verdict on that problem?",
      findingIndexHint: 2, // the last-resolved finding was finding-2
    });
    expect(ref.relationshipPath).toEqual([analysis.result.id, verification.result.id]);
    expect(ref.findingId).toBe('finding-2');
    expect(ref.verdict!.verdict).toBe('PARTIALLY_VERIFIED');
    expect(ref.resultType).toBe('verification');
  });

  it('H: "Verify the five problems" targets the analysis result, not the (newer) verification', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const analysis = seedAnalysis(convId);
    seedVerification(convId, analysis.result.id); // newer, but must NOT be the target

    const ref = provenance.resolveResultReference({
      conversationId: convId, worker: 'codex', userPrompt: 'Verify the five problems CodeX reported.',
    });
    expect(ref.result!.id).toBe(analysis.result.id);
    expect(ref.resultType).toBe('analysis');
    expect(ref.resolutionSource).toBe('graph');
    // relationshipPath is the analysis only (no accidental verification-of-verification).
    expect(ref.relationshipPath).toEqual([analysis.result.id]);
  });

  it('I: with multiple analyses, "verify" resolves the most recent analysis (not an older one or a verification)', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedAnalysis(convId); // older analysis
    const latest = seedAnalysis(convId); // newer analysis
    seedVerification(convId, latest.result.id); // verification of the latest

    const ref = provenance.resolveResultReference({
      conversationId: convId, worker: 'codex', userPrompt: 'Verify the five problems CodeX reported.',
    });
    expect(ref.result!.id).toBe(latest.result.id);
    expect(ref.resultType).toBe('analysis');
  });

  it('K: historical result without relationship data resolves via legacy fallback', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    // No resultType field → legacy.
    seedResult(convId, {
      findings: TYPED_FINDINGS,
      findingsSource: 'legacy_text_fallback',
      findingsCount: TYPED_FINDINGS.length,
    });

    const ref = provenance.resolveResultReference({
      conversationId: convId, worker: 'codex', userPrompt: 'Verify the five problems CodeX reported.',
    });
    expect(ref.result).not.toBeNull();
    expect(ref.resultType).toBe('other');
    expect(ref.resolutionSource).toBe('legacy');
  });

  it('L: no matching result returns a truthful no-result', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId); // no results seeded
    const ref = provenance.resolveResultReference({
      conversationId: convId, worker: 'codex', userPrompt: 'Explain the second problem.',
    });
    expect(ref.result).toBeNull();
    expect(ref.resolutionSource).toBe('none');
    expect(ref.clarification).toBeTruthy();
  });

  it('M: ambiguous "verify what CodeX just reported" returns a clarification, not a low-confidence guess', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const analysis = seedAnalysis(convId);
    seedVerification(convId, analysis.result.id); // latest is a verification

    const ref = provenance.resolveResultReference({
      conversationId: convId, worker: 'codex', userPrompt: 'Verify what CodeX just reported.',
    });
    expect(ref.clarification).toBeTruthy();
    expect(ref.resolutionSource).toBe('none');
    expect(ref.confidence).toBeLessThan(0.5);
  });

  it('N: conversation-text formatting changes do not change graph resolution', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const analysis = seedAnalysis(convId);
    seedVerification(convId, analysis.result.id);

    // A mirror message with completely wrong text must not affect resolution.
    conversationService.appendMessage({
      conversationId: convId, role: 'agent', messageType: 'message',
      content: 'the sky is blue and bananas are yellow — nothing to do with findings',
      routedAgent: 'codex', goalId: analysis.run.agentInstanceId,
      metadata: { worker: 'codex', groundedEvidence: true, workerResult: true },
    });

    const ref = provenance.resolveResultReference({
      conversationId: convId, worker: 'codex', userPrompt: 'Explain the second problem CodeX found.',
    });
    expect(ref.result!.id).toBe(analysis.result.id);
    expect(ref.findingId).toBe('finding-2');
    expect(ref.finding!.title).toMatch(/Auth/i);
  });
});

// ── Resolver: restart survival from persisted state (case J) ───────────────

describe('graph survives reinitialization (persisted state, not in-memory)', () => {
  it('resolves the analysis → verification relationship from execution_results alone', () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const analysis = seedAnalysis(convId);
    seedVerification(convId, analysis.result.id);

    // "Restart": re-read the canonical rows directly from persistence and
    // assert the relationship is fully reconstructed from structured_output.
    const aRow = executionRunService.getResult(analysis.result.id);
    const aStructured = aRow.structuredOutput as any;
    expect(aStructured.resultType).toBe('analysis');

    // The verification result persists its back-link to the analysis result id.
    const verification = provenance.listConversationResults(convId, 'codex')
      .find((e: any) => e.resultType === 'verification');
    expect(verification).toBeTruthy();
    expect(verification.verificationOfResultId).toBe(analysis.result.id);

    // A fresh resolution (stateless — reads SQL directly) still traverses.
    const ref = provenance.resolveResultReference({
      conversationId: convId, worker: 'codex', userPrompt: "What was the verdict on the third problem?",
    });
    expect(ref.relationshipPath).toEqual([analysis.result.id, verification.result.id]);
    expect(ref.verdict!.findingId).toBe('finding-3');
    expect(ref.verdict!.verdict).toBe('NOT_VERIFIED');
  });
});

// ── Exactly-once persistence ────────────────────────────────────────────────

describe('exactly-once result persistence', () => {
  it('reconcile never creates a second result for the same run', async () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedGoal(goalId);
    executionRunService.createRun({
      taskId: `task-${randomUUID().slice(0, 6)}`, projectId: 'proj-test', goalId: `pgoal-${randomUUID().slice(0, 6)}`,
      workerType: 'codex', agentInstanceId: goalId, metadata: { resultType: 'analysis' },
    });
    const first = await codexAdapter.reconcileGoalToResult(goalId, ANALYSIS_FINAL_ANSWER);
    const second = await codexAdapter.reconcileGoalToResult(goalId, ANALYSIS_FINAL_ANSWER);
    expect(second.resultId).toBe(first.resultId);
  });
});
