/**
 * Phase 3 — Conversational Turn resolution tests.
 *
 * Verifies that Jarvis resolves a typed conversational turn from persisted
 * state BEFORE deciding on a worker: direct answers, worker status/result,
 * continuation, mutation/approval classification, deictic references, and
 * restart continuity — never by guessing from raw text.
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
let turn: any;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convturn-'));
  process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
  vi.resetModules();

  db = (await import('../db/index.js')).db;
  schema = await import('../db/schema.js');
  const projSchema = await import('../services/projectExecution/schema.js');
  projSchema.initProjectExecutionSchema();

  goalStore = (await import('../services/goalStore.js')).goalStore;
  executionRunService = (await import('../services/projectExecution/executionRunService.js')).executionRunService;
  conversationService = (await import('../domains/conversations/service.js')).conversationService;
  turn = await import('../domains/jarvis/conversationalTurn.js');
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const FINDINGS = [
  { id: 'finding-1', title: 'Permissive CORS', evidence: [{ file: 'server/src/index.ts', lineStart: 205 }], priority: 'P0' },
  { id: 'finding-2', title: 'Auth bypass', evidence: [{ file: 'server/src/index.ts', lineStart: 215 }], priority: 'P1' },
  { id: 'finding-3', title: 'Unbounded memory', evidence: [{ file: 'server/src/index.ts' }], priority: 'P1' },
];

const VERDICTS = [
  { findingId: 'finding-1', verdict: 'VERIFIED', evidence: ['cors'], explanation: 'confirmed', priority: 'P0' },
  { findingId: 'finding-2', verdict: 'PARTIALLY_VERIFIED', evidence: ['middleware'], explanation: 'narrower', priority: 'P1' },
  { findingId: 'finding-3', verdict: 'NOT_VERIFIED', evidence: [], explanation: 'absent', priority: 'P2' },
];

function seedConversation(convId: string) {
  db.insert(schema.conversations).values({
    id: convId, title: 'Conversational Turn Test',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }).onConflictDoNothing().run();
}

function seedResult(convId: string, structuredOutput: Record<string, unknown>) {
  const run = executionRunService.createRun({
    taskId: `task-${randomUUID().slice(0, 6)}`, projectId: 'proj-test',
    goalId: `pgoal-${randomUUID().slice(0, 6)}`, workerType: 'codex',
    agentInstanceId: `goal-${randomUUID().slice(0, 8)}`, conversationId: convId,
    metadata: { resultType: structuredOutput.resultType },
  });
  const result = executionRunService.createResult({
    runId: run.id, taskId: run.taskId, status: 'completed', summary: 'seeded', structuredOutput,
  });
  return { run, result };
}

function seedAnalysis(convId: string) {
  return seedResult(convId, {
    resultType: 'analysis', findings: FINDINGS, findingsSource: 'legacy_text_fallback', findingsCount: FINDINGS.length,
  });
}

function seedVerification(convId: string, analysisResultId: string) {
  return seedResult(convId, {
    resultType: 'verification', verificationOfResultId: analysisResultId, sourceResultId: analysisResultId,
    verdicts: VERDICTS, findings: [], findingsSource: 'legacy_text_fallback', findingsCount: 0,
  });
}

async function seedFocusMessage(convId: string, findingId: string, resultId: string) {
  await conversationService.appendMessage({
    conversationId: convId, role: 'agent', messageType: 'message', content: 'resolved finding answer',
    routedAgent: 'jarvis',
    metadata: { resolutionEvidence: { findingId, resolvedResultId: resultId, resultType: 'analysis', resolutionSource: 'graph' } },
  });
}

function seedGoal(convId: string, goalId: string, status: string, runSummary?: any) {
  goalStore.create({
    id: goalId, originalGoal: 'inspect the repository', status, retryCount: 0, providerFallbackCount: 0,
    conversationId: convId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as any);
  if (runSummary) goalStore.update(goalId, { status, runSummary } as any);
}

// ── Pure classifiers ────────────────────────────────────────────────────────

describe('classifyMutationIntent', () => {
  it('classifies the ACTION, not the worker', () => {
    expect(turn.classifyMutationIntent('inspect this code')).toBe('read_only');
    expect(turn.classifyMutationIntent('verify this finding')).toBe('read_only');
    expect(turn.classifyMutationIntent('explain the result')).toBe('none');
    expect(turn.classifyMutationIntent('fix this bug')).toBe('write');
    expect(turn.classifyMutationIntent('deploy it to production')).toBe('external');
    expect(turn.classifyMutationIntent('delete that file')).toBe('destructive');
    expect(turn.classifyMutationIntent('do not modify anything, just inspect')).toBe('read_only');
  });
});

describe('worker status / result / continuation detection', () => {
  it('detects worker status and result questions', () => {
    expect(turn.detectWorkerStatusQuestion('what is codex doing?')).toBe('codex');
    expect(turn.detectWorkerStatusQuestion('is hermes done?')).toBe('hermes');
    expect(turn.detectWorkerResultQuestion('what did codex find?')).toBe('codex');
    expect(turn.detectWorkerResultQuestion('what did hermes say?')).toBe('hermes');
  });
  it('detects continuation', () => {
    expect(turn.detectContinuation('continue')).toBe(true);
    expect(turn.detectContinuation('do it')).toBe(true);
    expect(turn.detectContinuation('fix it')).toBe(true);
    expect(turn.detectContinuation('explain the second problem')).toBe(false);
  });
});

// ── Turn resolution (DB-backed) ─────────────────────────────────────────────

describe('resolveConversationalTurn', () => {
  it('A: "Explain the second problem" → direct answer, finding-2, no worker', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedAnalysis(convId);

    const t = await turn.resolveConversationalTurn(convId, 'Explain the second problem.');
    expect(t.actionType).toBe('direct_answer');
    expect(t.requiresWorker).toBe(false);
    expect(t.references.findingId).toBe('finding-2');
    expect(t.resolvedContext.finding?.title).toMatch(/Auth/i);
    expect(t.resolutionSource).toBe('graph');
  });

  it('A2: "Explain the second one" (deictic ordinal) → finding-2', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedAnalysis(convId);

    const t = await turn.resolveConversationalTurn(convId, 'Explain the second one.');
    expect(t.actionType).toBe('direct_answer');
    expect(t.references.findingId).toBe('finding-2');
  });

  it('A3: "Which one is the most dangerous?" → highest-priority finding', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedAnalysis(convId);

    const t = await turn.resolveConversationalTurn(convId, 'Which one is the most dangerous?');
    expect(t.actionType).toBe('direct_answer');
    expect(t.references.findingId).toBe('finding-1'); // P0 (highest priority)
    expect(t.resolutionSource).toBe('graph');
  });

  it('B: "Was that one verified?" → traversal to finding-2 verdict', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    seedVerification(convId, a.result.id);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'Was that one verified?');
    expect(t.actionType).toBe('direct_answer');
    expect(t.resolvedContext.verdict?.findingId).toBe('finding-2');
    expect(t.resolvedContext.verdict?.verdict).toBe('PARTIALLY_VERIFIED');
    expect(t.requiresWorker).toBe(false);
  });

  it('B2: "Was that one verified?" with no verification → truthful not-verified', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'Was that one verified?');
    expect(t.actionType).toBe('direct_answer');
    expect(t.resolvedContext.verdict).toBeNull();
    expect(t.directMessage).toMatch(/hasn't been verified/i);
  });

  it('C: "Check that one again." → finding-2 resolved BEFORE CodeX delegation', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    seedVerification(convId, a.result.id);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'Check that one again.');
    expect(t.actionType).toBe('verify_finding');
    expect(t.requiresWorker).toBe(true);
    expect(t.worker).toBe('codex');
    expect(t.mutationIntent).toBe('read_only');
    expect(t.requiresApproval).toBe(false);
    expect(t.references.findingId).toBe('finding-2');
  });

  it('D: "What is CodeX doing?" → truthful worker status', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedGoal(convId, `goal-${randomUUID().slice(0, 8)}`, 'running');

    const t = await turn.resolveConversationalTurn(convId, 'What is CodeX doing?');
    expect(t.actionType).toBe('worker_status');
    expect(t.requiresWorker).toBe(false);
  });

  it('E: "What did CodeX do?" → completed result summary', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedGoal(convId, `goal-${randomUUID().slice(0, 8)}`, 'completed', { finalAnswer: 'found five problems' });

    const t = await turn.resolveConversationalTurn(convId, 'What did CodeX do?');
    expect(t.actionType).toBe('worker_result');
    expect(t.worker).toBe('codex');
    expect(t.resolvedContext.recentGoal?.summary).toContain('five problems');
  });

  it('F: "Continue." → continue the active context', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedGoal(convId, `goal-${randomUUID().slice(0, 8)}`, 'running');

    const t = await turn.resolveConversationalTurn(convId, 'Continue.');
    expect(t.actionType).toBe('continue');
  });

  it('G: "Do it." → mutation requires approval', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'Do it.');
    expect(t.actionType).toBe('write');
    expect(t.requiresApproval).toBe(true);
    expect(t.mutationIntent).toBe('write');
  });

  it('G2: read-only continuation does not become a mutation', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'Check that one again.');
    expect(t.mutationIntent).toBe('read_only');
    expect(t.requiresApproval).toBe(false);
  });

  it('H: ambiguous reference → concise clarification, no worker', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    // No results → "explain the second problem" has nothing to resolve.
    const t = await turn.resolveConversationalTurn(convId, 'Explain the second problem.');
    expect(['clarify', 'conversation']).toContain(t.actionType);
    expect(t.requiresWorker).toBe(false);
  });

  it('I: restart continuity — focus reconstructed from persisted state', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    // A fresh call re-reads persisted state (no in-memory dependency).
    const focus = await turn.resolveConversationFocus(convId);
    expect(focus?.findingId).toBe('finding-2');
    expect(focus?.resultId).toBe(a.result.id);
  });

  it('J: cross-worker — "what did Hermes say" resolves to a Hermes result question', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);

    const t = await turn.resolveConversationalTurn(convId, 'What did Hermes say?');
    expect(t.actionType).toBe('worker_result');
    expect(t.worker).toBe('hermes');
  });

  it('"how would you fix it" → plan (no mutation, no approval)', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'How would you fix it?');
    expect(t.actionType).toBe('plan');
    expect(t.mutationIntent).toBe('none');
    expect(t.requiresApproval).toBe(false);
  });
});

// ── Focus reconstruction (post-restart continuity) ─────────────────────────

describe('resolveConversationFocus', () => {
  it('a resolvedResultId-only system_status does not mask the last finding', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);

    // User's last explicit finding reference resolved to finding-2.
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    // A later verification system_status carries resolvedResultId but NO findingId.
    await conversationService.appendMessage({
      conversationId: convId, role: 'system', messageType: 'system_status', content: 'CodeX Goal initialized',
      routedAgent: 'jarvis',
      metadata: {
        resolutionEvidence: { resolvedResultId: a.result.id, resultType: 'analysis', relationshipPath: [a.result.id], resolutionSource: 'graph', confidence: 0.95, reason: 'verify request resolved' },
        targetFindingIndex: 2,
      },
    });

    const focus = await turn.resolveConversationFocus(convId);
    expect(focus).not.toBeNull();
    expect(focus!.findingId).toBe('finding-2');
    expect(focus!.resultId).toBe(a.result.id);
  });
});

describe('cross-result disagreement and re-verify', () => {
  it('"why did CodeX disagree?" resolves analysis-vs-verification from the graph', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    seedVerification(convId, a.result.id);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'Why did CodeX disagree?');
    expect(t.actionType).toBe('direct_answer');
    expect(t.resolutionSource).toBe('graph');
    expect(t.directMessage).toMatch(/disagree/i);
    expect(t.directMessage).toMatch(/partially verified/i);
    expect(t.requiresWorker).toBe(false);
  });

  it('"check it again" → re-verify (read-only, no approval), not a no-op continue', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'Check it again');
    expect(t.actionType).toBe('verify_finding');
    expect(t.mutationIntent).toBe('read_only');
    expect(t.requiresApproval).toBe(false);
    expect(t.requiresWorker).toBe(true);
    expect(t.worker).toBe('codex');
  });

  it('bare "continue" still means continue (no worker)', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'Continue');
    expect(t.actionType).toBe('continue');
    expect(t.requiresWorker).toBe(false);
  });

  it('"what is Hermes doing?" does not borrow a pending CodeX goal', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    await seedFocusMessage(convId, 'finding-2', a.result.id);
    seedGoal(convId, 'goal-wait', 'waiting_for_approval');

    const t = await turn.resolveConversationalTurn(convId, 'What is Hermes doing?');
    expect(t.actionType).toBe('worker_status');
    expect(t.worker).toBe('hermes');
    // The CodeX waiting_for_approval goal must not be attributed to Hermes.
    expect(t.resolvedContext.activeGoal).toBeNull();
  });

  it('"so what did he find?" resolves the focused worker result (deictic)', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'So what did he find?');
    expect(t.actionType).toBe('worker_result');
    expect(t.worker).toBe('codex');
  });
});

// ── Natural response formatting ──────────────────────────────────────────────

describe('formatNaturalResponse', () => {
  it('produces conversational (non-internal) prose', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedAnalysis(convId);

    const t = await turn.resolveConversationalTurn(convId, 'Explain the second problem.');
    const s = turn.formatNaturalResponse(t);
    expect(s).toMatch(/Auth bypass/i);
    expect(s).not.toMatch(/Intent:|Selected agent:|execution status/i);
  });

  it('plan turn produces a grounded (non-"Got it.") answer', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    const a = seedAnalysis(convId);
    await seedFocusMessage(convId, 'finding-2', a.result.id);

    const t = await turn.resolveConversationalTurn(convId, 'How would you fix it?');
    expect(t.actionType).toBe('plan');
    const s = turn.formatNaturalResponse(t);
    expect(s).toMatch(/finding-2/);
    expect(s).not.toMatch(/^Got it\.$/);
  });
});
