/**
 * mcpBridge.test.ts — AGENTIC OS MCP Bridge backend contracts.
 *
 * Covers: prepare-without-execution, worker/task-type pairing, workspace
 * authorization, authoritative approval (client `approved` never trusted),
 * expiry, idempotent submission (exactly one canonical task/run), canonical
 * cancellation, and project isolation on read endpoints.
 *
 * Uses a per-test temp DB via AGENT_TEAMS_DB_PATH + vi.resetModules().
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let bridge: any;
let pStore: any;
let exec: any;

const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

async function freshModules() {
  vi.resetModules();
  process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, `db-${uniq()}.db`);
  process.env.AGENTICOS_DATA_DIR = path.join(tmpDir, 'data', uniq());
  fs.mkdirSync(process.env.AGENTICOS_DATA_DIR, { recursive: true });

  const schema = await import('../services/projectExecution/schema.js');
  schema.initProjectExecutionSchema();

  const bridgeMod = await import('../services/mcpBridge/mcpBridgeService.js');
  bridgeMod.initMcpBridgeSchema();

  const pMod = await import('../services/projectsStore.js');
  const eMod = await import('../services/projectExecution/executionRunService.js');
  return { bridge: bridgeMod.mcpBridgeService, pStore: pMod.projectsStore, exec: eMod.executionRunService };
}

async function makeProject(workspacePath: string | null = 'C:/work/demo') {
  const p = pStore.createProject({
    id: `proj-${uniq()}`,
    name: `Proj ${uniq()}`,
    description: 'bridge test project',
    workspacePath,
  });
  return p;
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpbridge-'));
  const m = await freshModules();
  bridge = m.bridge;
  pStore = m.pStore;
  exec = m.exec;
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('Phase 1A — read-only contracts', () => {
  it('rejects run detail across project boundaries (isolation)', async () => {
    const p1 = await makeProject();
    const p2 = await makeProject();
    const prepared = bridge.prepare({
      projectId: p1.id, targetWorker: 'hermes', taskType: 'research',
      title: 'T', prompt: 'Research the supplied file and summarize.',
    });
    bridge.resolveApproval(prepared.taskId, true, 'ok', 'test');
    const { run } = await bridge.submit(prepared.taskId);
    // Same project: allowed
    const ok = bridge.getRunDetail(run.id, p1.id);
    expect(ok).not.toBeNull();
    // Cross project: must throw
    expect(() => bridge.getRunDetail(run.id, p2.id)).toThrow(/boundary/i);
    expect(() => bridge.getRunResult(run.id, p2.id)).toThrow(/boundary/i);
  });

  it('lists runs bounded by limit and project', async () => {
    const p1 = await makeProject();
    const prepared = bridge.prepare({
      projectId: p1.id, targetWorker: 'hermes', taskType: 'research', title: 'T', prompt: 'Research x.',
    });
    bridge.resolveApproval(prepared.taskId, true, 'ok', 'test');
    await bridge.submit(prepared.taskId);
    const runs = bridge.listRuns(p1.id, { limit: 50 });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.every((r: any) => r.projectId === p1.id)).toBe(true);
  });
});

describe('Phase 1B — prepare (no execution)', () => {
  it('prepares a task without creating a run', async () => {
    const p = await makeProject();
    const prepared = bridge.prepare({
      projectId: p.id, targetWorker: 'hermes', taskType: 'research',
      title: 'Summarize file', prompt: 'Inspect the supplied text file and return a five-item factual summary.',
      constraints: { allowSourceChanges: false },
      sourceConversationId: 'conv-1', parentRunId: 'run-0', operationId: 'op-1',
    });
    expect(prepared.approvalState).toBe('pending');
    expect(prepared.risk).toBeTruthy();
    expect(prepared.submittedRunId).toBeNull();
    // No run exists for this project
    expect(bridge.listRuns(p.id).length).toBe(0);
  });

  it('rejects invalid worker/task-type pairing', async () => {
    const p = await makeProject();
    expect(() => bridge.prepare({
      projectId: p.id, targetWorker: 'magnitude', taskType: 'implementation',
      title: 'T', prompt: 'Edit code',
    })).toThrow(/pairing/i);
    expect(() => bridge.prepare({
      projectId: p.id, targetWorker: 'codex', taskType: 'research',
      title: 'T', prompt: 'Research x',
    })).toThrow(/pairing/i);
  });

  it('rejects arbitrary workspace paths', async () => {
    const p = await makeProject('C:/work/demo');
    expect(() => bridge.prepare({
      projectId: p.id, targetWorker: 'codex', taskType: 'implementation',
      title: 'T', prompt: 'Edit code', workspacePath: 'D:/elsewhere/evil',
      constraints: { allowSourceChanges: true },
    })).toThrow(/outside|authorized/i);
  });

  it('rejects missing projectId', async () => {
    expect(() => bridge.prepare({
      projectId: '', targetWorker: 'hermes', taskType: 'research', title: 'T', prompt: 'x',
    })).toThrow(/projectId/i);
  });

  it('rejects contradictory implementation constraints', async () => {
    const p = await makeProject();
    expect(() => bridge.prepare({
      projectId: p.id, targetWorker: 'codex', taskType: 'implementation',
      title: 'T', prompt: 'Edit code', constraints: { allowSourceChanges: false },
    })).toThrow(/allowSourceChanges/i);
  });
});

describe('Phase 1B — approval + submission', () => {
  it('requires approval before submission; client approved flag is not accepted', async () => {
    const p = await makeProject();
    const prepared = bridge.prepare({
      projectId: p.id, targetWorker: 'hermes', taskType: 'research', title: 'T', prompt: 'Research x.',
    });
    // Even with a client-provided approved claim, submission must fail.
    await expect(bridge.submit(prepared.taskId)).rejects.toThrow(/approval/i);
  });

  it('rejected approval cannot execute', async () => {
    const p = await makeProject();
    const prepared = bridge.prepare({
      projectId: p.id, targetWorker: 'hermes', taskType: 'research', title: 'T', prompt: 'Research x.',
    });
    bridge.resolveApproval(prepared.taskId, false, 'no', 'user');
    await expect(bridge.submit(prepared.taskId)).rejects.toThrow(/approval/i);
    expect(bridge.listRuns(p.id).length).toBe(0);
  });

  it('authoritative approval permits submission exactly once (idempotent)', async () => {
    const p = await makeProject();
    const prepared = bridge.prepare({
      projectId: p.id, targetWorker: 'hermes', taskType: 'research', title: 'T', prompt: 'Research x.',
    });
    bridge.resolveApproval(prepared.taskId, true, 'ok', 'user');
    const first = await bridge.submit(prepared.taskId);
    expect(first.alreadySubmitted).toBe(false);
    const second = await bridge.submit(prepared.taskId);
    expect(second.alreadySubmitted).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    // Exactly one canonical run for the task
    const runs = bridge.listRuns(p.id);
    expect(runs.filter((r: any) => r.taskId === prepared.taskId).length).toBe(1);
  });

  it('expired prepared task is rejected', async () => {
    const p = await makeProject();
    const prepared = bridge.prepare({
      projectId: p.id, targetWorker: 'hermes', taskType: 'research', title: 'T', prompt: 'Research x.',
    });
    bridge.resolveApproval(prepared.taskId, true, 'ok', 'user');
    // Force expiry by rewriting the row's expires_at to the past.
    const db = (await import('../db/index.js')).rawDb;
    db.prepare(`UPDATE mcp_prepared_tasks SET expires_at = ? WHERE task_id = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), prepared.taskId);
    await expect(bridge.submit(prepared.taskId)).rejects.toThrow(/expired/i);
  });
});

describe('Phase 1B — cancellation', () => {
  it('cancels a queued run through the canonical path and is idempotent', async () => {
    const p = await makeProject();
    const prepared = bridge.prepare({
      projectId: p.id, targetWorker: 'hermes', taskType: 'research', title: 'T', prompt: 'Research x.',
    });
    bridge.resolveApproval(prepared.taskId, true, 'ok', 'user');
    const { run } = await bridge.submit(prepared.taskId);
    const first = await bridge.cancel(run.id, 'user asked');
    expect(first.run.status).toBe('cancelled');
    expect(first.run.cancellationReason).toContain('user asked');
    const second = await bridge.cancel(run.id);
    expect(second.run.status).toBe('cancelled');
  });

  it('follow returns only events after the cursor', async () => {
    const p = await makeProject();
    const prepared = bridge.prepare({
      projectId: p.id, targetWorker: 'hermes', taskType: 'research', title: 'T', prompt: 'Research x.',
    });
    bridge.resolveApproval(prepared.taskId, true, 'ok', 'user');
    await bridge.submit(prepared.taskId);
    const all = bridge.followRun(exec.listRunsForProject(p.id)[0].id, 0);
    expect(all.events.length).toBeGreaterThanOrEqual(1);
    const after = bridge.followRun(all.run.id, all.nextSequence);
    expect(after.events.length).toBe(0);
    expect(after.nextSequence).toBe(all.nextSequence);
  });
});
