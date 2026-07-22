/**
 * Production-path regression test for the real paused "Integration Test Team"
 * run (db01c920). Drives the SAME public path the Jarvis UI uses:
 *
 *   orchestrator.handleMessage → coordinatorService.createTeam → approve →
 *   TeamRunner.startTeam → AgentRunner → codexLoop → finish →
 *   TeamRunner.processAgentCompletion → adjudication → repair → resumeTeam
 *
 * Reproduces the real run's failure shape:
 *   - Builder hits the blocked `echo` and declares status 'failed' with no artifacts
 *   - Verifier reports failure with blockingIssues as OBJECTS (used to crash the report parser)
 *   - repair must route to Builder 'a2' by role, produce the artifact, and
 *     verification must pass against persisted artifact bytes
 *   - resumeTeam must recreate a purged goal and create exactly one new attempt
 */
import { describe, expect, it, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const mockState = vi.hoisted(() => ({
  impl: null as null | ((opts: any) => any)
}));

vi.mock('../services/llmGateway.js', () => ({
  llmChat: async (opts: any) => {
    if (!mockState.impl) throw new Error('LLM mock not initialized');
    return mockState.impl(opts);
  }
}));

const EXPECTED = 'Jarvis Agent Teams integration verified.';
const WRONG = 'wrong bytes from the failed attempt';
const FILE_NAME = 'jarvis-integration-test.txt';
const sha256 = (buf: Buffer | string) => crypto.createHash('sha256').update(buf).digest('hex');

function toolCall(tool: string, args: any) {
  return JSON.stringify({ type: 'tool_call', tool, arguments: args });
}
function handoff(agentId: string, status: string, summary: string, extra: any = {}) {
  return {
    agentId, status, summary,
    decisions: [], artifacts: [], openIssues: [], recommendedNextActions: [],
    ...extra
  };
}
function finishWith(agentId: string, status: string, summary: string, extra: any = {}) {
  return toolCall('finish', { message: summary, handoff: handoff(agentId, status, summary, extra.handoffExtra || {}), ...extra.finishExtra });
}

let tmpRoot: string;
let workspace: string;
let db: any;
let schema: any;
let eq: any;
let conversationService: any;
let jarvisOrchestrator: any;
let TeamRunner: any;
let originalCwd: string;
let queues: Record<string, string[]>;

function teamSheet(ws: string) {
  return {
    version: '1.0', teamName: 'Integration Test Team',
    objective: `Create ${FILE_NAME} with exact content`,
    workspaceRoot: ws,
    agents: [
      { id: 'a1', name: 'Jarvis (Test Planner)', role: 'Planner', responsibilities: ['plan'], instructions: 'Plan.', dependencies: [], allowedTools: ['read_file'], readScopes: ['**'], writeScopes: [], outputArtifacts: [] },
      { id: 'a2', name: 'Jarvis (Test Builder)', role: 'Builder', responsibilities: ['create file'], instructions: 'Create the file.', dependencies: ['a1'], allowedTools: ['write_file', 'read_file', 'terminal'], readScopes: ['**'], writeScopes: [FILE_NAME], outputArtifacts: [FILE_NAME] },
      { id: 'a3', name: 'Jarvis (Test Verifier)', role: 'Verifier', responsibilities: ['verify'], instructions: 'Verify.', dependencies: ['a1', 'a2'], allowedTools: ['read_file', 'terminal'], readScopes: ['**'], writeScopes: [], outputArtifacts: [] }
    ],
    handoffs: [], executionSequence: ['a1', 'a2', 'a3'],
    acceptanceCriteria: [`File ${FILE_NAME} contains exactly: ${EXPECTED}`],
    estimatedParallelism: 1, approvalRequired: false
  };
}

function buildMock(ws: string) {
  mockState.impl = (opts: any) => {
    const sp: string = opts.systemPrompt || '';
    let key = 'default';
    if (sp.includes('Coordinator Agent')) key = 'coordinator';
    else if (sp.includes('Your Role: Planner')) key = 'Planner';
    else if (sp.includes('Your Role: Builder')) key = 'Builder';
    else if (sp.includes('Your Role: Verifier')) key = 'Verifier';
    const queue = queues[key];
    const reply = queue && queue.length > 0 ? queue.shift()! : finishWith('a1', 'completed', 'done');
    return { reply, provider: 'ollama', model: 'mock-7b', offline: false, error: undefined };
  };
}

async function waitForTerminal(runId: string, timeoutMs = 60000) {
  const { eq } = await import('drizzle-orm');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = db.select().from(schema.teamRuns).where(eq(schema.teamRuns.id, runId)).get();
    if (run && ['completed', 'failed', 'paused'].includes(run.status)) return run;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for terminal state');
}

async function startRunViaJarvis(prompt: string) {
  const { eq } = await import('drizzle-orm');
  const convId = await conversationService.createConversation('regression');
  const result = await jarvisOrchestrator.handleMessage(convId, prompt, workspace, 'auto');
  expect(result.error).toBeUndefined();
  expect(result.route).toBe('agent_teams');
  const teamId = result.teamId;
  db.update(schema.teams).set({ status: 'approved' }).where(eq(schema.teams.id, teamId)).run();
  const runId = await TeamRunner.startTeam(teamId);
  return { convId, teamId, runId };
}

const handoffsFor = (goalId: string, agentId?: string) => {
  const rows = db.select().from(schema.agentTeamHandoffs).where(eq(schema.agentTeamHandoffs.goalId, goalId)).all();
  return agentId ? rows.filter((h: any) => h.agentId === agentId) : rows;
};

describe('Production-path regression (real paused run shape)', () => {
  beforeAll(async () => {
    originalCwd = process.cwd();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-prod-it-'));
    workspace = path.join(tmpRoot, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    execSync('git init', { cwd: workspace, stdio: 'ignore' });
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpRoot, 'test.db');
    process.chdir(tmpRoot);

    db = (await import('../db/index.js')).db;
    eq = (await import('drizzle-orm')).eq;
    schema = await import('../db/schema.js');
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    migrate(db, { migrationsFolder: path.join(originalCwd, 'server', 'drizzle') });

    conversationService = (await import('../domains/conversations/service.js')).conversationService;
    jarvisOrchestrator = (await import('../domains/jarvis/orchestrator.js')).jarvisOrchestrator;
    TeamRunner = (await import('../services/agentTeams/teamRunner.js')).TeamRunner;
  }, 60000);

  afterAll(() => {
    process.chdir(originalCwd);
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    const target = path.join(workspace, FILE_NAME);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  });

  it('failed Builder attempt + object-form report → role repair → truthful completion', async () => {
    const { eq } = await import('drizzle-orm');
    queues = {
      coordinator: [JSON.stringify(teamSheet(workspace))],
      Planner: [finishWith('a1', 'completed', 'Plan created.')],
      Builder: [
        toolCall('runCommand', { cmd: 'echo', args: [EXPECTED, '>', FILE_NAME] }),
        finishWith('a2', 'failed', 'Failed to create jarvis-integration-test.txt due to sandbox restrictions.', {
          handoffExtra: { openIssues: ['File creation failed: sandbox restriction.'], recommendedNextActions: ['Use writeFile to create the file.'] }
        }),
        toolCall('writeFile', { path: FILE_NAME, content: EXPECTED }),
        finishWith('a2', 'completed', 'File created via writeFile.', { handoffExtra: { artifacts: [{ path: FILE_NAME }] } })
      ],
      Verifier: [
        toolCall('readFile', { path: FILE_NAME }),
        finishWith('a3', 'completed', 'Verification passed.', {
          finishExtra: {
            verificationReport: {
              passed: true, summary: 'bytes verified',
              checks: [{ name: 'exact bytes', passed: true, evidence: 'claimed', path: FILE_NAME, expectedContent: EXPECTED }],
              blockingIssues: [], recommendedFixes: []
            }
          }
        })
      ]
    };
    buildMock(workspace);

    const { teamId, runId } = await startRunViaJarvis(
      `Create a team to create a file named ${FILE_NAME} containing exactly: ${EXPECTED}`
    );
    const run = await waitForTerminal(runId);
    const goalId = run.goalId;

    /* terminal truth */
    expect(run.status).toBe('completed');
    expect(db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get().status).toBe('completed');

    const events = db.select().from(schema.goalEvents).where(eq(schema.goalEvents.goalId, goalId)).all();
    expect(events.filter((e: any) => e.eventType === 'team_completed').length).toBe(1);

    /* A: one canonical handoff per attempt, truthful status per attempt */
    const a1 = handoffsFor(goalId, 'a1');
    expect(a1.length).toBe(1);
    expect(a1[0].status).toBe('completed');

    const a2 = handoffsFor(goalId, 'a2').sort((x: any, y: any) => String(x.createdAt).localeCompare(String(y.createdAt)));
    expect(a2.length).toBe(2);
    expect(a2[0].status).toBe('failed');      // the declared failure is preserved
    expect(a2[1].status).toBe('completed');   // the repair attempt
    // never a completed AND failed row for the same attempt
    const a2FirstBatch = a2.filter((h: any) => h.createdAt === a2[0].createdAt);
    expect(new Set(a2FirstBatch.map((h: any) => h.status)).size).toBe(1);

    /* no generic 'verifier' agent id rows */
    expect(handoffsFor(goalId).some((h: any) => h.agentId === 'verifier')).toBe(false);

    /* B: artifact persisted from disk with real bytes + SHA-256 */
    const artifacts = db.select().from(schema.agentTeamArtifacts).where(eq(schema.agentTeamArtifacts.runId, runId)).all();
    const art = artifacts.find((a: any) => a.path === FILE_NAME);
    expect(art).toBeTruthy();
    expect(art.checksum).toBe(sha256(EXPECTED));
    expect(art.size).toBe(Buffer.byteLength(EXPECTED));
    expect(fs.readFileSync(path.join(workspace, FILE_NAME), 'utf-8')).toBe(EXPECTED);

    /* B: checkpoint carries the accumulated artifact */
    const checkpoint = JSON.parse(fs.readFileSync(path.join(tmpRoot, '.agentos', 'checkpoints', runId, 'checkpoint.json'), 'utf-8'));
    expect(checkpoint.artifactMetadata.some((a: any) => a.path === FILE_NAME && a.checksum === sha256(EXPECTED))).toBe(true);

    /* E: verification used persisted artifact bytes */
    const reports = db.select().from(schema.verificationReports).where(eq(schema.verificationReports.runId, runId)).all();
    const passRow = reports.find((r: any) => r.passed === true && String(r.verifierId).includes('adjudicated'));
    expect(passRow).toBeTruthy();
    const evidence = JSON.parse(passRow.evidence);
    expect(evidence[0].actualSha256).toBe(sha256(EXPECTED));

    /* no duplicate handoffs overall: a1:1 + a2:2 + a3:1 = 4 */
    expect(handoffsFor(goalId, 'a3').length).toBe(1);
    expect(handoffsFor(goalId).length).toBe(4);
  }, 120000);

  it('resumeTeam recreates a purged goal and completes with exactly one new attempt', async () => {
    const { eq } = await import('drizzle-orm');
    queues = {
      coordinator: [JSON.stringify(teamSheet(workspace))],
      Planner: [finishWith('a1', 'completed', 'Plan created.')],
      Builder: [
        finishWith('a2', 'failed', 'Failed to create file due to sandbox restrictions.', {
          handoffExtra: { openIssues: ['Sandbox restriction.'], recommendedNextActions: ['Use writeFile.'] }
        }),
        toolCall('writeFile', { path: FILE_NAME, content: EXPECTED }),
        finishWith('a2', 'completed', 'File created via writeFile.', { handoffExtra: { artifacts: [{ path: FILE_NAME }] } })
      ],
      Verifier: [
        // Attempt 1 (after builder repair): honest failure with OBJECT-form issues → budget exhausted → paused
        finishWith('a3', 'completed', 'Verification failed.', {
          finishExtra: {
            verificationReport: { passed: false, summary: 'not ready', checks: [],
              blockingIssues: [{ name: 'Verifier checks incomplete', evidence: 'Transient environment issue.' }], recommendedFixes: [] }
          }
        }),
        // Attempt 2 (post-resume): pass against the persisted artifact
        toolCall('readFile', { path: FILE_NAME }),
        finishWith('a3', 'completed', 'Verification passed.', {
          finishExtra: {
            verificationReport: { passed: true, summary: 'bytes verified',
              checks: [{ name: 'exact bytes', passed: true, evidence: 'claimed', path: FILE_NAME, expectedContent: EXPECTED }],
              blockingIssues: [], recommendedFixes: [] }
          }
        })
      ]
    };
    buildMock(workspace);

    const { teamId, runId } = await startRunViaJarvis(
      `Create a team to create a file named ${FILE_NAME} containing exactly: ${EXPECTED}`
    );
    const pausedRun = await waitForTerminal(runId);
    expect(pausedRun.status).toBe('paused');
    expect(pausedRun.repairCount).toBe(1);
    expect(db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get().status).toBe('paused');

    // The object-form blocking issues were normalized — never rejected as format errors.
    const pauseReports = db.select().from(schema.verificationReports).where(eq(schema.verificationReports.runId, runId)).all();
    const pauseFailRow = pauseReports.find((r: any) => r.passed === false);
    expect(pauseFailRow).toBeTruthy();
    expect(JSON.stringify(pauseFailRow.blockingIssues)).toContain('Verifier checks incomplete');
    expect(JSON.stringify(pauseFailRow.blockingIssues)).not.toContain('Invalid VerificationReport Format');

    const goalId = pausedRun.goalId;

    // Simulate the production purge: goal row and its events are gone.
    db.delete(schema.goalEvents).where(eq(schema.goalEvents.goalId, goalId)).run();
    db.delete(schema.goals).where(eq(schema.goals.id, goalId)).run();
    expect(db.select().from(schema.goals).where(eq(schema.goals.id, goalId)).get()).toBeUndefined();

    const handoffsBefore = handoffsFor(goalId).length;
    const a1Before = handoffsFor(goalId, 'a1').length;
    const a2Before = handoffsFor(goalId, 'a2').length;

    await TeamRunner.resumeTeam(runId);
    const finalRun = await waitForTerminal(runId);

    /* F: resume reached a truthful terminal state */
    expect(finalRun.status).toBe('completed');
    expect(db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get().status).toBe('completed');

    /* F: the purged goal was recreated so the loop could attach */
    expect(db.select().from(schema.goals).where(eq(schema.goals.id, goalId)).get()).toBeTruthy();

    /* F: exactly one new attempt (verifier), old handoffs untouched */
    expect(handoffsFor(goalId, 'a1').length).toBe(a1Before);
    expect(handoffsFor(goalId, 'a2').length).toBe(a2Before);
    expect(handoffsFor(goalId, 'a3').length).toBe(2);
    expect(handoffsFor(goalId).length).toBe(handoffsBefore + 1);

    const events = db.select().from(schema.goalEvents).where(eq(schema.goalEvents.goalId, goalId)).all();
    expect(events.filter((e: any) => e.eventType === 'team_completed').length).toBe(1);
    expect(events.filter((e: any) => e.eventType === 'team_resumed').length).toBe(1);
  }, 120000);
});
