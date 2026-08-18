/**
 * End-to-end integration test for the Jarvis → Agent Teams → CodeX workflow:
 *
 *   Jarvis routes to Agent Teams → team sheet (Planner/Builder/Verifier) →
 *   Builder creates a file (echo is blocked, corrective retry uses writeFile) →
 *   Verifier claims a dishonest pass → objective adjudication overrides it →
 *   repair is routed to the Builder BY ROLE (id 'a2', not 'builder') →
 *   Builder repairs with exact bytes → Verifier re-checks → SHA-256 from real
 *   bytes → run and team both reach a truthful 'completed' state.
 *
 * Runs against an isolated SQLite database and a temporary git workspace.
 * The real repository is never modified.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

/* ── LLM mock (scripted, hoisted) ─────────────────────────── */
const mockState = vi.hoisted(() => ({
  impl: null as null | ((opts: any) => any),
  calls: [] as Array<{ key: string }>
}));

vi.mock('../services/llmGateway.js', () => ({
  llmChat: async (opts: any) => {
    if (!mockState.impl) throw new Error('LLM mock not initialized');
    return mockState.impl(opts);
  }
}));

/* ── Constants ────────────────────────────────────────────── */
const EXPECTED = 'Jarvis Agent Teams integration verified.';
const WRONG = 'deliberately wrong bytes from attempt one';
const FILE_NAME = 'jarvis-integration-test.txt';
const sha256 = (buf: Buffer | string) => crypto.createHash('sha256').update(buf).digest('hex');

function toolCall(tool: string, args: any) {
  return JSON.stringify({ type: 'tool_call', tool, arguments: args });
}

function finishHandoff(agentId: string, summary: string, extra: any = {}) {
  return toolCall('finish', {
    message: summary,
    handoff: {
      agentId,
      status: 'completed',
      summary,
      decisions: [],
      artifacts: [],
      openIssues: [],
      recommendedNextActions: []
    },
    ...extra
  });
}

/* ── Test state ───────────────────────────────────────────── */
let tmpRoot: string;
let workspace: string;
let db: any;
let schema: any;
let conversationService: any;
let jarvisOrchestrator: any;
let TeamRunner: any;
let originalCwd: string;

