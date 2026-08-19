/**
 * ARGUS — independent verification system tests.
 *
 * Covers: immutable task contract (snapshot + hash), the goalStore guard
 * (generic update can never write verification state), verify pass/fail with
 * deterministic checks, evidence grading, structured defect packets,
 * auto-correction dispatch (≤3) with repairContext, Hermes escalation after
 * the ceiling, and canonical verifier (verification_reports) integration.
 *
 * Isolation recipe (same as revenuePipeline.test.ts): temp DB path +
 * vi.resetModules() + dynamic imports.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let wsDir: string;
let argus: any;
let goalStore: any;
let launcherCalls: { goalId: string; ctx: any }[] = [];

async function freshModules() {
  vi.resetModules();
  argus = await import('../services/argus/argusService.js');
  goalStore = (await import('../services/goalStore.js')).goalStore;
  launcherCalls = [];
  argus._setCorrectionLauncher(async (goalId: string, ctx: any) => {
    launcherCalls.push({ goalId, ctx });
  });
}

function makeGoal(overrides: Record<string, any> = {}) {
  const id = `goal-test-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  goalStore.create({
    id,
    workspacePath: wsDir,
    originalGoal: overrides.originalGoal || 'Write the file output.txt containing exactly: HELLO_ARGUS',
    status: 'queued',
    history: [],
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    providerFallbackCount: 0,
    executionOptions: {},
  });
  return id;
}

describe('ARGUS — contract immutability + guard', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-immut-'));
    wsDir = path.join(tmpDir, 'ws');
    fs.mkdirSync(wsDir, { recursive: true });
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });

  afterEach(() => {
    delete process.env.AGENT_TEAMS_DB_PATH;
  });

  it('snapshots the original spec + criteria and hashes them', async () => {
    const goalId = makeGoal({ originalGoal: 'Create report.md' });
    const contract = await argus.createContract(goalId, {
      acceptanceCriteria: [{ type: 'file-exists', path: 'report.md' }],
      title: 'Report contract',
    });
    expect(contract.goalId).toBe(goalId);
    expect(contract.originalSpec).toBe('Create report.md');
    expect(contract.specHash).toMatch(/^[0-9a-f]{64}$/);
    expect(contract.status).toBe('implementation_ready');
    const g = goalStore.get(goalId);
    expect(g.verificationState).toBe('implementation_ready');
    expect(g.contractId).toBe(contract.id);
  });

  it('rejects a second contract for the same goal', async () => {
    const goalId = makeGoal();
    await argus.createContract(goalId, { acceptanceCriteria: [{ type: 'file-exists', path: 'output.txt' }] });
    await expect(
      argus.createContract(goalId, { acceptanceCriteria: [{ type: 'file-exists', path: 'other.txt' }] }),
    ).rejects.toThrow(/already exists/i);
  });

  it('generic goalStore.update() can NEVER write verification state (guard)', async () => {
    const goalId = makeGoal();
    await argus.createContract(goalId, { acceptanceCriteria: [{ type: 'file-exists', path: 'output.txt' }] });
    // The builder path (codexLoop finish) only calls update() — attempt to
    // forge VERIFIED_COMPLETE through it must be a no-op.
    goalStore.update(goalId, { verificationState: 'verified_complete' } as any);
    expect(goalStore.get(goalId).verificationState).toBe('implementation_ready');
    // A forged non-terminal state is stripped too.
    goalStore.update(goalId, { verificationState: 'correcting' } as any);
    expect(goalStore.get(goalId).verificationState).toBe('implementation_ready');
  });

  it('setVerificationState refuses downgrades from verified_complete', async () => {
    const goalId = makeGoal();
    goalStore.setVerificationState(goalId, 'verified_complete');
    expect(() => goalStore.setVerificationState(goalId, 'correcting')).toThrow(/cannot downgrade/i);
    expect(goalStore.get(goalId).verificationState).toBe('verified_complete');
  });

  it('detects tampering: contract hash mismatch fails verification with a critical defect', async () => {
    const goalId = makeGoal({ originalGoal: 'Create output.txt' });
    const contract = await argus.createContract(goalId, {
      acceptanceCriteria: [{ type: 'file-content', path: 'output.txt', exact: 'HELLO_ARGUS' }],
    });
    // Attacker rewrites the stored contract (e.g. acceptance criteria edited
    // post-hoc). The stored hash no longer matches → immutability violation.
    const { db } = await import('../db/index.js');
    const { argusContracts } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    db.update(argusContracts).set({ specHash: 'deadbeef'.repeat(8) }).where(eq(argusContracts.id, contract.id)).run();

    const result = await argus.verifyContract(contract.id);
    expect(result.status).toBe('verification_failed');
    expect(result.verdict.checks.find((c: any) => c.name === 'contract-immutability')?.passed).toBe(false);
    expect(result.defect).toBeDefined();
    expect(result.defect.severity).toBe('critical');
    expect(result.defect.description).toMatch(/no longer matches/i);
    expect(goalStore.get(goalId).verificationState).toBe('verification_failed');
  });
});

describe('ARGUS — verification + defect + auto-correction', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-verify-'));
    wsDir = path.join(tmpDir, 'ws');
    fs.mkdirSync(wsDir, { recursive: true });
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    await freshModules();
  });

  afterEach(() => {
    delete process.env.AGENT_TEAMS_DB_PATH;
  });

  it('passes when every acceptance criterion is met (evidence L1)', async () => {
    fs.writeFileSync(path.join(wsDir, 'output.txt'), 'HELLO_ARGUS', 'utf-8');
    const goalId = makeGoal({ originalGoal: 'Write output.txt with HELLO_ARGUS' });
    const contract = await argus.createContract(goalId, {
      acceptanceCriteria: [{ type: 'file-content', path: 'output.txt', exact: 'HELLO_ARGUS' }],
    });
    const result = await argus.verifyContract(contract.id);
    expect(result.status).toBe('verified_complete');
    expect(result.evidenceLevel).toBe('L1');
    expect(result.verdict.passed).toBe(true);
    expect(goalStore.get(goalId).verificationState).toBe('verified_complete');
    expect(argus.listVerifications(contract.id).length).toBe(1);
  });

  it('fails with a structured defect packet and dispatches a correction goal carrying repairContext', async () => {
    fs.writeFileSync(path.join(wsDir, 'output.txt'), 'WRONG_VALUE', 'utf-8');
    const goalId = makeGoal({ originalGoal: 'Write output.txt with HELLO_ARGUS' });
    const contract = await argus.createContract(goalId, {
      acceptanceCriteria: [{ type: 'file-content', path: 'output.txt', exact: 'HELLO_ARGUS' }],
    });
    const result = await argus.verifyContract(contract.id);
    expect(result.status).toBe('verification_failed');
    expect(result.evidenceLevel).toBe('L0');

    // Structured defect packet fields (requirement 10).
    expect(result.defect).toMatchObject({
      contractId: contract.id,
      goalId,
      severity: 'major',
      expected: 'All acceptance criteria pass',
    });
    expect(result.defect.description).toMatch(/content does not match/i);
    // After dispatch the packet is 'dispatched' with the correction goal link.
    const storedDefect = argus.listDefects().find((d: any) => d.id === result.defect.id);
    expect(storedDefect.status).toBe('dispatched');
    expect(storedDefect.correctionGoalId).toMatch(/^goal-/);

    // Auto-correction dispatch (requirements 11–12): the launcher received a
    // NEW goal + repairContext — no manual copy of ARGUS feedback.
    expect(launcherCalls.length).toBe(1);
    expect(launcherCalls[0].goalId).toBe(storedDefect.correctionGoalId);
    expect(launcherCalls[0].ctx.repairContext).toMatchObject({
      attempt: 1,
      blockingIssues: [result.defect.description],
    });
    const correctionGoal = goalStore.get(launcherCalls[0].goalId);
    expect(correctionGoal.executionOptions.argusCorrection).toMatchObject({
      contractId: contract.id,
      defectId: result.defect.id,
      attempt: 1,
    });
    expect(correctionGoal.verificationState).toBe('correcting');
    expect(goalStore.get(goalId).verificationState).toBe('correcting');
    // Correction prompt embeds the defect so the builder fixes exactly it.
    expect(correctionGoal.originalGoal).toMatch(/AUTO-CORRECTION/);
  });

  it('caps corrections at 3 then escalates to Hermes (requirements 13–14)', async () => {
    fs.writeFileSync(path.join(wsDir, 'output.txt'), 'WRONG', 'utf-8');
    const goalId = makeGoal({ originalGoal: 'Write output.txt with HELLO_ARGUS' });
    const contract = await argus.createContract(goalId, {
      acceptanceCriteria: [{ type: 'file-content', path: 'output.txt', exact: 'HELLO_ARGUS' }],
    });

    // Four failing verifications: attempts 1..3 dispatch corrections, the 4th
    // exceeds the ceiling (ARGUS_CORRECTION_CEILING = 3) and escalates.
    for (let i = 0; i < 3; i++) {
      await argus.verifyContract(contract.id);
    }
    expect(launcherCalls.length).toBe(3);

    const fourth = await argus.verifyContract(contract.id);
    expect(launcherCalls.length).toBe(3); // no 4th correction goal
    expect(fourth.status).toBe('verification_failed');

    const { listDefects, getContractById } = argus;
    const defects = listDefects();
    expect(defects.filter((d: any) => d.status === 'escalated').length).toBe(1);
    expect(getContractById(contract.id).status).toBe('escalated');
    const corrections = (await import('../db/schema.js')).argusCorrections;
    const { db } = await import('../db/index.js');
    const { eq, and } = await import('drizzle-orm');
    const rows = db.select().from(corrections).where(eq(corrections.contractId, contract.id)).all();
    expect(rows.length).toBe(3);
    expect(rows.map((r: any) => r.attempt)).toEqual([1, 2, 3]);
  });

  it('re-verification after correction passes when the fix lands (full loop)', async () => {
    fs.writeFileSync(path.join(wsDir, 'output.txt'), 'WRONG', 'utf-8');
    const goalId = makeGoal({ originalGoal: 'Write output.txt with HELLO_ARGUS' });
    const contract = await argus.createContract(goalId, {
      acceptanceCriteria: [{ type: 'file-content', path: 'output.txt', exact: 'HELLO_ARGUS' }],
    });
    const first = await argus.verifyContract(contract.id);
    expect(first.status).toBe('verification_failed');
    expect(launcherCalls.length).toBe(1);

    // Simulate the correction goal actually fixing the file, then re-verify.
    fs.writeFileSync(path.join(wsDir, 'output.txt'), 'HELLO_ARGUS', 'utf-8');
    const second = await argus.verifyContract(contract.id, { attempt: 1 });
    expect(second.status).toBe('verified_complete');
    expect(second.evidenceLevel).toBe('L1');
    expect(goalStore.get(goalId).verificationState).toBe('verified_complete');
  });

  it('grades L2 evidence when a command check passes', async () => {
    const goalId = makeGoal({ originalGoal: 'Run a node check that exits 0' });
    const contract = await argus.createContract(goalId, {
      acceptanceCriteria: [
        { type: 'file-exists', path: 'output.txt' },
        { type: 'command', command: 'node', args: ['-e', 'process.exit(0)'], evidenceLevel: 'L2' },
      ],
    });
    fs.writeFileSync(path.join(wsDir, 'output.txt'), 'x', 'utf-8');
    const result = await argus.verifyContract(contract.id);
    expect(result.status).toBe('verified_complete');
    expect(result.evidenceLevel).toBe('L2');
  });
});
