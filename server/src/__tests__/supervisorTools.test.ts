import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';
import {
  getSystemHealth,
  delegateHermesTask,
  delegateCodexGoal,
  recallMemory,
  getCurrentWork,
  executeSupervisorTool,
  SUPERVISOR_TOOL_SCHEMAS
} from '../domains/jarvis/supervisorTools.js';

import { rawDb } from '../db/index.js';

describe('Jarvis Supervisor Tools (Phase 1)', () => {
  beforeEach(async () => {
    try {
      rawDb.exec("DELETE FROM background_task_events; DELETE FROM background_tasks;");
    } catch {}
    vi.clearAllMocks();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('SUPERVISOR_TOOL_SCHEMAS defines the 5 required supervisor tools', () => {
    const names = SUPERVISOR_TOOL_SCHEMAS.map(s => s.name);
    expect(names).toContain('get_system_health');
    expect(names).toContain('delegate_hermes_task');
    expect(names).toContain('delegate_codex_goal');
    expect(names).toContain('recall_memory');
    expect(names).toContain('get_current_work');
  });

  it('get_system_health returns structured telemetry data (no canned conversational replies)', async () => {
    const result = await getSystemHealth({ component: 'all' });
    expect(result).toBeDefined();
    expect(result.componentRequested).toBe('all');
    expect(result.gateways).toBeDefined();
    expect(result.gateways.openRouter).toHaveProperty('reachable');
    expect(result.gateways.openRouter).toHaveProperty('status');
    expect(result.gateways.ollama).toHaveProperty('reachable');
    expect(result.gateways.hermes).toHaveProperty('reachable');
    expect(result.activeModel).toBeDefined();
    expect(result.activeModel).toHaveProperty('provider');
    expect(result.activeModel).toHaveProperty('model');
    expect(result.tasks).toBeDefined();
    expect(typeof result.tasks.activeCount).toBe('number');
    expect(typeof result.tasks.queuedCount).toBe('number');
    expect(Array.isArray(result.tasks.recentTasks)).toBe(true);
  });

  it('delegate_hermes_task creates a structured Hermes delegation payload', async () => {
    const result = await delegateHermesTask({
      objective: 'Research state of AI multi-agent orchestration architecture',
      context: 'User requested a roadmap analysis'
    });

    expect(result).toBeDefined();
    expect(result.worker).toBe('hermes');
    expect(result.status).toBe('queued');
    expect(result.objective).toBe('Research state of AI multi-agent orchestration architecture');
    expect(result.context).toBe('User requested a roadmap analysis');
    expect(result.taskId).toBeTruthy();
  });

  it('delegate_codex_goal creates a structured CodeX delegation payload', async () => {
    const result = await delegateCodexGoal({
      goal: 'Fix the aspect-ratio scaling issue on the central Jarvis 3D canvas',
      context: 'The user noticed the sphere was stretched into an oval',
      targetFiles: ['src/components/jarvis/JarvisNeuralBlob.tsx'],
      approvalRequired: true
    });

    expect(result).toBeDefined();
    expect(result.worker).toBe('codex');
    expect(result.status).toBe('waiting_for_approval');
    expect(result.goal).toBe('Fix the aspect-ratio scaling issue on the central Jarvis 3D canvas');
    expect(result.targetFiles).toEqual(['src/components/jarvis/JarvisNeuralBlob.tsx']);
    expect(result.approvalRequired).toBe(true);
    expect(result.taskId).toBeTruthy();
  });

  it('recall_memory searches structured memories', async () => {
    const result = await recallMemory({ query: 'working preferences' });
    expect(result).toBeDefined();
    expect(result.query).toBe('working preferences');
    expect(Array.isArray(result.searchResults)).toBe(true);
  });

  it('get_current_work returns structured active and recent work records', async () => {
    const result = await getCurrentWork({ scope: 'all' });
    expect(result).toBeDefined();
    expect(result.scope).toBe('all');
    expect(Array.isArray(result.recentTasks)).toBe(true);
  });

  it('executeSupervisorTool dispatches tools correctly and throws on unknown tools', async () => {
    const health = await executeSupervisorTool('get_system_health', { component: 'hermes' });
    expect(health).toHaveProperty('gateways');

    await expect(
      executeSupervisorTool('non_existent_tool', {})
    ).rejects.toThrow(/Unknown supervisor tool/);
  });
});
