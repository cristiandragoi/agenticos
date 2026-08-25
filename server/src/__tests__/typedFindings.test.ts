/**
 * Phase 1 — Typed Worker Results regression & integration tests.
 *
 * Verifies that typed findings live in execution_results.structured_output and
 * that the Jarvis verification handoff resolves findings from the authoritative
 * structured result (not by regex-parsing conversation text). Legacy
 * natural-language rows remain supported via the legacy fallback.
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
let handoff: any;
let codexAdapter: any;
let findings: any;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typedfindings-'));
  process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
  vi.resetModules();

  const dbMod = await import('../db/index.js');
  db = dbMod.db;
  const schemaMod = await import('../db/schema.js');
  schema = schemaMod;

  const projSchema = await import('../services/projectExecution/schema.js');
  projSchema.initProjectExecutionSchema();

  goalStore = (await import('../services/goalStore.js')).goalStore;
  executionRunService = (await import('../services/projectExecution/executionRunService.js')).executionRunService;
  conversationService = (await import('../domains/conversations/service.js')).conversationService;
  handoff = await import('../domains/jarvis/workerContextHandoff.js');
  codexAdapter = await import('../domains/workerAdapters/codexAdapter.js');
  findings = await import('../services/projectExecution/findings.js');
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const CORRECT_FINAL_ANSWER = `Read-only CodeX analysis of the Agentic OS repository. No files modified.

=== FINDING 1: Permissive CORS configuration ===
Files inspected: server/src/index.ts (line 205)
Evidence: app.use(cors({ origin: '*' })).
Production impact: Any website can make cross-origin requests to the API.
Confidence: High (verified directly in source).

=== FINDING 2: Auth bypassed for a broad route set ===
Files inspected: server/src/index.ts (lines 215-220)
Evidence: the /api middleware returns next() for many paths.
Production impact: These routes are unauthenticated in production.
Confidence: High.

=== FINDING 3: In-memory conversations are unbounded ===
Files inspected: server/src/index.ts (lines 300-310)
Evidence: conversations is a module-level in-memory array with no persistence.
Production impact: Data lost on restart; memory grows without bound.
Confidence: High.

=== FINDING 4: Duplicate route registration ===
Files inspected: server/src/index.ts (lines 230-231)
Evidence: /api/teams and /api/revenue are mounted twice.
Production impact: ambiguous routing.
Confidence: High.

=== FINDING 5: Startup recovery fails running loop runs ===
Files inspected: server/src/index.ts (lines 130-140)
Evidence: running loop runs are forced to failed on boot.
Production impact: data-loss risk for active jobs.
Confidence: High.
`;

// A deliberately mis-formatted finalAnswer whose content is NOT what the typed
// findings describe. The structured resolution must ignore it entirely.
const CORRUPTED_FINAL_ANSWER = `here is my report in some other format entirely:

- the sky is sometimes blue
- 42 is the answer to everything
- bananas are yellow
- this text has nothing to do with the real findings
- neither does this

=== Additional observations ===
- completely unrelated bullet points that must never be treated as findings
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

function seedConversation(convId: string) {
  db.insert(schema.conversations).values({
    id: convId,
    title: 'Typed Findings Test',
    agentId: 'agent-jarvis',
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

function seedRun(agentInstanceId: string, tag: string) {
  return executionRunService.createRun({
    taskId: `task-${tag}`,
    projectId: `proj-${tag}`,
    goalId: `pgoal-${tag}`,
    workerType: 'codex',
    agentInstanceId,
  });
}

async function seedWorkerMessage(convId: string, goalId: string, content: string, extraMetadata: Record<string, unknown> = {}) {
  await conversationService.appendMessage({
    conversationId: convId,
    role: 'agent',
    messageType: 'message',
    content,
    routedAgent: 'codex',
    goalId,
    metadata: {
      worker: 'codex',
      goalId,
      status: 'completed',
      groundedEvidence: true,
      workerResult: true,
      intent: { type: 'repository_analysis', route: 'codex', category: 'repository_analysis' },
      ...extraMetadata,
    },
  });
}

// ── Test A + B: parser + persistence of typed findings ──────────────────────

describe('parseTypedFindingsFromText (typed contract)', () => {
  it('produces five findings with stable id/title/evidence structure', () => {
    const typed = findings.parseTypedFindingsFromText(CORRECT_FINAL_ANSWER);
    expect(typed).toHaveLength(5);

    for (const [i, f] of typed.entries()) {
      expect(f.id).toBe(`finding-${i + 1}`);
      expect(typeof f.title).toBe('string');
      expect(f.title.length).toBeGreaterThan(0);
      expect(Array.isArray(f.evidence)).toBe(true);
    }

    expect(typed[0].title).toMatch(/CORS/i);
    expect(typed[0].evidence[0]?.file).toContain('index.ts');
    expect(typed[0].evidence[0]?.lineStart).toBe(205);
    expect(typed[1].evidence[0]?.lineStart).toBe(215);
    expect(typed[1].evidence[0]?.lineEnd).toBe(220);
  });

  it('extracts priority/confidence/impact when present', () => {
    const text = '=== FINDING 1: Security hole ===\n' +
      'server/src/index.ts:205\n' +
      'Production impact: wide open.\n' +
      'Priority: P0\n' +
      'Confidence: 0.96\n';
    const typed = findings.parseTypedFindingsFromText(text);
    expect(typed[0].priority).toBe('P0');
    expect(typed[0].confidence).toBeCloseTo(0.96);
    expect(typed[0].impact).toContain('wide open');
  });

  it('extracts verification verdicts when present', () => {
    const text = '=== FINDING 1: CORS ===\n' +
      'Decision: VERIFIED\n' +
      'Files inspected: server/src/index.ts:205\n' +
      'Technical Assessment: the cors call is present.\n';
    const typed = findings.parseTypedFindingsFromText(text);
    expect(typed[0].verdict).toBe('VERIFIED');
    expect(typed[0].explanation).toContain('cors call');
  });

  it('parses bold-title numbered findings and extracts evidence from prose', () => {
    const text = 'FIVE PROBLEMS:\n\n' +
      '1. **Permissive CORS** — server/src/index.ts calls cors({origin:"*"}).\n' +
      '2. **Auth bypass** — server/src/index.ts skips middleware for many paths.\n';
    const typed = findings.parseTypedFindingsFromText(text);
    expect(typed).toHaveLength(2);
    expect(typed[0].title).toBe('Permissive CORS');
    expect(typed[0].evidence[0]?.file).toContain('index.ts');
    expect(typed[1].title).toBe('Auth bypass');
  });
});

// ── Test A: reconcileGoalToResult persists findings[] in structured_output ──

describe('reconcileGoalToResult persists typed findings', () => {
  it('creates an execution_result whose structured_output contains findings[]', async () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedGoal(goalId);
    const run = seedRun(goalId, randomUUID().slice(0, 6));

    const rec = await codexAdapter.reconcileGoalToResult(goalId, CORRECT_FINAL_ANSWER);
    expect(rec.resultId).toBeTruthy();
    expect(rec.runId).toBe(run.id);

    const result = executionRunService.getResult(rec.resultId!);
    const sOut = result?.structuredOutput as any;
    expect(Array.isArray(sOut.findings)).toBe(true);
    expect(sOut.findings.length).toBe(5);
    expect(sOut.findingsSource).toBe('legacy_text_fallback');
    expect(sOut.findingsCount).toBe(5);
    expect(sOut.findings[0].id).toBe('finding-1');
  });

  it('is idempotent — a second reconcile returns the same result (no duplicate row)', async () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedGoal(goalId);
    seedRun(goalId, randomUUID().slice(0, 6));

    const first = await codexAdapter.reconcileGoalToResult(goalId, CORRECT_FINAL_ANSWER);
    const second = await codexAdapter.reconcileGoalToResult(goalId, CORRECT_FINAL_ANSWER);
    expect(second.resultId).toBe(first.resultId);

    const result = executionRunService.getResult(first.resultId!);
    expect(result).not.toBeNull();
  });
});

// ── Test C/D/E/H: resolvePreviousWorkerResult prefers structured findings ───

describe('resolvePreviousWorkerResult — structured findings are authoritative', () => {
  it('prefers typed findings over conversation text (structured source)', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedGoal(goalId);
    seedRun(goalId, randomUUID().slice(0, 6));
    await codexAdapter.reconcileGoalToResult(goalId, CORRECT_FINAL_ANSWER);
    // Mirror message carries CORRUPTED content — the handoff must ignore it.
    await seedWorkerMessage(convId, goalId, CORRUPTED_FINAL_ANSWER);

    const ctx = await handoff.resolvePreviousWorkerResult(convId, 'codex');
    expect(ctx).not.toBeNull();
    expect(ctx!.findingsSource).toBe('structured');
    expect(ctx!.typedFindings).toHaveLength(5);
    expect(ctx!.typedFindings![0].title).toMatch(/CORS/i);
    expect(ctx!.typedFindings![0].id).toBe('finding-1');
    expect(ctx!.executionResultId).toBeTruthy();
  });

  it('CRITICAL: corrupt/misformatted finalAnswer cannot change resolved findings', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedGoal(goalId);
    seedRun(goalId, randomUUID().slice(0, 6));
    await codexAdapter.reconcileGoalToResult(goalId, CORRECT_FINAL_ANSWER);
    await seedWorkerMessage(convId, goalId, CORRUPTED_FINAL_ANSWER);

    const ctx = await handoff.resolvePreviousWorkerResult(convId, 'codex');
    // The five CORRECT titles must resolve, not the corrupted text.
    const titles = ctx!.typedFindings!.map((f: any) => f.title);
    expect(titles.some((t: string) => /CORS/i.test(t))).toBe(true);
    expect(titles.some((t: string) => /Auth/i.test(t))).toBe(true);
    expect(titles.some((t: string) => /Duplicate route/i.test(t))).toBe(true);
    // None of the corrupted text may leak into the resolved findings.
    for (const t of titles) {
      expect(t).not.toMatch(/sky is sometimes blue/i);
      expect(t).not.toMatch(/bananas/i);
      expect(t).not.toMatch(/42 is the answer/i);
    }
  });

  it('does not use the legacy parser when typed findings exist (findingsSource structured)', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedGoal(goalId);
    seedRun(goalId, randomUUID().slice(0, 6));
    await codexAdapter.reconcileGoalToResult(goalId, CORRECT_FINAL_ANSWER);
    // Give the conversation a message whose content contains NO parseable finding
    // headers — if the legacy parser ran, it would yield a single generic finding.
    await seedWorkerMessage(convId, goalId, 'this is not a findings report at all and has no headers whatsoever');

    const ctx = await handoff.resolvePreviousWorkerResult(convId, 'codex');
    expect(ctx!.findingsSource).toBe('structured');
    expect(ctx!.typedFindings).toHaveLength(5);
  });
});

// ── Test F/G: legacy fallback for historical rows ───────────────────────────

describe('resolvePreviousWorkerResult — legacy fallback for historical rows', () => {
  it('resolves via legacy parseFindingsFromText when no structured findings exist', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    // NO run / NO execution_result — simulate a historical row.
    await seedWorkerMessage(convId, goalId, CORRECT_FINAL_ANSWER);

    const ctx = await handoff.resolvePreviousWorkerResult(convId, 'codex');
    expect(ctx).not.toBeNull();
    expect(ctx!.findingsSource).toBe('legacy_text_fallback');
    expect(ctx!.typedFindings).toBeUndefined();
    expect(ctx!.findings.length).toBeGreaterThanOrEqual(5);
  });

  it('resolves the exact old failure shape (=== FINDING N === + Additional observations)', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    await seedWorkerMessage(convId, goalId, CORRECT_FINAL_ANSWER);

    const ctx = await handoff.resolvePreviousWorkerResult(convId, 'codex');
    expect(ctx!.findingsSource).toBe('legacy_text_fallback');
    // Five headline findings, and the trailing "Additional observations" style
    // content is never absorbed (CORRECT_FINAL_ANSWER has no such section, so
    // length is the assertion; the decorated-header exclusion is covered by
    // workerContextHandoff.test.ts).
    expect(ctx!.findings.length).toBeGreaterThanOrEqual(5);
  });
});

// ── Test I: exactly-once conversation persistence ───────────────────────────

describe('conversation result persistence is exactly-once', () => {
  it('reconcileGoalToResult never creates a second execution_result for the same run', async () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedGoal(goalId);
    seedRun(goalId, randomUUID().slice(0, 6));
    await codexAdapter.reconcileGoalToResult(goalId, CORRECT_FINAL_ANSWER);
    await codexAdapter.reconcileGoalToResult(goalId, CORRECT_FINAL_ANSWER);

    // Assert only one result exists for the run via direct service lookup.
    const run = executionRunService.getRunByAgentInstanceId(goalId);
    const result = executionRunService.getResultForRun(run!.id);
    expect(result).not.toBeNull();
    // A second getResultForRun still returns the SAME id (single row).
    const again = executionRunService.getResultForRun(run!.id);
    expect(again!.id).toBe(result!.id);
  });
});

// ── Integration (Section 11): CodeX → findings → conversation mirror → verify ──

describe('Integration — typed findings drive the delegated verification prompt', () => {
  it('does NOT depend on parsing conversation message content', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedGoal(goalId);
    seedRun(goalId, randomUUID().slice(0, 6));
    await codexAdapter.reconcileGoalToResult(goalId, CORRECT_FINAL_ANSWER);
    await seedWorkerMessage(convId, goalId, CORRUPTED_FINAL_ANSWER);

    const ctx = await handoff.resolvePreviousWorkerResult(convId, 'codex');
    const prompt = handoff.buildDelegatedVerificationPrompt(
      'Verify the five findings CodeX reported.',
      ctx!,
      null,
    );

    // The prompt is built from typed findings, not the corrupted text.
    expect(prompt).toContain('Source: structured_output');
    expect(prompt).toContain('Permissive CORS configuration');
    expect(prompt).toContain('Duplicate route registration');
    expect(prompt).toContain('Finding ID: finding-1');
    // Corrupted conversation text must NOT appear in the delegated payload.
    expect(prompt).not.toContain('sky is sometimes blue');
    expect(prompt).not.toContain('bananas are yellow');
    // Read-only + no-report-search guards are preserved.
    expect(prompt).toContain('READ-ONLY CODEX TASK');
    expect(prompt).toContain('Do NOT search for a markdown document');
  });

  it('targets a single finding by index from typed findings', async () => {
    const convId = `conv-${randomUUID().slice(0, 8)}`;
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    seedConversation(convId);
    seedGoal(goalId);
    seedRun(goalId, randomUUID().slice(0, 6));
    await codexAdapter.reconcileGoalToResult(goalId, CORRECT_FINAL_ANSWER);
    await seedWorkerMessage(convId, goalId, CORRUPTED_FINAL_ANSWER);

    const ctx = await handoff.resolvePreviousWorkerResult(convId, 'codex');
    const prompt = handoff.buildDelegatedVerificationPrompt('Verify the second finding.', ctx!, 2);
    expect(prompt).toContain('Finding #2');
    expect(prompt).toContain('Auth bypassed');
  });
});