describe('Jarvis → Agent Team → file → exact verification → repair', () => {
  beforeAll(async () => {
    // Isolated DB + temp workspace BEFORE any server module loads.
    originalCwd = process.cwd();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-it-'));
    workspace = path.join(tmpRoot, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    execSync('git init', { cwd: workspace, stdio: 'ignore' });
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpRoot, 'test.db');
    // checkpoint dirs are cwd-relative; keep them out of the real repo.
    process.chdir(tmpRoot);

    const dbModule = await import('../db/index.js');
    db = dbModule.db;
    schema = await import('../db/schema.js');

    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    const migrationsFolder = path.join(originalCwd, 'server', 'drizzle');
    migrate(db, { migrationsFolder });

    conversationService = (await import('../domains/conversations/service.js')).conversationService;
    jarvisOrchestrator = (await import('../domains/jarvis/orchestrator.js')).jarvisOrchestrator;
    TeamRunner = (await import('../services/agentTeams/teamRunner.js')).TeamRunner;

    // Scripted LLM behaviour per caller.
    const teamSheet = {
      version: '1.0',
      teamName: 'IntegrationFileTeam',
      objective: `Create ${FILE_NAME} with exact content`,
      workspaceRoot: workspace,
      agents: [
        { id: 'a1', name: 'Planner', role: 'Planner', responsibilities: ['plan'], instructions: 'Plan the work.', dependencies: [], allowedTools: ['read_file'], readScopes: ['**'], writeScopes: [], outputArtifacts: [] },
        { id: 'a2', name: 'Builder', role: 'Builder', responsibilities: ['create the file'], instructions: 'Create the file with exact content.', dependencies: ['a1'], allowedTools: ['write_file', 'read_file', 'terminal'], readScopes: ['**'], writeScopes: [FILE_NAME], outputArtifacts: [FILE_NAME] },
        { id: 'a3', name: 'Verifier', role: 'Verifier', responsibilities: ['verify exact bytes'], instructions: 'Verify the file bytes.', dependencies: ['a1', 'a2'], allowedTools: ['read_file', 'terminal'], readScopes: ['**'], writeScopes: [], outputArtifacts: [] }
      ],
      handoffs: [],
      executionSequence: ['a1', 'a2', 'a3'],
      acceptanceCriteria: [`File ${FILE_NAME} contains exactly: ${EXPECTED}`],
      estimatedParallelism: 1,
      approvalRequired: false
    };

    const verificationCheck = { name: 'exact bytes', passed: true, evidence: 'claimed', path: FILE_NAME, expectedContent: EXPECTED };

    const queues: Record<string, string[]> = {
      coordinator: [JSON.stringify(teamSheet)],
      Planner: [
        finishHandoff('a1', 'Plan: Builder creates the file with writeFile; Verifier checks exact bytes.')
      ],
      Builder: [
        // Attempt 1: try the blocked shell route first...
        toolCall('runCommand', { cmd: 'echo', args: [EXPECTED, '>', FILE_NAME] }),
        // ...corrective retry must use the native tool (wrong bytes on purpose)
        toolCall('writeFile', { path: FILE_NAME, content: WRONG }),
        finishHandoff('a2', 'File created (attempt 1).', { handoff: { agentId: 'a2', status: 'completed', summary: 'Created file', decisions: [], artifacts: [{ path: FILE_NAME }], openIssues: [], recommendedNextActions: [] } }),
        // Repair run: exact bytes this time
        toolCall('writeFile', { path: FILE_NAME, content: EXPECTED }),
        finishHandoff('a2', 'File repaired with exact bytes.', { handoff: { agentId: 'a2', status: 'completed', summary: 'Repaired file', decisions: [], artifacts: [{ path: FILE_NAME }], openIssues: [], recommendedNextActions: [] } })
      ],
      Verifier: [
        toolCall('readFile', { path: FILE_NAME }),
        // Dishonest pass on the wrong content — adjudication must override it
        finishHandoff('a3', 'Verification claimed pass.', {
          verificationReport: { passed: true, summary: 'claimed pass on wrong bytes', checks: [verificationCheck], blockingIssues: [], recommendedFixes: [] }
        }),
        // Re-verification after repair
        toolCall('readFile', { path: FILE_NAME }),
        finishHandoff('a3', 'Verification passed.', {
          verificationReport: { passed: true, summary: 'bytes verified', checks: [verificationCheck], blockingIssues: [], recommendedFixes: [] }
        })
      ]
    };

    mockState.impl = (opts: any) => {
      const sp: string = opts.systemPrompt || '';
      let key = 'default';
      if (sp.includes('Coordinator Agent')) key = 'coordinator';
      else if (sp.includes('Your Role: Planner')) key = 'Planner';
      else if (sp.includes('Your Role: Builder')) key = 'Builder';
      else if (sp.includes('Your Role: Verifier')) key = 'Verifier';
      mockState.calls.push({ key });
      const queue = queues[key];
      const reply = queue && queue.length > 0
        ? queue.shift()!
        : finishHandoff('a1', 'done');
      return { reply, provider: 'ollama', model: 'mock-7b', offline: false, error: undefined };
    };
  }, 60000);

  afterAll(() => {
    process.chdir(originalCwd);
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  it('runs the complete workflow to a truthful completed state', async () => {
    const { eq } = await import('drizzle-orm');

    /* 1. Jarvis routes the prompt to Agent Teams */
    const convId = await conversationService.createConversation('integration-test');
    const prompt = `Create a team to create a file named ${FILE_NAME} containing exactly: ${EXPECTED} Verify exact bytes and SHA-256.`;
    const result = await jarvisOrchestrator.handleMessage(convId, prompt, workspace, 'auto');

    expect(result.error).toBeUndefined();
    expect(result.route).toBe('agent_teams');
    expect(result.teamId).toBeTruthy();
    const teamId = result.teamId;

    /* 2. Team sheet contains Planner, Builder, Verifier roles */
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    const roles = team.teamSheet.agents.map((a: any) => a.role).sort();
    expect(roles).toEqual(['Builder', 'Planner', 'Verifier']);
    expect(team.teamSheet.workspaceRoot).toBe(workspace);

    /* Start the run (same call the approve_team endpoint makes) */
    db.update(schema.teams).set({ status: 'approved' }).where(eq(schema.teams.id, teamId)).run();
    const runId = await TeamRunner.startTeam(teamId);
    expect(runId).toBeTruthy();

    /* Wait for a terminal state */
    const start = Date.now();
    let run: any;
    while (Date.now() - start < 90000) {
      run = db.select().from(schema.teamRuns).where(eq(schema.teamRuns.id, runId)).get();
      if (run && ['completed', 'failed', 'paused'].includes(run.status)) break;
      await new Promise(r => setTimeout(r, 250));
    }
    const goalId = run.goalId;
    const events = db.select().from(schema.goalEvents).where(eq(schema.goalEvents.goalId, goalId)).all();
    const eventsOf = (agentId: string) => events.filter((e: any) => e.agentId === agentId);

    /* 3. Builder tried echo, got a corrective native-tool instruction, then used writeFile */
    const builderEvents = eventsOf('a2');
    const echoAttempt = builderEvents.find((e: any) => e.tool === 'runCommand' && e.eventType === 'tool_started');
    expect(echoAttempt, 'expected the Builder to attempt a shell command first').toBeTruthy();
    const echoError = builderEvents.find((e: any) => (e.error || '').includes('writeFile') && (e.message || '').startsWith('Tool error:'));
    expect(echoError, 'expected a corrective error event for the blocked echo command').toBeTruthy();
    expect(echoError.error).toMatch(/never use echo/i);
    const writeOk = builderEvents.find((e: any) => e.tool === 'writeFile' && e.eventType === 'tool_completed');
    expect(writeOk, 'expected a completed writeFile step from the Builder').toBeTruthy();

    /* 4. The file exists inside the selected workspace (not the server repo) */
    const targetFile = path.join(workspace, FILE_NAME);
    expect(fs.existsSync(targetFile)).toBe(true);

    /* 5. The Verifier read the real file */
    const verifierRead = eventsOf('a3').find((e: any) => e.tool === 'readFile' && e.filePath === FILE_NAME);
    expect(verifierRead, 'expected a readFile step from the Verifier').toBeTruthy();

    /* 6. Exact bytes match after repair */
    expect(fs.readFileSync(targetFile, 'utf-8')).toBe(EXPECTED);

    /* 7. SHA-256 evidence was computed from the real bytes */
    const reports = db.select().from(schema.verificationReports).where(eq(schema.verificationReports.runId, runId)).all();
    const passReport = reports.find((r: any) => (r.passed === 1 || r.passed === true) && String(r.verifierId).includes('adjudicated'));
    expect(passReport, 'expected an adjudicated passing report with objective evidence').toBeTruthy();
    const evidence = JSON.parse(passReport.evidence);
    expect(evidence[0].path).toBe(FILE_NAME);
    expect(evidence[0].expectedSha256).toBe(sha256(EXPECTED));
    expect(evidence[0].actualSha256).toBe(sha256(EXPECTED));
    expect(evidence[0].contentMatches).toBe(true);

    /* 8. Verification passes only when the artifact matches: the dishonest pass was overridden */
    const overridden = reports.find((r: any) => (r.passed === 0 || r.passed === false) && String(r.verifierId).includes('adjudicated'));
    expect(overridden, 'expected an adjudicated failure row for the dishonest pass').toBeTruthy();
    expect(String(JSON.stringify(overridden.blockingIssues))).toMatch(/does not match|missing or empty/i);

    /* 9. Repair was routed by role (Builder id is 'a2', not literal 'builder') */
    const repairEvent = events.find((e: any) => e.eventType === 'repair_requested');
    expect(repairEvent, 'expected a repair_requested event').toBeTruthy();
    const builderWrites = builderEvents.filter((e: any) => e.tool === 'writeFile' && e.eventType === 'tool_completed');
    expect(builderWrites.length).toBeGreaterThanOrEqual(2); // initial + repair

    /* 10/11. Run and team both reach truthful completed status */
    expect(run.status).toBe('completed');
    const finalTeam = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
    expect(finalTeam.status).toBe('completed');

    /* Terminal event emitted exactly once */
    expect(events.filter((e: any) => e.eventType === 'team_completed').length).toBe(1);

    /* Final artifact list persisted with real checksum */
    const artifacts = db.select().from(schema.agentTeamArtifacts).where(eq(schema.agentTeamArtifacts.runId, runId)).all();
    const finalArtifact = artifacts.find((a: any) => a.path === FILE_NAME && a.checksum === sha256(EXPECTED));
    expect(finalArtifact).toBeTruthy();

    /* 12. No duplicate handoffs: exactly one per agent completion */
    const handoffs = db.select().from(schema.agentTeamHandoffs).where(eq(schema.agentTeamHandoffs.goalId, goalId)).all();
    const countBy = (agentId: string) => handoffs.filter((h: any) => h.agentId === agentId).length;
    expect(countBy('a1')).toBe(1); // planner once
    expect(countBy('a2')).toBe(2); // builder initial + repair
    expect(countBy('a3')).toBe(2); // verifier initial + re-verify
    expect(handoffs.length).toBe(5);
  }, 120000);
});
