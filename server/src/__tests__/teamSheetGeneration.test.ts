/**
 * Regression tests for Jarvis Agent Team initialization reliability:
 * team-sheet generation → extraction → normalization → schema parsing →
 * one corrective retry → truthful success or a detailed failure.
 * Drives the real production path (coordinatorService.createTeam and the
 * Jarvis orchestrator) with scripted model responses.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const mockState = vi.hoisted(() => ({
  impl: null as null | ((opts: any) => any),
  calls: [] as Array<{ prompt: string; systemPrompt?: string }>
}));

vi.mock('../services/llmGateway.js', () => ({
  llmChat: async (opts: any) => {
    if (!mockState.impl) throw new Error('LLM mock not initialized');
    mockState.calls.push({ prompt: opts.prompt, systemPrompt: opts.systemPrompt });
    return mockState.impl(opts);
  }
}));

function sheet(workspace: string, overrides: any = {}) {
  return {
    version: '1.0',
    teamName: 'Init Test Team',
    objective: 'Create the file with exact content',
    workspaceRoot: workspace,
    agents: [
      { id: 'a1', name: 'Planner', role: 'Planner', responsibilities: ['plan'], instructions: 'Plan.', dependencies: [], allowedTools: ['read_file'], readScopes: ['**'], writeScopes: [], outputArtifacts: [] },
      { id: 'a2', name: 'Builder', role: 'Builder', responsibilities: ['create'], instructions: 'Create.', dependencies: ['a1'], allowedTools: ['write_file', 'read_file'], readScopes: ['**'], writeScopes: ['jarvis-integration-test-2.txt'], outputArtifacts: ['jarvis-integration-test-2.txt'] },
      { id: 'a3', name: 'Verifier', role: 'Verifier', responsibilities: ['verify'], instructions: 'Verify.', dependencies: ['a1', 'a2'], allowedTools: ['read_file'], readScopes: ['**'], writeScopes: [], outputArtifacts: [] }
    ],
    handoffs: [],
    executionSequence: ['a1', 'a2', 'a3'],
    acceptanceCriteria: ['File contains exact bytes'],
    estimatedParallelism: 1,
    approvalRequired: true,
    ...overrides
  };
}

let tmpRoot: string;
let workspace: string;
let db: any;
let schema: any;
let coordinatorService: any;
let conversationService: any;
let jarvisOrchestrator: any;
let originalCwd: string;
let queue: string[];

function useQueue(responses: string[]) {
  queue = [...responses];
  mockState.calls = [];
  mockState.impl = () => {
    const reply = queue.length > 0 ? queue.shift()! : '{}';
    return { reply, provider: 'ollama', model: 'qwen2.5-coder:7b', offline: false, error: undefined };
  };
}

describe('TeamSheet generation reliability (production path)', () => {
  beforeAll(async () => {
    originalCwd = process.cwd();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-teamsheet-'));
    workspace = path.join(tmpRoot, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    execSync('git init', { cwd: workspace, stdio: 'ignore' });
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpRoot, 'test.db');
    process.chdir(tmpRoot);

    db = (await import('../db/index.js')).db;
    schema = await import('../db/schema.js');
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    migrate(db, { migrationsFolder: path.join(originalCwd, 'server', 'drizzle') });

    coordinatorService = (await import('../domains/teams/coordinatorService.js')).coordinatorService;
    conversationService = (await import('../domains/conversations/service.js')).conversationService;
    jarvisOrchestrator = (await import('../domains/jarvis/orchestrator.js')).jarvisOrchestrator;
  }, 60000);

  afterAll(() => {
    process.chdir(originalCwd);
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  it('rejects a malformed first response and retries once with the exact errors and JSON-only instruction', async () => {
    useQueue(['this is not json at all', JSON.stringify(sheet(workspace))]);

    const { teamId, teamSheet } = await coordinatorService.createTeam('Create the file', workspace);

    expect(teamId).toBeTruthy();
    expect(teamSheet.teamName).toBe('Init Test Team');
    expect(mockState.calls).toHaveLength(2);

    // The corrective retry carries the validation problem AND strict instructions.
    const repairPrompt = mockState.calls[1].prompt;
    expect(repairPrompt).toContain('failed Zod schema validation');
    expect(repairPrompt).toContain('unparseable text');
    expect(repairPrompt).toContain('Return ONLY valid JSON');
    // Same model config for the retry (provider/model are part of the call shape).
    expect(mockState.calls[1].systemPrompt).toBe(mockState.calls[0].systemPrompt);
  });

  it('accepts fenced JSON on the first attempt', async () => {
    useQueue(['```json\n' + JSON.stringify(sheet(workspace), null, 2) + '\n```']);
    const { teamSheet } = await coordinatorService.createTeam('Create the file', workspace);
    expect(teamSheet.teamName).toBe('Init Test Team');
    expect(mockState.calls).toHaveLength(1);
  });

  it('accepts prose plus embedded JSON on the first attempt', async () => {
    useQueue(['Here is the team you asked for:\n\n' + JSON.stringify(sheet(workspace)) + '\n\nLet me know if you need changes.']);
    const { teamSheet } = await coordinatorService.createTeam('Create the file', workspace);
    expect(teamSheet.teamName).toBe('Init Test Team');
    expect(mockState.calls).toHaveLength(1);
  });

  it('normalizes harmless variations: snake_case aliases, role casing, workspace-absolute paths', async () => {
    const variant: any = sheet(workspace);
    variant.team_name = variant.teamName; delete variant.teamName;
    variant.execution_sequence = variant.executionSequence; delete variant.executionSequence;
    variant.agents[0].role = 'planner';
    variant.agents[1].role = 'builder';
    variant.agents[2].role = 'verifier';
    // The exact production failure shape: absolute paths inside the workspace.
    variant.agents[1].writeScopes = [path.join(workspace, 'jarvis-integration-test-2.txt').replace(/\\/g, '/')];
    variant.agents[1].readScopes = [workspace.replace(/\\/g, '/') + '/'];

    useQueue([JSON.stringify(variant)]);
    const { teamSheet } = await coordinatorService.createTeam('Create the file', workspace);

    expect(teamSheet.agents.map((a: any) => a.role)).toEqual(['Planner', 'Builder', 'Verifier']);
    expect(teamSheet.agents[1].writeScopes).toEqual(['jarvis-integration-test-2.txt']);
    expect(mockState.calls).toHaveLength(1);
  });

  it('fails after exactly one retry with the missing/invalid fields in the error, and persists the raw responses', async () => {
    const noVerifier: any = sheet(workspace);
    noVerifier.agents = noVerifier.agents.slice(0, 2);
    noVerifier.executionSequence = ['a1', 'a2'];
    const badRole: any = sheet(workspace);
    badRole.agents[2].role = 'Wizard';

    useQueue([JSON.stringify(noVerifier), JSON.stringify(badRole)]);

    await expect(coordinatorService.createTeam('Create the file', workspace))
      .rejects.toThrow(/The model could not produce a valid TeamSheet: .*(role|Verifier)/i);

    // Exactly two attempts — no infinite retry.
    expect(mockState.calls).toHaveLength(2);

    // Sanitized raw responses persisted for diagnostics (each attempt, per team).
    const diagDir = path.join(workspace, '.agentos', 'diagnostics');
    const files = fs.readdirSync(diagDir);
    expect(files.some(f => f.includes('attempt1'))).toBe(true);
    expect(files.some(f => f.includes('attempt2'))).toBe(true);
    const attempt2Contents = files.filter(f => f.includes('attempt2'))
      .map(f => fs.readFileSync(path.join(diagDir, f), 'utf-8'));
    expect(attempt2Contents.some(c => c.includes('Wizard'))).toBe(true);
  });

  it('orchestrator records exactly one error message with field details on double failure', async () => {
    const broken = JSON.stringify({ hello: 'world' });
    useQueue([broken, broken]);

    const convId = await conversationService.createConversation('teamsheet-failure');
    const result = await jarvisOrchestrator.handleMessage(
      convId,
      'Create a team to create a file named jarvis-integration-test-2.txt containing exactly: verified.',
      workspace,
      'auto'
    );

    expect(result.route).toBe('agent_teams');
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/Failed to initialize Agent Team: The model could not produce a valid TeamSheet: /);

    const messages = await conversationService.getMessages(convId);
    const failures = messages.filter((m: any) => m.messageType === 'error' && String(m.content).includes('Failed to initialize Agent Team'));
    expect(failures).toHaveLength(1);
  });
});
